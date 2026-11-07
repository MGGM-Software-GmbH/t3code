import { describe, expect, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type ServerProviderUsageLimits,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

import * as Settings from "../serverSettings.ts";
import * as Automation from "./CodexResetCreditAutomation.ts";
import * as Registry from "./ProviderInstanceRegistry.ts";

const NOW = Date.parse("2026-11-07T12:00:00.000Z");
const iso = (offset: number) => DateTime.formatIso(DateTime.makeUnsafe(NOW + offset));
const HOUR = 60 * 60_000;
const settings = {
  ...DEFAULT_SERVER_SETTINGS,
  mggmCodexAutoRedeemExpiringResets: true,
  mggmCodexAutoRedeemAtWeeklyLimit: false,
};
function limits(offset = HOUR, usedPercent = 50): ServerProviderUsageLimits {
  return {
    checkedAt: iso(0),
    resetCredits: { availableCount: 2, nextExpiresAt: iso(offset) },
    windows: [
      { id: "secondary", kind: "weekly", label: "Weekly", usedPercent, resetsAt: iso(HOUR * 24) },
    ],
  };
}

describe("automatic banked reset decisions", () => {
  it.each([
    [HOUR + 1, null],
    [HOUR, "expiring"],
    [1, "expiring"],
    [0, null],
    [-1, null],
  ] as const)("checks the expiry boundary at %s ms", (offset, expected) => {
    expect(Automation.automaticResetReason(limits(offset), settings, NOW)).toBe(expected);
  });

  it.each([false, true])("respects weekly-limit opt-in %s", (enabled) => {
    const config = { ...settings, mggmCodexAutoRedeemAtWeeklyLimit: enabled };
    expect(Automation.automaticResetReason(limits(HOUR * 24, 100), config, NOW)).toBe(
      enabled ? "weeklyLimit" : null,
    );
    expect(Automation.automaticResetReason(limits(HOUR * 24, 99.9), config, NOW)).toBe(null);
  });

  it("requires credits and available limits for either automation", () => {
    const both = { ...settings, mggmCodexAutoRedeemAtWeeklyLimit: true };
    const current = limits(HOUR, 100);
    for (const resetCredits of [undefined, { availableCount: 0, nextExpiresAt: iso(HOUR) }]) {
      expect(Automation.automaticResetReason({ ...current, resetCredits }, both, NOW)).toBe(null);
    }
    expect(
      Automation.automaticResetReason(
        { ...current, unavailable: { reason: "probeFailed" } },
        both,
        NOW,
      ),
    ).toBe(null);
    expect(
      Automation.automaticResetReason(
        current,
        {
          ...both,
          mggmCodexAutoRedeemExpiringResets: false,
          mggmCodexAutoRedeemAtWeeklyLimit: false,
        },
        NOW,
      ),
    ).toBe(null);
  });

  it("does not substitute session or model-specific limits for the account's weekly limit", () => {
    const both = { ...settings, mggmCodexAutoRedeemAtWeeklyLimit: true };
    const current = limits(HOUR * 24, 20);
    const modelLimit = { ...current.windows[0]!, id: "gpt-6.1-sol", usedPercent: 100 };
    const session = {
      ...modelLimit,
      id: "primary",
      kind: "session" as const,
      windowDurationMins: 300,
    };
    expect(
      Automation.automaticResetReason(
        { ...current, windows: [...current.windows, modelLimit, session] },
        both,
        NOW,
      ),
    ).toBe(null);
    expect(
      Automation.automaticResetReason({ ...current, windows: [modelLimit, session] }, both, NOW),
    ).toBe(null);
  });

  it("does not treat elapsed quota windows as exhausted and handles unreported expiries", () => {
    const both = { ...settings, mggmCodexAutoRedeemAtWeeklyLimit: true };
    const current = limits(HOUR * 24, 100);
    expect(
      Automation.automaticResetReason(
        { ...current, windows: [{ ...current.windows[0]!, resetsAt: iso(-1) }] },
        both,
        NOW,
      ),
    ).toBe(null);
    expect(
      Automation.automaticResetReason(
        { ...current, resetCredits: { availableCount: 1 } },
        settings,
        NOW,
      ),
    ).toBe(null);
    expect(
      Automation.automaticResetReason(
        { ...current, resetCredits: { availableCount: 1 } },
        both,
        NOW,
      ),
    ).toBe("weeklyLimit");
  });
});

it.effect(
  "rechecks fresh account limits, skips duplicate aliases and reacts to changed settings",
  () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      let config = { ...settings };
      let fresh = limits(HOUR, 100);
      let consumptions = 0;
      let checks = 0;
      const snapshot = {
        instanceId: ProviderInstanceId.make("codex-test"),
        driver: ProviderDriverKind.make("codex"),
        enabled: true,
        installed: true,
        auth: { status: "authenticated" as const },
        usageLimits: limits(HOUR, 100),
      } as ServerProvider;
      const instance: Parameters<Automation.CodexResetCreditAutomation["Service"]["check"]>[0] = {
        instanceId: snapshot.instanceId,
        driverKind: snapshot.driver,
        enabled: true,
        snapshot: { getSnapshot: Effect.succeed(snapshot), refresh: Effect.succeed(snapshot) },
        consumeResetCredit: (options) =>
          Effect.sync(() => {
            checks += 1;
            if (options?.onlyIf && !options.onlyIf(fresh)) return "nothingToReset" as const;
            consumptions += 1;
            fresh = {
              ...limits(HOUR * 24, 0),
              resetCredits: { availableCount: 1, nextExpiresAt: iso(HOUR * 24) },
            };
            return "reset" as const;
          }),
      };
      const layer = Automation.layer.pipe(
        Layer.provide(
          Layer.mock(Settings.ServerSettingsService)({
            getSettings: Effect.sync(() => config),
          }),
        ),
      );
      yield* Effect.gen(function* () {
        const automation = yield* Automation.CodexResetCreditAutomation;
        yield* automation.check(instance);
        yield* automation.check({
          ...instance,
          instanceId: ProviderInstanceId.make("same-account-alias"),
        });
        expect(checks).toBe(2);
        expect(consumptions).toBe(1);
        config = { ...settings, mggmCodexAutoRedeemExpiringResets: false };
        fresh = limits(HOUR, 100);
        yield* automation.check(instance);
        expect(checks).toBe(2);
        config = { ...config, mggmCodexAutoRedeemAtWeeklyLimit: true };
        yield* automation.check(instance);
        expect(consumptions).toBe(2);
        yield* automation.check({ ...instance, enabled: false });
        yield* automation.check({ ...instance, driverKind: ProviderDriverKind.make("claudeCode") });
        expect(consumptions).toBe(2);
        yield* automation.check({
          ...instance,
          snapshot: { ...instance.snapshot, getSnapshot: Effect.die("synthetic refresh failure") },
        });
        fresh = limits(HOUR, 100);
        yield* automation.check(instance);
        expect(consumptions).toBe(3);
        yield* automation.check({
          ...instance,
          snapshot: {
            getSnapshot: Effect.succeed({
              ...snapshot,
              usageLimits: { ...snapshot.usageLimits!, checkedAt: iso(-6 * 60_000) },
            }),
            refresh: Effect.succeed({ ...snapshot, auth: { status: "unauthenticated" } }),
          },
        });
        expect(consumptions).toBe(3);
        expect(yield* Clock.currentTimeMillis).toBe(NOW);
      }).pipe(Effect.provide(layer));
    }),
);

it.effect("scans once a minute without a browser connection", () =>
  Effect.gen(function* () {
    const first = yield* Deferred.make<void>();
    const second = yield* Deferred.make<void>();
    const observations: number[] = [];
    const registry = Layer.mock(Registry.ProviderInstanceRegistry)({
      listInstances: Effect.gen(function* () {
        observations.push(yield* Clock.currentTimeMillis);
        yield* Deferred.succeed(observations.length === 1 ? first : second, undefined);
        return [];
      }),
    });
    yield* Effect.gen(function* () {
      const automation = yield* Automation.CodexResetCreditAutomation;
      yield* automation.start;
      yield* Deferred.await(first);
      expect(observations).toEqual([0]);
      yield* TestClock.adjust("59 seconds");
      expect(observations).toHaveLength(1);
      yield* TestClock.adjust("1 second");
      yield* Deferred.await(second);
      expect(observations).toEqual([0, 60_000]);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Automation.layer.pipe(Layer.provide(Layer.mock(Settings.ServerSettingsService)({}))),
          registry,
        ),
      ),
    );
  }).pipe(Effect.scoped),
);
