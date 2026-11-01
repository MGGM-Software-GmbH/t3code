import {
  PdSecretsError,
  type PdSecretsLoginInput,
  type PdSecretsLoginResult,
  type PdSecretsRespondInput,
  type PdSecretsStatus,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { PtyAdapter, type PtyProcess } from "@t3tools/shared/PtyAdapter";
import { resolveCommandPath } from "@t3tools/shared/shell";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Redacted from "effect/Redacted";
import * as Scope from "effect/Scope";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as NodeUtil from "node:util";
import * as ServerSettings from "../serverSettings.ts";

export class PdSecrets extends Context.Service<
  PdSecrets,
  {
    readonly status: () => Effect.Effect<PdSecretsStatus, PdSecretsError>;
    readonly login: (
      input: PdSecretsLoginInput,
      ownerSessionId: string,
    ) => Effect.Effect<PdSecretsLoginResult, PdSecretsError>;
    readonly respond: (
      input: PdSecretsRespondInput,
      ownerSessionId: string,
    ) => Effect.Effect<PdSecretsLoginResult, PdSecretsError>;
    readonly cancel: (ownerSessionId: string) => Effect.Effect<void>;
  }
>()("t3/environment/PdSecrets") {}

interface LoginFlow {
  readonly id: string;
  readonly ownerSessionId: string;
  phase: "password" | "running" | "totp" | "post-login";
  result: Deferred.Deferred<PdSecretsLoginResult, PdSecretsError>;
  readonly failure: Deferred.Deferred<never, PdSecretsError>;
  process: PtyProcess | undefined;
  exited: boolean;
  dispose: Array<() => void>;
}

const make = Effect.gen(function* () {
  const pty = yield* PtyAdapter;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const home = yield* HostProcess.HomeDirectory;
  const env = yield* HostProcess.Environment;
  const path = yield* Path.Path;
  const fileSystem = yield* FileSystem.FileSystem;
  const scope = yield* Scope.Scope;
  const crypto = yield* Crypto.Crypto;
  const settings = yield* ServerSettings.ServerSettingsService;
  let active: LoginFlow | undefined;
  const command = () =>
    resolveCommandPath("pd-secrets", { env }).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
    );

  const status = Effect.fn("PdSecrets.status")(function* () {
    const executable = yield* command();
    if (executable === null) return { state: "not-installed" } as const;
    // The CLI owns expiry, including Monday 05:00 in the host timezone.
    const exitCode = yield* spawner
      .spawn(
        ChildProcess.make(executable, ["status", "--quiet"], {
          cwd: home,
          env,
          stdin: "ignore",
          stdout: "ignore",
          stderr: "ignore",
        }),
      )
      .pipe(
        Effect.flatMap((handle) => handle.exitCode),
        Effect.scoped,
        Effect.timeout("10 seconds"),
        Effect.mapError(() => new PdSecretsError({ reason: "check_failed" })),
      );
    if (exitCode !== 0 && exitCode !== 1)
      return yield* new PdSecretsError({ reason: "check_failed" });
    return { state: exitCode === 0 ? "connected" : "disconnected" } as const;
  });

  const stop = (flow: LoginFlow) => {
    if (active === flow) active = undefined;
    for (const dispose of flow.dispose.splice(0)) dispose();
    if (!flow.exited) {
      flow.exited = true;
      try {
        flow.process?.kill();
      } catch {
        /* The owned process may have already exited. */
      }
    }
  };
  const fail = (flow: LoginFlow, reason: PdSecretsError["reason"]) => {
    const failure = Effect.fail(new PdSecretsError({ reason }));
    Deferred.doneUnsafe(flow.result, failure);
    Deferred.doneUnsafe(flow.failure, failure);
    stop(flow);
  };
  const cancel = (ownerSessionId: string) =>
    Effect.sync(() => {
      if (active?.ownerSessionId === ownerSessionId) fail(active, "cancelled");
    });
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      if (active) fail(active, "cancelled");
    }),
  );

  // Only the configured script knows the workplace-specific steps. Sign-in
  // inputs are never passed to it, and its output stays off the wire.
  const runPostLoginScript = Effect.gen(function* () {
    const configured = (yield* settings.getSettings).pdSecretsPostLoginScript;
    if (configured === "") return;
    const script = configured.startsWith("~/") ? path.join(home, configured.slice(2)) : configured;
    if (!path.isAbsolute(script) || (yield* fileSystem.stat(script)).type !== "File") {
      return yield* new PdSecretsError({ reason: "post_login_failed" });
    }
    const bash = yield* resolveCommandPath("bash", { env }).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
    );
    if (bash === null) return yield* new PdSecretsError({ reason: "post_login_failed" });
    const exitCode = yield* spawner
      .spawn(
        ChildProcess.make(bash, [script], {
          cwd: home,
          env,
          stdin: "ignore",
          stdout: "ignore",
          stderr: "ignore",
        }),
      )
      .pipe(
        Effect.flatMap((handle) => handle.exitCode),
        Effect.scoped,
      );
    if (exitCode !== 0) return yield* new PdSecretsError({ reason: "post_login_failed" });
  }).pipe(
    Effect.timeout("10 minutes"),
    Effect.mapError(() => new PdSecretsError({ reason: "post_login_failed" })),
  );

  const awaitResult = Effect.fn("PdSecrets.awaitResult")(
    function* (flow: LoginFlow) {
      const result = yield* Deferred.await(flow.result);
      if (result.phase === "connected") {
        yield* Effect.gen(function* () {
          const snapshot = yield* status();
          if (snapshot.state !== "connected")
            return yield* new PdSecretsError({ reason: "login_failed" });
          yield* runPostLoginScript;
        }).pipe(
          Effect.raceFirst(Deferred.await(flow.failure)),
          Effect.ensuring(Effect.sync(() => stop(flow))),
        );
      }
      return result;
    },
    (effect, flow) =>
      effect.pipe(Effect.onInterrupt(() => Effect.sync(() => fail(flow, "cancelled")))),
  );

  const login = Effect.fn("PdSecrets.login")(function* (
    input: PdSecretsLoginInput,
    ownerSessionId: string,
  ) {
    const executable = yield* command();
    if (executable === null) return yield* new PdSecretsError({ reason: "not_installed" });
    const id = yield* crypto.randomUUIDv4().pipe(Effect.orDie);
    // Reserve before spawning so concurrent clients cannot start competing cache writers.
    const flow = yield* Effect.suspend(() => {
      if (active) return Effect.fail(new PdSecretsError({ reason: "busy" }));
      const reserved: LoginFlow = {
        id,
        ownerSessionId,
        phase: "password",
        result: Deferred.makeUnsafe<PdSecretsLoginResult, PdSecretsError>(),
        failure: Deferred.makeUnsafe<never, PdSecretsError>(),
        process: undefined,
        exited: false,
        dispose: [],
      };
      active = reserved;
      return Effect.succeed(reserved);
    });
    yield* Effect.sleep("5 minutes").pipe(
      Effect.andThen(
        Effect.sync(() => {
          if (active === flow && flow.phase !== "post-login") fail(flow, "expired");
        }),
      ),
      Effect.forkIn(scope),
    );
    yield* Effect.sleep("10 seconds").pipe(
      Effect.andThen(
        Effect.sync(() => {
          if (active === flow && flow.phase === "password") fail(flow, "configuration");
        }),
      ),
      Effect.forkIn(scope),
    );
    const child = yield* pty
      .spawn({
        shell: executable,
        args: ["login", "--env-file", path.join(home, ".claude", ".env")],
        cwd: home,
        cols: 120,
        rows: 30,
        env: { ...env, TERM: "dumb", NO_COLOR: "1" },
      })
      .pipe(
        Effect.mapError(() => new PdSecretsError({ reason: "login_failed" })),
        Effect.tapError(() => Effect.sync(() => fail(flow, "login_failed"))),
        Effect.onInterrupt(() => Effect.sync(() => fail(flow, "cancelled"))),
      );
    flow.process = child;
    if (active !== flow) {
      child.kill();
      return yield* Deferred.await(flow.result);
    }
    let prompt = "";
    // A PTY may replay buffered events during subscription, including an immediate exit.
    const listen = (dispose: () => void) => {
      if (active === flow) flow.dispose.push(dispose);
      else dispose();
    };
    listen(
      child.onData((chunk) => {
        // Click prompts may span chunks. Output is consumed locally, never logged or returned.
        prompt = (prompt + NodeUtil.stripVTControlCharacters(chunk)).slice(-512);
        if (flow.phase === "password" && /(?:^|[\r\n])Password Depot Passwort: $/.test(prompt)) {
          prompt = "";
          flow.phase = "running";
          try {
            child.write(`${Redacted.value(input.password)}\n`);
          } catch {
            fail(flow, "login_failed");
          } finally {
            Redacted.wipeUnsafe(input.password);
          }
        } else if (flow.phase === "running" && /(?:^|[\r\n])TOTP-Code: $/.test(prompt)) {
          prompt = "";
          flow.phase = "totp";
          Deferred.doneUnsafe(flow.result, Effect.succeed({ phase: "totp", flowId: id }));
        }
      }),
    );
    listen(
      child.onExit(({ exitCode }) => {
        flow.exited = true;
        if (exitCode === 0 && flow.phase === "running") {
          flow.phase = "post-login";
          Deferred.doneUnsafe(flow.result, Effect.succeed({ phase: "connected" }));
        } else fail(flow, "login_failed");
      }),
    );
    return yield* awaitResult(flow).pipe(
      Effect.ensuring(Effect.sync(() => Redacted.wipeUnsafe(input.password))),
    );
  });

  const respond = Effect.fn("PdSecrets.respond")(function* (
    input: PdSecretsRespondInput,
    ownerSessionId: string,
  ) {
    const flow = active;
    if (
      !flow ||
      flow.id !== input.flowId ||
      flow.ownerSessionId !== ownerSessionId ||
      flow.phase !== "totp"
    ) {
      return yield* new PdSecretsError({ reason: "expired" });
    }
    flow.result = Deferred.makeUnsafe<PdSecretsLoginResult, PdSecretsError>();
    flow.phase = "running";
    yield* Effect.try({
      try: () => flow.process?.write(`${Redacted.value(input.code)}\n`),
      catch: () => new PdSecretsError({ reason: "login_failed" }),
    }).pipe(
      Effect.tapError(() => Effect.sync(() => fail(flow, "login_failed"))),
      Effect.ensuring(Effect.sync(() => Redacted.wipeUnsafe(input.code))),
    );
    return yield* awaitResult(flow);
  });
  return PdSecrets.of({ status, login, respond, cancel });
});

export const layer = Layer.effect(PdSecrets, make);
