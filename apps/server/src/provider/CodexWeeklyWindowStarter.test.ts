import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import {
  CodexSettings,
  DEFAULT_SERVER_SETTINGS,
  ProviderInstanceId,
  type ServerProviderUsageLimits,
} from "@t3tools/contracts";
import { writeFakeCli } from "@t3tools/provider-testing/fakeCli";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";
import { describe, expect } from "vite-plus/test";

import * as ServerConfig from "../config.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ProviderInstanceRegistry from "./ProviderInstanceRegistry.ts";
import * as WeeklyWindowStarter from "./CodexWeeklyWindowStarter.ts";

const WEEK = 7 * 24 * 60 * 60_000;
const NOW = Date.parse("2026-10-19T08:00:00.000Z");
const decodeConfig = Schema.decodeUnknownSync(CodexSettings);
const Fixture = Schema.Struct({
  behavior: Schema.Literals(["stable", "drifting", "failure"]),
  usedPercent: Schema.Number,
  invocations: Schema.Number,
  startedReset: Schema.optional(Schema.Number),
  args: Schema.optional(Schema.Array(Schema.String)),
  home: Schema.optional(Schema.String),
  apiKeyPresent: Schema.optional(Schema.Boolean),
  stdin: Schema.optional(Schema.String),
});
const encodeFixture = Schema.encodeSync(Schema.fromJsonString(Fixture));
const decodeFixture = Schema.decodeUnknownSync(Schema.fromJsonString(Fixture));

function limits(remainingMs: number | null, usedPercent = 0): ServerProviderUsageLimits {
  return {
    checkedAt: "2026-10-19T08:00:00.000Z",
    windows: [
      {
        id: "secondary",
        kind: "weekly",
        label: "Weekly",
        usedPercent,
        windowDurationMins: 10080,
        ...(remainingMs === null
          ? {}
          : {
              resetsAt: DateTime.formatIso(DateTime.makeUnsafe(NOW + remainingMs)),
            }),
      },
    ],
  };
}

describe("weekly window decision", () => {
  it.each([
    [WEEK, 0, true],
    [WEEK, 0.001, true],
    [WEEK, 0.01, false],
    [WEEK - 6 * 60_000, 0, false],
    [WEEK + 6 * 60_000, 0, false],
    [0, 0, false],
    [-1000, 0, false],
    [null, 0, false],
  ] as const)("checks reset %s and usage %s", (remainingMs, usedPercent, expected) => {
    expect(WeeklyWindowStarter.needsWeeklyWindowStart(limits(remainingMs, usedPercent), NOW)).toBe(
      expected,
    );
  });

  it("does not start an account from a model-only bucket", () => {
    const input = limits(WEEK);
    expect(
      WeeklyWindowStarter.needsWeeklyWindowStart(
        {
          ...input,
          windows: input.windows.map((window) => ({ ...window, id: "gpt-5.6-luna:secondary" })),
        },
        NOW,
      ),
    ).toBe(false);
  });
});

// The real child-process boundary exercises app-server framing, EOF on exec,
// and profile writes that must survive even when the CLI subsequently fails.
const FAKE_CODEX = String.raw`
import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
const statePath = path.join(process.env.CODEX_HOME, "fixture.json");
const read = () => JSON.parse(fs.readFileSync(statePath, "utf8"));
const save = (state) => fs.writeFileSync(statePath, JSON.stringify(state));
const args = process.argv.slice(2);
const week = 7 * 24 * 60 * 60_000;
if (args[0] === "exec") {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const state = read();
  state.invocations += 1;
  state.args = args;
  state.home = process.env.CODEX_HOME;
  state.apiKeyPresent = process.env.OPENAI_API_KEY !== undefined;
  state.stdin = Buffer.concat(chunks).toString("utf8");
  state.startedReset = Math.floor((Date.now() + week + 60_000) / 1000);
  save(state);
  fs.writeFileSync(path.join(process.env.CODEX_HOME, "refresh-marker"), "rotation retained");
  if (state.behavior === "failure") process.exit(3);
  process.stdout.write("OK\n");
  process.exit(0);
}
const write = (id, result) => process.stdout.write(JSON.stringify({ id, result }) + "\n");
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const { id, method } = JSON.parse(line);
  if (id === undefined) return;
  const state = read();
  if (method === "initialize") {
    write(id, { userAgent: "codex/0.162.1", codexHome: process.env.CODEX_HOME,
      platformFamily: "unix", platformOs: "linux" });
  } else if (method === "account/read") {
    write(id, { account: { type: "chatgpt", email: "fixture@example.test", planType: "pro" }, requiresOpenaiAuth: false });
  } else if (method === "account/rateLimits/read") {
    const drift = state.behavior === "drifting" || !state.invocations;
    const reset = drift ? Math.floor((Date.now() + week) / 1000)
      : state.startedReset;
    write(id, { accountId: "fixture",
      rateLimits: { secondary: { usedPercent: state.usedPercent, resetsAt: reset, windowDurationMins: 10080 } },
      rateLimitResetCredits: { availableCount: 2 } });
  } else {
    process.stdout.write(JSON.stringify({ id, error: { code: -32601, message: "Unsupported fixture request" } }) + "\n");
  }
});
`;

