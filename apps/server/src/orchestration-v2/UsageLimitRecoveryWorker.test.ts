import { assert, describe, it } from "@effect/vitest";
import { CommandId, RunId, ThreadId, type OrchestrationV2DomainEvent } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import { MODEL_CAPACITY_ERROR_MESSAGE } from "@t3tools/shared/orchestrationV2ThreadError";
import type { ProjectionLimitRecoveryCandidate } from "./ProjectionStore.ts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as Scheduler from "../scheduling/Scheduler.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";
import * as UsageLimitRecoveryWorker from "./UsageLimitRecoveryWorker.ts";
import { limitRecoveryCommand } from "./UsageLimitRecoveryWorker.ts";

it.effect("idle sweeps skip SQL until the next wake time or a relevant event", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse("2026-07-01T09:00:00.000Z"));
    const startMs = Date.parse("2026-07-01T09:00:00.000Z");
    const queries = yield* Queue.unbounded<number>();
    const events = yield* Queue.unbounded<OrchestrationV2DomainEvent>();
    const layer = UsageLimitRecoveryWorker.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Scheduler.layer,
          Layer.mock(ProjectionStore.ProjectionStoreV2)({
            getLimitRecoveryCandidates: () =>
              Clock.currentTimeMillis.pipe(
                Effect.flatMap((nowMs) => Queue.offer(queries, nowMs - startMs)),
                Effect.as([]),
              ),
            // One armed thread resets at 60s.
            getLimitRecoveryWakeAt: (now) =>
              Effect.succeed(
                DateTime.toEpochMillis(now) < startMs + 60_000 ? startMs + 60_000 : null,
              ),
          }),
          Layer.mock(ThreadManagement.ThreadManagementService)({}),
          Layer.mock(Orchestrator.OrchestratorV2)({
            streamDomainEvents: Stream.fromQueue(events),
          }),
          Layer.mock(ServerSettings.ServerSettingsService)({
            getSettings: Effect.succeed({
              autoResumeLimitedThreads: true,
              snoozeLimitedThreads: false,
            } as never),
            streamChanges: Stream.never,
          }),
        ),
      ),
    );
    yield* Effect.gen(function* () {
      assert.equal(yield* Queue.take(queries), 0);
      // Eleven idle ticks before the recorded wake time, then the wake tick itself.
      yield* TestClock.adjust("60 seconds");
      assert.equal(yield* Queue.take(queries), 60_000);
      yield* Queue.offer(events, {
        type: "turn-item.updated",
        payload: { type: "assistant_message" },
      } as never);
      yield* TestClock.adjust("30 seconds");
      yield* Queue.offer(events, { type: "run.updated", payload: { status: "failed" } } as never);
      yield* TestClock.adjust("5 seconds");
      // A streaming item at 90s does not wake it; the failed run does on the 95s tick.
      assert.equal(yield* Queue.take(queries), 95_000);
    }).pipe(Effect.provide(layer));
  }),
);

const HOUR_MS = 60 * 60 * 1000;
const nowMs = Date.parse("2026-10-19T12:00:00.000Z");

const failedThread = (failedAgoMs: number, resetAgoMs: number) => {
  const failedAt = DateTime.makeUnsafe(nowMs - failedAgoMs);
  const candidate: ProjectionStore.ProjectionLimitRecoveryCandidate = {
    id: ThreadId.make("thread:limited"),
    status: "failed",
    lastErrorClass: "usage_limit",
    usageLimitResetAt: DateTime.formatIso(DateTime.makeUnsafe(nowMs - resetAgoMs)),
    latestRunId: RunId.make("run:limited"),
    latestRunCompletedAt: failedAt,
    updatedAt: failedAt,
    archivedAt: null,
    settledOverride: null,
    pendingRuntimeRequest: null,
    limitRecovery: null,
    snoozedUntil: null,
  };
  return candidate;
};

describe("limitRecoveryCommand arming", () => {
  it("does not freshly arm a failure whose reset passed days ago", () => {
    const thread = failedThread(5 * 24 * HOUR_MS, 4 * 24 * HOUR_MS);
    assert.isNull(limitRecoveryCommand(thread, true, nowMs));
    assert.isNull(limitRecoveryCommand(thread, true, nowMs, true));
  });

  it("still arms a failure whose reset only just passed", () => {
    const thread = failedThread(6 * HOUR_MS, HOUR_MS);
    const arm = limitRecoveryCommand(thread, true, nowMs);
    assert.equal(arm?.type, "thread.metadata.update");
  });

  it("arms a reset that is exactly 24 hours overdue", () => {
    const thread = failedThread(30 * HOUR_MS, 24 * HOUR_MS);
    const arm = limitRecoveryCommand(thread, true, nowMs);
    assert.equal(arm?.type, "thread.metadata.update");
  });

  it("does not arm a reset that is 24 hours and 1ms overdue", () => {
    const thread = failedThread(30 * HOUR_MS, 24 * HOUR_MS + 1);
    assert.isNull(limitRecoveryCommand(thread, true, nowMs));
  });
});

