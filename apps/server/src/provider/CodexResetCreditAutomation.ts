import type { ServerProviderUsageLimits, ServerSettings } from "@t3tools/contracts";
import type { ProviderInstance } from "@t3tools/provider-core/server/driver";
import { weeklyLimitWindow } from "@t3tools/shared/usageLimits";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";

import * as Settings from "../serverSettings.ts";
import * as ProviderInstanceRegistry from "./ProviderInstanceRegistry.ts";

type ResetSettings = Pick<
  ServerSettings,
  "mggmCodexAutoRedeemExpiringResets" | "mggmCodexAutoRedeemAtWeeklyLimit"
>;
type ResetInstance = Pick<
  ProviderInstance,
  "instanceId" | "driverKind" | "enabled" | "consumeResetCredit"
> & {
  readonly snapshot: Pick<ProviderInstance["snapshot"], "getSnapshot" | "refresh">;
};

/** Unknown, expired and model-specific limits cannot authorize spending account credit. */
export function automaticResetReason(
  limits: ServerProviderUsageLimits,
  settings: ResetSettings,
  now: number,
): "expiring" | "weeklyLimit" | null {
  if (limits.unavailable || !(limits.resetCredits && limits.resetCredits.availableCount > 0))
    return null;
  const expiresAt = limits.resetCredits.nextExpiresAt
    ? Date.parse(limits.resetCredits.nextExpiresAt)
    : null;
  if (expiresAt !== null && Number.isFinite(expiresAt) && expiresAt <= now) return null;
  if (
    settings.mggmCodexAutoRedeemExpiringResets &&
    expiresAt !== null &&
    Number.isFinite(expiresAt) &&
    expiresAt - now <= 60 * 60_000
  )
    return "expiring";
  const weekly = weeklyLimitWindow(limits);
  if (
    settings.mggmCodexAutoRedeemAtWeeklyLimit &&
    weekly &&
    weekly.usedPercent >= 100 &&
    (!weekly.resetsAt || Date.parse(weekly.resetsAt) > now)
  )
    return "weeklyLimit";
  return null;
}

export class CodexResetCreditAutomation extends Context.Service<
  CodexResetCreditAutomation,
  {
    readonly check: (instance: ResetInstance) => Effect.Effect<void>;
    readonly start: Effect.Effect<
      void,
      never,
      Scope.Scope | ProviderInstanceRegistry.ProviderInstanceRegistry
    >;
  }
>()("t3/provider/CodexResetCreditAutomation") {}

const make = Effect.gen(function* () {
  const settingsService = yield* Settings.ServerSettingsService;
  const lock = yield* Semaphore.make(1);
  const check = Effect.fn("CodexResetCreditAutomation.check")(
    function* (instance: ResetInstance) {
      if (instance.driverKind !== "codex" || !instance.enabled || !instance.consumeResetCredit)
        return;
      const settings = yield* settingsService.getSettings;
      if (!settings.mggmCodexAutoRedeemExpiringResets && !settings.mggmCodexAutoRedeemAtWeeklyLimit)
        return;
      let snapshot = yield* instance.snapshot.getSnapshot;
      const now = yield* Clock.currentTimeMillis;
      const checkedAt = Date.parse(snapshot.usageLimits?.checkedAt ?? "");
      // Provider health work may be paused without a client; expiry protection must keep running.
      if (!Number.isFinite(checkedAt) || now - checkedAt >= 5 * 60_000) {
        snapshot = yield* instance.snapshot.refresh;
      }
      if (
        !snapshot.enabled ||
        !snapshot.installed ||
        snapshot.auth.status !== "authenticated" ||
        !snapshot.usageLimits
      )
        return;
      const reason = automaticResetReason(snapshot.usageLimits, settings, now);
      if (!reason) return;
      const clock = yield* Clock.Clock;
      const outcome = yield* instance.consumeResetCredit({
        onlyIf: (limits) =>
          automaticResetReason(limits, settings, clock.currentTimeMillisUnsafe()) !== null,
      });
      yield* Effect.logInfo("Automatic Codex banked reset checked.", {
        instanceId: instance.instanceId,
        reason,
        outcome,
      });
    },
    lock.withPermits(1),
    (effect, instance) =>
      effect.pipe(
        Effect.catchCause(() =>
          Effect.logWarning("Automatic Codex banked reset failed.", {
            instanceId: instance.instanceId,
          }),
        ),
      ),
  );

  const start = Effect.gen(function* () {
    const registry = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
    const scan = Effect.gen(function* () {
      for (const instance of yield* registry.listInstances) yield* check(instance);
    });
    yield* scan.pipe(Effect.repeat(Schedule.spaced("1 minute")), Effect.forkScoped);
  });
  return CodexResetCreditAutomation.of({ check, start });
});

export const layer = Layer.effect(CodexResetCreditAutomation, make);