const layerTest = ServerConfig.layerTest(process.cwd(), { prefix: "t3-weekly-starter-" }).pipe(
  Layer.provideMerge(NodeServices.layer),
);

it.effect("scans every hour without a browser connection", () =>
  Effect.gen(function* () {
    const first = yield* Deferred.make<void>();
    const second = yield* Deferred.make<void>();
    const observations: number[] = [];
    const dependencies = Layer.mergeAll(
      Layer.mock(ServerSettings.ServerSettingsService)({
        getSettings: Effect.gen(function* () {
          observations.push(yield* Clock.currentTimeMillis);
          yield* Deferred.succeed(observations.length === 1 ? first : second, undefined);
          return DEFAULT_SERVER_SETTINGS;
        }),
      }),
      Layer.mock(ProviderInstanceRegistry.ProviderInstanceRegistry)({
        listInstances: Effect.succeed([]),
      }),
    );
    yield* Effect.gen(function* () {
      const service = yield* WeeklyWindowStarter.CodexWeeklyWindowStarter;
      yield* service.start;
      yield* TestClock.adjust("10 seconds");
      yield* Deferred.await(first);
      expect(observations).toEqual([10_000]);
      yield* TestClock.adjust(3_599_000);
      expect(observations).toHaveLength(1);
      yield* TestClock.adjust("1 second");
      yield* Deferred.await(second);
      expect(observations).toEqual([10_000, 3_610_000]);
    }).pipe(Effect.provide(Layer.mergeAll(WeeklyWindowStarter.layer, dependencies)));
  }).pipe(Effect.provide(layerTest), Effect.scoped),
);

const fixture = Effect.fn("weeklyStarterFixture")(function* (
  behavior: (typeof Fixture.Type)["behavior"] = "stable",
  usedPercent = 0,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-weekly-profile-" });
  const shadowHome = path.join(directory, "shadow");
  yield* fs.makeDirectory(shadowHome);
  const statePath = path.join(shadowHome, "fixture.json");
  yield* fs.writeFileString(statePath, encodeFixture({ behavior, usedPercent, invocations: 0 }));
  const binaryPath = writeFakeCli({
    directory: path.join(directory, "bin"),
    name: "codex",
    source: FAKE_CODEX,
  });
  const published: ServerProviderUsageLimits[] = [];
  return {
    input: {
      instanceId: ProviderInstanceId.make("codex_fixture"),
      config: decodeConfig({ binaryPath, homePath: shadowHome }),
      environment: { ...process.env, OPENAI_API_KEY: "synthetic-key-must-not-reach-exec" },
      publish: (value: ServerProviderUsageLimits) =>
        Effect.sync(() => {
          published.push(value);
        }),
    },
    published,
    read: fs.readFileString(statePath).pipe(Effect.map(decodeFixture)),
    rotation: fs.readFileString(path.join(shadowHome, "refresh-marker")),
  };
});

