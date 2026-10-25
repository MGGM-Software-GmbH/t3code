import { assert, it } from "@effect/vitest";
import { CommandId, RunId, ThreadId } from "@t3tools/contracts";
import { MODEL_CAPACITY_ERROR_MESSAGE } from "@t3tools/shared/orchestrationV2ThreadError";
import * as DateTime from "effect/DateTime";

import type { ProjectionLimitRecoveryCandidate } from "./ProjectionStore.ts";
import { limitRecoveryCommand } from "./UsageLimitRecoveryWorker.ts";

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
