import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { PdSecretsError } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { PtyAdapter, type PtyExitEvent, type PtySpawnInput } from "@t3tools/shared/PtyAdapter";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Queue from "effect/Queue";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as ChildProcess from "effect/process/ChildProcess";
import * as PdSecrets from "./PdSecrets.ts";
import * as ServerSettings from "../serverSettings.ts";

const password = () => ({ password: Redacted.make("synthetic-password") });

const makeHarness = Effect.fn("makeHarness")(function* (installed = true) {
  const fs = yield* FileSystem.FileSystem;
  const realSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const home = yield* fs.makeTempDirectoryScoped({ prefix: "t3-pd-secrets-" });
  yield* fs.symlink("/bin/bash", `${home}/bash`);
  const settingsContext = yield* Layer.build(ServerSettings.layerTest());
  const settings = Context.get(settingsContext, ServerSettings.ServerSettingsService);
  if (installed) yield* fs.symlink("/bin/true", `${home}/pd-secrets`);
  const ready = yield* Queue.unbounded<void>();
  const writes: string[] = [];
  const spawns: PtySpawnInput[] = [];
  const dataListeners = new Set<(data: string) => void>();
  const exitListeners = new Set<(event: PtyExitEvent) => void>();
  let killed = 0;
  let code = 1;
  let hanging = false;
  const checks: unknown[] = [];
  const scriptReady = yield* Queue.unbounded<void>();
  let hangingScript = false;
  let interruptedScript = false;
  let realScript = false;
  const spawner = ChildProcessSpawner.make((command) =>
    Effect.suspend(() => {
      checks.push(command);
      const isScript = ChildProcess.isStandardCommand(command) && command.args[0] !== "status";
      if (isScript) {
        Queue.offerUnsafe(scriptReady, undefined);
        if (realScript) return realSpawner.spawn(command);
      }
      return Effect.succeed(
        ChildProcessSpawner.makeHandle({
          pid: ChildProcessSpawner.ProcessId(42),
          exitCode: isScript
            ? hangingScript
              ? Effect.never.pipe(
                  Effect.onInterrupt(() =>
                    Effect.sync(() => {
                      interruptedScript = true;
                    }),
                  ),
                )
              : Effect.succeed(ChildProcessSpawner.ExitCode(0))
            : hanging
              ? Effect.never
              : Effect.succeed(ChildProcessSpawner.ExitCode(code)),
          isRunning: Effect.succeed(false),
          kill: () => Effect.void,
          unref: Effect.succeed(Effect.void),
          stdin: Sink.drain,
          stdout: Stream.empty,
          stderr: Stream.empty,
          all: Stream.empty,
          getInputFd: () => Sink.drain,
          getOutputFd: () => Stream.empty,
        }),
      );
    }),
  );
  const context = yield* Layer.build(
    PdSecrets.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(HostProcess.HomeDirectory, home),
          Layer.succeed(ServerSettings.ServerSettingsService, settings),
          Layer.succeed(HostProcess.Environment, { PATH: home }),
          Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner),
          Layer.succeed(PtyAdapter, {
            spawn: (input) =>
              Effect.sync(() => {
                spawns.push(input);
                return {
                  pid: 123,
                  write: (data: string) => {
                    writes.push(data);
                  },
                  resize: () => {},
                  kill: () => {
                    killed++;
                  },
                  onData: (callback: (data: string) => void) => {
                    dataListeners.add(callback);
                    return () => {
                      dataListeners.delete(callback);
                    };
                  },
                  onExit: (callback: (event: PtyExitEvent) => void) => {
                    exitListeners.add(callback);
                    Queue.offerUnsafe(ready, undefined);
                    return () => {
                      exitListeners.delete(callback);
                    };
                  },
                };
              }),
          }),
        ),
      ),
    ),
  );
  return {
    service: Context.get(context, PdSecrets.PdSecrets),
    home,
    writes,
    spawns,
    checks,
    ready: Queue.take(ready),
    scriptReady: Queue.take(scriptReady),
    configureScript: (value: string) =>
      settings.updateSettings({ pdSecretsPostLoginScript: value }),
    hangScript: () => {
      hangingScript = true;
    },
    useRealScript: () => {
      realScript = true;
    },
    interruptedScript: () => interruptedScript,
    data: (data: string) => {
      for (const listener of dataListeners) listener(data);
    },
    exit: (exitCode: number) => {
      for (const listener of exitListeners) listener({ exitCode, signal: null });
    },
    setCode: (value: number) => {
      code = value;
    },
    hang: () => {
      hanging = true;
    },
    killed: () => killed,
    listeners: () => dataListeners.size + exitListeners.size,
  };
});