it.layer(layerTest, { excludeTestServices: true })("Codex weekly window starter", (it) => {
  it.effect(
    "starts the real profile once, confirms its fixed reset, and deduplicates across restart",
    () =>
      Effect.gen(function* () {
        const test = yield* fixture();
        const check = Effect.gen(function* () {
          const service = yield* WeeklyWindowStarter.CodexWeeklyWindowStarter;
          return yield* Effect.all([service.check(test.input), service.check(test.input)], {
            concurrency: 2,
          });
        }).pipe(Effect.provide(WeeklyWindowStarter.layer));
        expect(yield* check).toEqual(["started", "cooldown"]);
        const state = yield* test.read;
        expect(state.invocations).toBe(1);
        expect(state.home).toBe(test.input.config.homePath);
        expect(state.apiKeyPresent).toBe(false);
        expect(state.stdin).toBe("");
        expect(state.args).toEqual(
          expect.arrayContaining([
            "--ephemeral",
            "--ignore-user-config",
            "--ignore-rules",
            "--skip-git-repo-check",
            "--sandbox",
            "read-only",
            "--model",
            "gpt-5.6-luna",
            "First run pwd using the shell tool. Then reply with only OK.",
          ]),
        );
        expect(yield* test.rotation).toBe("rotation retained");
        expect(test.published.length).toBeGreaterThanOrEqual(2);
        expect(test.published.at(-1)?.resetCredits?.availableCount).toBe(2);
        expect(yield* check).toEqual(["cooldown", "cooldown"]);
        expect((yield* test.read).invocations).toBe(1);
      }).pipe(Effect.scoped),
    { timeout: 20_000 },
  );

  it.effect("does not spend quota when usage already exists", () =>
    Effect.gen(function* () {
      const test = yield* fixture("stable", 1);
      const service = yield* WeeklyWindowStarter.CodexWeeklyWindowStarter;
      expect(yield* service.check(test.input)).toBe("checked");
      expect((yield* test.read).invocations).toBe(0);
    }).pipe(Effect.provide(WeeklyWindowStarter.layer), Effect.scoped),
  );

  it.effect.each(["disabled", "managed"] as const)("skips %s accounts", (mode) =>
    Effect.gen(function* () {
      const test = yield* fixture();
      const service = yield* WeeklyWindowStarter.CodexWeeklyWindowStarter;
      const input = {
        ...test.input,
        config: {
          ...test.input.config,
          ...(mode === "disabled"
            ? { autoStartWeeklyWindow: false }
            : { setupMode: "managed" as const }),
        },
      };
      expect(yield* service.check(input)).toBe("checked");
      expect((yield* test.read).invocations).toBe(0);
      expect(test.published).toEqual([]);
    }).pipe(Effect.provide(WeeklyWindowStarter.layer), Effect.scoped),
  );

  it.effect("preserves a rotated login after CLI failure and waits an hour before retrying", () =>
    Effect.gen(function* () {
      const test = yield* fixture("failure");
      const service = yield* WeeklyWindowStarter.CodexWeeklyWindowStarter;
      const result = yield* service.check(test.input).pipe(Effect.result);
      expect(Result.isFailure(result) && result.failure.stage).toBe("invocation");
      expect(yield* test.rotation).toBe("rotation retained");
      expect(yield* service.check(test.input)).toBe("cooldown");
      expect((yield* test.read).invocations).toBe(1);
    }).pipe(Effect.provide(WeeklyWindowStarter.layer), Effect.scoped),
  );

  it.effect(
    "rejects a reset that still drifts after the CLI returned OK",
    () =>
      Effect.gen(function* () {
        const test = yield* fixture("drifting");
        const service = yield* WeeklyWindowStarter.CodexWeeklyWindowStarter;
        const startedAt = yield* Clock.currentTimeMillis;
        const result = yield* service.check(test.input).pipe(Effect.result);
        expect(Result.isFailure(result) && result.failure.stage).toBe("confirmation");
        expect((yield* Clock.currentTimeMillis) - startedAt).toBeGreaterThanOrEqual(30_000);
        expect((yield* test.read).invocations).toBe(1);
        expect(yield* service.check(test.input)).toBe("cooldown");
      }).pipe(Effect.provide(WeeklyWindowStarter.layer), Effect.scoped),
    { timeout: 45_000 },
  );
});