const stoppedAt = DateTime.makeUnsafe("2026-10-19T08:00:00.000Z");
const stoppedAtMs = DateTime.toEpochMillis(stoppedAt);
const retryAt = "2026-10-19T08:05:00.000Z";
const candidate: ProjectionLimitRecoveryCandidate = {
  id: ThreadId.make("capacity:thread"),
  status: "failed",
  lastErrorClass: "provider_error",
  lastError: MODEL_CAPACITY_ERROR_MESSAGE,
  latestRunId: RunId.make("capacity:run"),
  latestRunCompletedAt: stoppedAt,
  updatedAt: stoppedAt,
  usageLimitResetAt: null,
  archivedAt: null,
  settledOverride: null,
  pendingRuntimeRequest: null,
  limitRecovery: null,
  snoozedUntil: null,
};

function arm(thread = candidate, minutes = 5) {
  const command = limitRecoveryCommand(thread, false, stoppedAtMs, true, minutes);
  assert.equal(command?.type, "thread.metadata.update");
  if (command?.type !== "thread.metadata.update" || !command.limitRecovery)
    throw new Error("Expected a persisted recovery choice");
  return {
    ...thread,
    limitRecovery: {
      ...command.limitRecovery,
      autoResume: command.limitRecovery.autoResume ?? false,
      requestId: command.commandId,
    },
  };
}

it("retries capacity stops after five minutes independently of usage-limit preferences", () => {
  const armed = arm();
  assert.equal(armed.limitRecovery.resetAt, retryAt);
  assert.isTrue(armed.limitRecovery.autoResume);
  assert.isFalse(armed.limitRecovery.snooze);
  assert.isNull(limitRecoveryCommand(armed, false, Date.parse(retryAt) - 1, false, 5));
  const resume = limitRecoveryCommand(armed, false, Date.parse(retryAt), false, 5);
  assert.equal(resume?.type, "message.dispatch");
  assert.notProperty(resume, "modelSelection");
  assert.notProperty(resume, "providerInstanceId");
  assert.propertyVal(resume, "usageLimitContinuationOfRunId", candidate.latestRunId);
});

it("zero disables both new and already-scheduled capacity retries", () => {
  assert.isNull(limitRecoveryCommand(candidate, true, stoppedAtMs, false, 0));
  assert.isNull(limitRecoveryCommand(arm(), true, Date.parse(retryAt), false, 0));
});

it("preserves per-thread cancellation and persisted deadlines across settings changes", () => {
  const armed = arm(candidate, 10);
  const cancelled = { ...armed, limitRecovery: { ...armed.limitRecovery, autoResume: false } };
  assert.isNull(limitRecoveryCommand(cancelled, true, stoppedAtMs + 900_000, false, 5));
  assert.isNull(limitRecoveryCommand(armed, true, Date.parse(retryAt), false, 5));
  assert.equal(
    limitRecoveryCommand(armed, true, stoppedAtMs + 600_000, false, 5)?.type,
    "message.dispatch",
  );
});

it.each(["Authentication failed", "Model not found", "Selected model is unavailable", null])(
  "does not retry unrelated provider errors: %s",
  (message) => {
    assert.isNull(
      limitRecoveryCommand({ ...candidate, lastError: message }, true, stoppedAtMs, false, 5),
    );
  },
);

it("anchors each repeated capacity stop to its own completion instead of the scheduler time", () => {
  const previous = arm();
  const stoppedAgain = {
    ...previous,
    latestRunId: RunId.make("capacity:second-run"),
    latestRunCompletedAt: DateTime.add(stoppedAt, { minutes: 6 }),
  };
  const scheduled = arm(stoppedAgain);
  assert.equal(scheduled.limitRecovery.resetAt, "2026-10-19T08:11:00.000Z");
  assert.notEqual(scheduled.limitRecovery.requestId, previous.limitRecovery.requestId);
});

it("retains usage-limit reset recovery when capacity retries are disabled", () => {
  const limited = {
    ...candidate,
    lastErrorClass: "usage_limit" as const,
    lastError: "Plan limit reached.",
    usageLimitResetAt: retryAt,
  };
  const scheduled = limitRecoveryCommand(limited, true, stoppedAtMs, false, 0);
  assert.equal(scheduled?.type, "thread.metadata.update");
});

it("does not dispatch stopped, archived, settled, or already-running threads", () => {
  const armed = arm();
  for (const change of [
    { status: "running" as const },
    { archivedAt: stoppedAt },
    { settledOverride: "settled" as const },
    {
      limitRecovery: {
        ...armed.limitRecovery,
        autoResume: false,
        requestId: CommandId.make("cancel"),
      },
    },
  ]) {
    assert.isNull(
      limitRecoveryCommand({ ...armed, ...change }, true, Date.parse(retryAt), false, 5),
    );
  }
});