it.layer(NodeServices.layer)("PdSecrets", (it) => {
  it.effect("hides an absent CLI without starting authentication", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness(false);
      expect(yield* h.service.status()).toEqual({ state: "not-installed" });
      expect((yield* h.service.login(password(), "owner").pipe(Effect.flip)).reason).toBe(
        "not_installed",
      );
      expect(h.spawns).toEqual([]);
      expect(h.checks).toEqual([]);
    }),
  );

  it.effect("uses quiet exit codes to detect a cache becoming invalid", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness();
      h.setCode(0);
      expect(yield* h.service.status()).toEqual({ state: "connected" });
      h.setCode(1);
      expect(yield* h.service.status()).toEqual({ state: "disconnected" });
      expect(h.checks[0]).toMatchObject({
        args: ["status", "--quiet"],
        options: { cwd: h.home, stdout: "ignore", stderr: "ignore", stdin: "ignore" },
      });
      h.setCode(2);
      expect((yield* h.service.status().pipe(Effect.flip)).reason).toBe("check_failed");
    }),
  );

  it.effect("times out a stuck status process", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness();
      h.hang();
      const check = yield* h.service.status().pipe(Effect.flip, Effect.forkScoped);
      yield* TestClock.adjust("10 seconds");
      expect((yield* Fiber.join(check)).reason).toBe("check_failed");
    }),
  );

  it.effect("sends the password only after its prompt, then accepts a TOTP challenge", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness();
      const fs = yield* FileSystem.FileSystem;
      yield* fs.writeFileString(`${h.home}/after-totp.sh`, "exit 0\n");
      yield* h.configureScript("~/after-totp.sh");
      const login = yield* h.service.login(password(), "owner").pipe(Effect.forkScoped);
      yield* h.ready;
      h.data("Server configured\r\nPassword Depot Pass");
      expect(h.writes).toEqual([]);
      h.data("wort: ");
      expect(h.writes).toEqual(["synthetic-password\n"]);
      h.data("\r\nTOTP-Code wird benötigt.\r\nTOTP-");
      h.data("Code: ");
      const challenge = yield* Fiber.join(login);
      expect(challenge.phase).toBe("totp");
      expect(h.checks).toEqual([]);
      if (challenge.phase !== "totp") return;
      expect(h.spawns[0]).toMatchObject({
        cwd: h.home,
        args: ["login", "--env-file", `${h.home}/.claude/.env`],
      });
      expect(JSON.stringify(h.spawns)).not.toContain("synthetic-password");
      const response = yield* h.service
        .respond({ flowId: challenge.flowId, code: Redacted.make("123456") }, "owner")
        .pipe(Effect.forkScoped);
      yield* Effect.yieldNow;
      expect(h.writes).toEqual(["synthetic-password\n", "123456\n"]);
      h.data("123456\r\nLogin successful");
      h.setCode(0);
      h.exit(0);
      expect(yield* Fiber.join(response)).toEqual({ phase: "connected" });
      expect(h.listeners()).toBe(0);
      expect(h.killed()).toBe(0);
      expect(h.checks).toHaveLength(2);
    }),
  );

  it.effect("supports login without TOTP and verifies cache validity after exit", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness();
      const login = yield* h.service
        .login(password(), "owner")
        .pipe(Effect.flip, Effect.forkScoped);
      yield* h.ready;
      h.data("Password Depot Passwort: ");
      h.exit(0);
      expect((yield* Fiber.join(login)).reason).toBe("login_failed");
      const retry = yield* h.service.login(password(), "owner").pipe(Effect.forkScoped);
      yield* h.ready;
      h.data("Password Depot Passwort: ");
      h.setCode(0);
      h.exit(0);
      expect(yield* Fiber.join(retry)).toEqual({ phase: "connected" });
    }),
  );

  it.effect("never returns CLI output on a rejected password", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness();
      const login = yield* h.service
        .login(password(), "owner")
        .pipe(Effect.flip, Effect.forkScoped);
      yield* h.ready;
      h.data("Password Depot Passwort: ");
      h.data("\r\nError: synthetic-password 123456 token=private-value\r\n");
      h.exit(1);
      const failure = yield* Fiber.join(login);
      expect(failure).toBeInstanceOf(PdSecretsError);
      expect(failure.reason).toBe("login_failed");
      expect(JSON.stringify(failure)).not.toMatch(/synthetic-password|123456|private-value/);
    }),
  );

  it.effect("rejects competing logins and another browser's TOTP or cancellation", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness();
      const login = yield* h.service.login(password(), "owner").pipe(Effect.forkScoped);
      yield* h.ready;
      h.data("Password Depot Passwort: ");
      h.data("\r\nTOTP-Code: ");
      const challenge = yield* Fiber.join(login);
      if (challenge.phase !== "totp") throw new Error("Missing challenge");
      expect((yield* h.service.login(password(), "other").pipe(Effect.flip)).reason).toBe("busy");
      expect(
        (yield* h.service
          .respond({ flowId: challenge.flowId, code: Redacted.make("123456") }, "other")
          .pipe(Effect.flip)).reason,
      ).toBe("expired");
      yield* h.service.cancel("other");
      expect(h.killed()).toBe(0);
      yield* h.service.cancel("owner");
      expect(h.killed()).toBe(1);
      expect(h.listeners()).toBe(0);
      expect(
        (yield* h.service
          .respond({ flowId: challenge.flowId, code: Redacted.make("123456") }, "owner")
          .pipe(Effect.flip)).reason,
      ).toBe("expired");
    }),
  );

  it.effect("does not send a password to a configuration prompt", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness();
      const login = yield* h.service
        .login(password(), "owner")
        .pipe(Effect.flip, Effect.forkScoped);
      yield* h.ready;
      h.data("Benutzername: ");
      yield* TestClock.adjust("10 seconds");
      expect((yield* Fiber.join(login)).reason).toBe("configuration");
      expect(h.writes).toEqual([]);
      expect(h.killed()).toBe(1);
    }),
  );

  it.effect("expires an unanswered TOTP challenge", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness();
      const login = yield* h.service.login(password(), "owner").pipe(Effect.forkScoped);
      yield* h.ready;
      h.data("Password Depot Passwort: ");
      h.data("\r\nTOTP-Code: ");
      const challenge = yield* Fiber.join(login);
      if (challenge.phase !== "totp") throw new Error("Missing challenge");
      yield* TestClock.adjust("5 minutes");
      expect(h.killed()).toBe(1);
      expect(
        (yield* h.service
          .respond({ flowId: challenge.flowId, code: Redacted.make("123456") }, "owner")
          .pipe(Effect.flip)).reason,
      ).toBe("expired");
    }),
  );

  it.effect("cancels a pending password request and frees the process", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness();
      const login = yield* h.service
        .login(password(), "owner")
        .pipe(Effect.flip, Effect.forkScoped);
      yield* h.ready;
      yield* h.service.cancel("owner");
      expect((yield* Fiber.join(login)).reason).toBe("cancelled");
      expect(h.killed()).toBe(1);
      expect(h.listeners()).toBe(0);
    }),
  );

  it.effect("executes a tilde path containing spaces exactly once after a valid login", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness();
      const fs = yield* FileSystem.FileSystem;
      yield* fs.writeFileString(
        `${h.home}/script with spaces.sh`,
        'printf "done\\n" >> result.txt\n',
      );
      yield* h.configureScript("~/script with spaces.sh");
      h.useRealScript();
      h.setCode(0);
      yield* h.service.status();
      expect(h.checks).toHaveLength(1);
      const login = yield* h.service.login(password(), "owner").pipe(Effect.forkScoped);
      yield* h.ready;
      h.data("Password Depot Passwort: ");
      h.exit(0);
      expect(yield* Fiber.join(login)).toEqual({ phase: "connected" });
      expect(yield* fs.readFileString(`${h.home}/result.txt`)).toBe("done\n");
      expect(h.checks.at(-1)).toMatchObject({
        command: `${h.home}/bash`,
        args: [`${h.home}/script with spaces.sh`],
        options: { cwd: h.home, stdin: "ignore", stdout: "ignore", stderr: "ignore" },
      });
      expect(JSON.stringify(h.checks)).not.toMatch(/synthetic-password|123456/);
      yield* h.service.status();
      expect(yield* fs.readFileString(`${h.home}/result.txt`)).toBe("done\n");
    }),
  );

  it.effect(
    "does not run the configured script after rejected authentication or an invalid cache",
    () =>
      Effect.gen(function* () {
        const h = yield* makeHarness();
        yield* h.configureScript("~/missing.sh");
        for (const exitCode of [1, 0]) {
          const login = yield* h.service
            .login(password(), "owner")
            .pipe(Effect.flip, Effect.forkScoped);
          yield* h.ready;
          h.data("Password Depot Passwort: ");
          h.exit(exitCode);
          expect((yield* Fiber.join(login)).reason).toBe("login_failed");
        }
        expect(h.checks).toHaveLength(1);
      }),
  );

  it.effect.each(["~/missing.sh", "relative.sh", "~/"])(
    "reports an unusable post-login path: %s",
    (scriptPath) =>
      Effect.gen(function* () {
        const h = yield* makeHarness();
        yield* h.configureScript(scriptPath);
        h.setCode(0);
        const login = yield* h.service
          .login(password(), "owner")
          .pipe(Effect.flip, Effect.forkScoped);
        yield* h.ready;
        h.data("Password Depot Passwort: ");
        h.exit(0);
        expect((yield* Fiber.join(login)).reason).toBe("post_login_failed");
        expect(yield* h.service.status()).toEqual({ state: "connected" });
      }),
  );

  it.effect(
    "reports a real script failure without leaking output or treating it as login failure",
    () =>
      Effect.gen(function* () {
        const h = yield* makeHarness();
        const fs = yield* FileSystem.FileSystem;
        yield* fs.writeFileString(
          `${h.home}/failure.sh`,
          'printf "token=private-value\\n" >&2\nexit 7\n',
        );
        yield* h.configureScript(`${h.home}/failure.sh`);
        h.useRealScript();
        h.setCode(0);
        const login = yield* h.service
          .login(password(), "owner")
          .pipe(Effect.flip, Effect.forkScoped);
        yield* h.ready;
        h.data("Password Depot Passwort: ");
        h.exit(0);
        const error = yield* Fiber.join(login);
        expect(error.reason).toBe("post_login_failed");
        expect(JSON.stringify(error)).not.toContain("private-value");
        yield* h.configureScript("");
        const retry = yield* h.service.login(password(), "owner").pipe(Effect.forkScoped);
        yield* h.ready;
        h.data("Password Depot Passwort: ");
        h.exit(0);
        expect(yield* Fiber.join(retry)).toEqual({ phase: "connected" });
      }),
  );

  it.effect.each(["cancel", "timeout"] as const)(
    "waits for the script, rejects concurrent sign-in, and interrupts on %s",
    (end) =>
      Effect.gen(function* () {
        const h = yield* makeHarness();
        const fs = yield* FileSystem.FileSystem;
        yield* fs.writeFileString(`${h.home}/wait.sh`, "exit 0\n");
        yield* h.configureScript("~/wait.sh");
        h.hangScript();
        h.setCode(0);
        const login = yield* h.service
          .login(password(), "owner")
          .pipe(Effect.flip, Effect.forkScoped);
        yield* h.ready;
        h.data("Password Depot Passwort: ");
        h.exit(0);
        yield* h.scriptReady;
        expect((yield* h.service.login(password(), "other").pipe(Effect.flip)).reason).toBe("busy");
        yield* h.service.cancel("other");
        expect(h.interruptedScript()).toBe(false);
        if (end === "cancel") yield* h.service.cancel("owner");
        else yield* TestClock.adjust("10 minutes");
        expect((yield* Fiber.join(login)).reason).toBe(
          end === "cancel" ? "cancelled" : "post_login_failed",
        );
        expect(h.interruptedScript()).toBe(true);
        expect(h.listeners()).toBe(0);
      }),
  );
});
