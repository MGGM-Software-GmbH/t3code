import {
  CodexSettings,
  type ProviderInstanceId,
  type ServerProviderUsageLimits,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { weeklyLimitWindow } from "@t3tools/shared/usageLimits";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import { mergeProviderInstanceEnvironment } from "@t3tools/provider-core/server/instanceEnvironment";
import { expandHomePath } from "@t3tools/provider-core/server/pathExpansion";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as ServerConfig from "../config.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ProviderInstanceRegistry from "./ProviderInstanceRegistry.ts";
import { withCodexAppServerClient } from "./CodexProvider.ts";
import { codexRateLimitsToLimits } from "./codexUsageLimits.ts";
import { resolveCodexHomeLayout } from "./Drivers/CodexHomeLayout.ts";

const HOUR = 60 * 60_000;
const WEEK = 7 * 24 * HOUR;
const ACTIVE_MARGIN = 5 * 60_000;
const PROMPT = "First run pwd using the shell tool. Then reply with only OK.";
const State = Schema.Struct({
  checkedAt: Schema.Number,
  outcome: Schema.Literals(["checked", "running", "started", "failed"]),
});
const encodeState = Schema.encodeEffect(Schema.fromJsonString(State));
const decodeState = Schema.decodeUnknownEffect(Schema.fromJsonString(State));
const decodeConfig = Schema.decodeUnknownEffect(CodexSettings);

export class CodexWeeklyWindowStartError extends Schema.TaggedError<CodexWeeklyWindowStartError>()(
  "CodexWeeklyWindowStartError",
  {
    stage: Schema.Literals(["limits", "invocation", "confirmation", "state"]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Codex weekly window start failed at ${this.stage}.`;
  }
}
const isWeeklyWindowStartError = Schema.is(CodexWeeklyWindowStartError);

interface AccountInput {
  readonly instanceId: ProviderInstanceId;
  readonly config: CodexSettings;
  readonly environment: NodeJS.ProcessEnv;
  readonly publish: (limits: ServerProviderUsageLimits) => Effect.Effect<void>;
}

/** A fixed reset already inside the seven-day period needs no model request. */
export function needsWeeklyWindowStart(limits: ServerProviderUsageLimits, now: number): boolean {
  const window = weeklyLimitWindow(limits);
  if (!window || window.usedPercent > 0.001 || window.resetsAt === undefined) return false;
  const remaining = Date.parse(window.resetsAt) - now;
  // A missing, expired or implausibly distant timestamp does not prove a new window.
  return (
    Number.isFinite(remaining) &&
    remaining >= WEEK - ACTIVE_MARGIN &&
    remaining <= WEEK + ACTIVE_MARGIN
  );
}

export class CodexWeeklyWindowStarter extends Context.Service<
  CodexWeeklyWindowStarter,
  {
    readonly check: (
      input: AccountInput,
    ) => Effect.Effect<"checked" | "started" | "cooldown", CodexWeeklyWindowStartError>;
    readonly start: Effect.Effect<
      void,
      never,
      | Scope.Scope
      | ProviderInstanceRegistry.ProviderInstanceRegistry
      | ServerSettings.ServerSettingsService
    >;
  }
>()("t3/provider/CodexWeeklyWindowStarter") {}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const home = yield* HostProcess.HomeDirectory;
  const userId = yield* HostProcess.UserId;
  const server = yield* ServerConfig.ServerConfig;
  // One server-owned lock serializes checks, CLI starts and confirmation reads,
  // including instances that refer to the same account home.
  const lock = yield* Semaphore.make(1);
  const services = Layer.mergeAll(
    Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner),
    Layer.succeed(HostProcess.HomeDirectory, home),
    Layer.succeed(FileSystem.FileSystem, fs),
    Layer.succeed(Path.Path, path),
  );
  const readLimits = Effect.fn("CodexWeeklyWindowStarter.readLimits")(
    function* (input: AccountInput, cwd: string) {
      const { client } = yield* withCodexAppServerClient({
        binaryPath: input.config.binaryPath,
        homePath: input.config.homePath,
        launchArgs: "",
        cwd,
        environment: input.environment,
      });
      const account = (yield* client.request("account/read", {})).account;
      if (account?.type !== "chatgpt") return null;
      const response = yield* client.request("account/rateLimits/read", null);
      const limits = codexRateLimitsToLimits({
        snapshot: response.rateLimits,
        rateLimitsByLimitId: response.rateLimitsByLimitId,
        resetCredits: response.rateLimitResetCredits,
        checkedAt: DateTime.formatIso(yield* DateTime.now),
      });
      return { limits, identity: `${account.email}:${response.accountId ?? ""}` };
    },
    Effect.scoped,
    Effect.timeout("20 seconds"),
    Effect.provide(services),
    Effect.mapError((cause) => new CodexWeeklyWindowStartError({ stage: "limits", cause })),
  );

  const invoke = Effect.fn("CodexWeeklyWindowStarter.invoke")(
    function* (input: AccountInput, cwd: string) {
      const environment: NodeJS.ProcessEnv = {
        HOME: cwd,
        CODEX_HOME: input.config.homePath,
        NO_COLOR: "1",
        TERM: "dumb",
      };
      for (const name of [
        "PATH",
        "LANG",
        "LC_ALL",
        "SystemRoot",
        "WINDIR",
        "PATHEXT",
        "CODEX_SQLITE_HOME",
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "NO_PROXY",
        "SSL_CERT_FILE",
        "SSL_CERT_DIR",
        "NODE_EXTRA_CA_CERTS",
      ]) {
        if (input.environment[name] !== undefined) environment[name] = input.environment[name];
      }
      const command = yield* resolveSpawnCommand(
        input.config.binaryPath,
        [
          "exec",
          "--ephemeral",
          "--ignore-user-config",
          "--ignore-rules",
          "--skip-git-repo-check",
          "--sandbox",
          "read-only",
          "--model",
          "gpt-5.6-luna",
          "--cd",
          cwd,
          PROMPT,
        ],
        { env: environment, extendEnv: false },
      );
      const child = yield* spawner.spawn(
        ChildProcess.make(command.command, command.args, {
          cwd,
          env: environment,
          extendEnv: false,
          shell: command.shell,
          stdin: "ignore",
          forceKillAfter: "2 seconds",
        }),
      );
      const [output, , code] = yield* Effect.all(
        [
          child.stdout.pipe(Stream.decodeText(), Stream.mkString),
          child.stderr.pipe(Stream.runDrain),
          child.exitCode,
        ],
        { concurrency: "unbounded" },
      );
      if (code !== 0 || output.trim() !== "OK")
        return yield* new CodexWeeklyWindowStartError({ stage: "invocation" });
    },
    Effect.scoped,
    Effect.timeout("2 minutes"),
    Effect.provide(services),
    Effect.mapError((cause) =>
      isWeeklyWindowStartError(cause)
        ? cause
        : new CodexWeeklyWindowStartError({ stage: "invocation", cause }),
    ),
  );

  const check: CodexWeeklyWindowStarter["Service"]["check"] = (input) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        if (
          !input.config.enabled ||
          !input.config.autoStartWeeklyWindow ||
          input.config.setupMode === "managed"
        )
          return "checked";
        const owner = (yield* fs.stat(input.config.homePath)).uid;
        if (userId === 0 && Option.isSome(owner) && owner.value !== userId) {
          // This process API cannot change uid. Refuse to rotate another user's
          // login as root; the T3 service must run as the profile owner.
          return yield* new CodexWeeklyWindowStartError({ stage: "invocation" });
        }
        const key = Hex.encode(
          yield* crypto.digest("SHA-256", new TextEncoder().encode(input.config.homePath)),
        );
        const stateFile = path.join(
          server.providerStatusCacheDir,
          `codex-weekly-window-${key}.json`,
        );
        const now = yield* Clock.currentTimeMillis;
        if (yield* fs.exists(stateFile)) {
          const state = yield* decodeState(yield* fs.readFileString(stateFile));
          if (now >= state.checkedAt && now - state.checkedAt < HOUR) return "cooldown";
        }
        const save = (outcome: (typeof State.Type)["outcome"]) =>
          Effect.gen(function* () {
            yield* fs.makeDirectory(server.providerStatusCacheDir, { recursive: true });
            const text = yield* encodeState({ checkedAt: now, outcome });
            yield* fs.writeFileString(`${stateFile}.tmp`, text, { mode: 0o600 });
            yield* fs.rename(`${stateFile}.tmp`, stateFile);
          });
        return yield* Effect.gen(function* () {
          const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "t3-codex-weekly-window-" });
          const before = yield* readLimits(input, cwd);
          if (!before) {
            yield* save("checked");
            return "checked";
          }
          yield* input.publish(before.limits);
          if (!needsWeeklyWindowStart(before.limits, yield* Clock.currentTimeMillis)) {
            yield* save("checked");
            return "checked";
          }
          // Persist before spawning: a service restart must not repeat an uncertain request.
          yield* save("running");
          const result = yield* Effect.gen(function* () {
            yield* invoke(input, cwd);
            let first = yield* readLimits(input, cwd);
            let observedAt = yield* Clock.currentTimeMillis;
            const deadline = observedAt + 30_000;
            while ((yield* Clock.currentTimeMillis) < deadline) {
              yield* Effect.sleep("5 seconds");
              const second = yield* readLimits(input, cwd);
              if (second) yield* input.publish(second.limits);
              const firstReset = first && weeklyLimitWindow(first.limits)?.resetsAt;
              const secondReset = second && weeklyLimitWindow(second.limits)?.resetsAt;
              const previousReset = weeklyLimitWindow(before.limits)!.resetsAt!;
              const checkedAt = yield* Clock.currentTimeMillis;
              if (
                first &&
                second &&
                first.identity === before.identity &&
                second.identity === before.identity &&
                firstReset &&
                secondReset &&
                checkedAt - observedAt >= 5000 &&
                Math.abs(Date.parse(firstReset) - Date.parse(secondReset)) <= 2000 &&
                Math.abs(Date.parse(firstReset) - Date.parse(previousReset)) > 2000 &&
                Math.abs(Date.parse(secondReset) - Date.parse(previousReset)) > 2000
              ) {
                yield* save("started");
                yield* Effect.logInfo("Codex weekly window started.", {
                  instanceId: input.instanceId,
                });
                return "started" as const;
              }
              first = second;
              observedAt = checkedAt;
            }
            return yield* new CodexWeeklyWindowStartError({ stage: "confirmation" });
          }).pipe(Effect.tapError(() => save("failed")));
          return result;
        }).pipe(Effect.scoped);
      }).pipe(
        Effect.mapError((cause) =>
          isWeeklyWindowStartError(cause)
            ? cause
            : new CodexWeeklyWindowStartError({ stage: "state", cause }),
        ),
      ),
    );

  const start = Effect.gen(function* () {
    const registry = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
    const settings = yield* ServerSettings.ServerSettingsService;
    const scan = Effect.gen(function* () {
      const current = yield* settings.getSettings;
      for (const instance of yield* registry.listInstances) {
        if (instance.driverKind !== "codex" || !instance.enabled) continue;
        const entry = current.providerInstances[instance.instanceId];
        if (!entry) continue;
        const config = yield* decodeConfig(entry.config);
        if (!config.autoStartWeeklyWindow || config.setupMode === "managed") continue;
        const snapshot = yield* instance.snapshot.getSnapshot;
        if (!snapshot.installed || snapshot.auth.status !== "authenticated") continue;
        const environment = yield* mergeProviderInstanceEnvironment(entry.environment).pipe(
          Effect.provideService(HostProcess.HomeDirectory, home),
        );
        const layout = yield* resolveCodexHomeLayout({
          ...config,
          homePath: config.homePath || environment.CODEX_HOME || "",
        }).pipe(
          Effect.provideService(Path.Path, path),
          Effect.provideService(HostProcess.HomeDirectory, home),
        );
        yield* check({
          instanceId: instance.instanceId,
          config: {
            ...config,
            enabled: true,
            binaryPath: expandHomePath(config.binaryPath, home),
            homePath: layout.effectiveHomePath ?? layout.sharedHomePath,
          },
          environment,
          publish: (limits) =>
            instance.snapshot.applyUsageLimits({
              windows: limits.windows,
              checkedAt: limits.checkedAt,
            }),
        }).pipe(
          Effect.catchTags({
            CodexWeeklyWindowStartError: (error) =>
              Effect.logWarning(error.message, {
                instanceId: instance.instanceId,
                stage: error.stage,
              }),
          }),
        );
      }
    }).pipe(
      Effect.catch((error) =>
        Effect.logWarning("Could not check Codex weekly windows.", { error: error._tag }),
      ),
    );
    yield* Effect.sleep("10 seconds").pipe(
      Effect.andThen(scan.pipe(Effect.repeat(Schedule.spaced("60 minutes")))),
      Effect.forkScoped,
    );
  });
  return CodexWeeklyWindowStarter.of({ check, start });
});

export const layer = Layer.effect(CodexWeeklyWindowStarter, make);
