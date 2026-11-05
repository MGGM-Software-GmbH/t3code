import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type ServerSettings,
} from "@t3tools/contracts";
import * as TestClock from "effect/testing/TestClock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import { ServerSettingsService } from "../serverSettings.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import {
  ThreadLaunchService,
  type ThreadLaunchInput,
} from "../orchestration-v2/ThreadLaunchService.ts";
import { ThreadManagementService } from "../orchestration-v2/ThreadManagementService.ts";
import { FogBugzService } from "./FogBugzService.ts";
import { FogBugzAutomation, analysisAssignment, layer } from "./FogBugzAutomation.ts";

const projectId = ProjectId.make("automation-project");
const threadId = ThreadId.make("linked-thread");
const eventAt = "2026-10-30T12:01:00.000Z";
const baselineAt = "2026-10-30T12:00:00.000Z";
const caseState = {
  id: 42,
  projectId: 12,
  resolved: false,
  open: true,
  assignedTo: 7,
  eventId: 2,
  openedAt: eventAt,
};

function fixture(mode: "initial" | "assigned" | "never" = "initial") {
  const state = {
    settings: {
      ...DEFAULT_SERVER_SETTINGS,
      defaultModelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
      fogbugzAutoAnalyze: mode,
    } as ServerSettings,
    cases: [{ ...caseState }],
    events: [
      { id: 1, verb: "Opened", assignedTo: 0, createdAt: eventAt },
      { id: 2, verb: "Assigned", assignedTo: 7, createdAt: eventAt },
    ],
    linked: false,
    active: false,
    failed: false,
    launches: [] as ThreadLaunchInput[],
    settles: [] as string[],
    unsettles: [] as string[],
    unsettleReasons: [] as string[],
  };
  const dependencies = Layer.mergeAll(
    Sqlite.layerMemory,
    Layer.mock(ServerSettingsService)({ getSettings: Effect.sync(() => state.settings) }),
    Layer.mock(FogBugzService)({
      status: () =>
        Effect.succeed({
          connection: {
            id: "test",
            baseUrl: "https://fogbugz.example/",
            personId: 7,
            personName: "Tester",
            username: "tester",
            authenticated: true,
          },
          projects: [{ projectId, fogbugzProjectId: 12, fogbugzProjectGroupId: null }],
        }),
      automationSnapshot: () =>
        Effect.succeed({
          connection: {
            id: "test",
            baseUrl: "https://fogbugz.example/",
            personId: 7,
            personName: "Tester",
            username: "tester",
            authenticated: true,
          },
          mapping: "12",
          cases: state.cases,
          threads: state.linked
            ? [
                {
                  threadId,
                  projectId,
                  caseId: 42,
                  title: "Test",
                  url: "https://fogbugz.example/default.asp?42",
                },
              ]
            : [],
        }),
      assignmentEvents: () => Effect.succeed(state.events),
      prepareThread: () =>
        Effect.succeed({
          ...caseState,
          title: "New case",
          projectName: "OPS",
          status: "1 ToDo",
          assignedToName: "Tester",
          priority: "High",
          priorityId: 1,
          categoryId: 1,
          categoryName: "Bug",
          categoryIconType: 1,
          notifiedAt: null,
          updatedAt: null,
        }),
    }),
    Layer.mock(ThreadLaunchService)({
      launch: (input) =>
        Effect.suspend(() => {
          state.launches.push(input);
          if (state.failed) return Effect.fail({ _tag: "ThreadLaunchError" } as never);
          return Effect.succeed({ threadId: input.threadId!, resumed: false } as never);
        }),
    }),
    Layer.mock(ThreadManagementService)({
      getThreadShell: () =>
        Effect.succeed({ activeRunId: state.active ? "run" : null, archivedAt: null } as never),
      settleThread: (input) =>
        Effect.sync(() => {
          state.settles.push(input.commandId);
          return { sequence: 1 };
        }),
      dispatch: (input) =>
        Effect.sync(() => {
          state.unsettles.push(input.commandId);
          if (input.type === "thread.unsettle") state.unsettleReasons.push(input.reason);
          return { sequence: 1, storedEvents: [] };
        }),
    }),
  ).pipe(Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)));
  return { state, dependencies, service: layer.pipe(Layer.provide(dependencies)) };
}

describe("FogBugz automation", () => {
  it("distinguishes initial assignment, reassignment and comment-only events", () => {
    const opened = { id: 1, verb: "Opened", assignedTo: 0, createdAt: eventAt };
    const initial = { id: 2, verb: "Assigned", assignedTo: 8, createdAt: eventAt };
    const assignment = { id: 3, verb: "Assigned", assignedTo: 7, createdAt: eventAt };
    const events = [
      opened,
      initial,
      assignment,
      { id: 4, verb: "Edited", assignedTo: 0, createdAt: eventAt },
      { id: 5, verb: "Assigned", assignedTo: 7, createdAt: eventAt },
    ];
    expect(analysisAssignment(events, 7, "initial", baselineAt)).toBeUndefined();
    expect(analysisAssignment(events, 7, "assigned", baselineAt)).toBe(assignment);
    expect(analysisAssignment(events, 7, "assigned", "2026-10-31T00:00:00.000Z")).toBeUndefined();
    expect(analysisAssignment([opened, assignment], 7, "initial", baselineAt)).toBe(assignment);
    expect(
      analysisAssignment([opened, events[3]!, assignment], 7, "initial", baselineAt),
    ).toBeUndefined();
    expect(analysisAssignment([opened, assignment], 7, "initial", eventAt)).toBeUndefined();
    expect(analysisAssignment([assignment], 7, "initial", baselineAt)).toBeUndefined();
    expect(
      analysisAssignment(
        [{ ...opened, createdAt: baselineAt }, assignment],
        7,
        "initial",
        baselineAt,
      ),
    ).toBeUndefined();
  });

  it.effect.each(["initial", "assigned"] as const)(
    "baselines existing cases and analyzes initial requirements in %s mode",
    (mode) => {
      const test = fixture(mode);
      return Effect.gen(function* () {
        const service = yield* FogBugzAutomation;
        yield* TestClock.setTime(Date.parse(baselineAt));
        yield* service.run();
        expect(test.state.launches).toHaveLength(0);
        const sql = yield* SqlClient.SqlClient;
        const rows = yield* sql<{
          payload: string;
        }>`SELECT payload FROM fogbugz_automation WHERE project_id = ${projectId}`;
        const cursor = JSON.parse(rows[0]!.payload);
        // Persisted URL-based operation identities must survive an alias change.
        cursor.identity = "http://127.0.0.1:18080|7|12";
        yield* sql`UPDATE fogbugz_automation SET payload = ${JSON.stringify(cursor)} WHERE project_id = ${projectId}`;
        test.state.cases[0] = { ...caseState, id: 43 };
        yield* service.run();
        yield* service.run();
        expect(test.state.launches).toHaveLength(1);
        expect(test.state.launches[0]).toMatchObject({
          projectId,
          interactionMode: "plan",
          modelSelection: test.state.settings.defaultModelSelection,
          reuseExistingThread: true,
        });
        expect(test.state.launches[0]!.initialMessage!.text).toContain("Do not implement changes");
        expect(test.state.launches[0]!.initialMessage!.text).toContain("FogBugz MCP");
        expect(test.state.launches[0]!.initialMessage!.text).toContain("Analyze the requirements");
        expect(test.state.launches[0]!.initialMessage!.text).not.toContain(
          "expected to contribute now",
        );
        // Reconstructing the service must use the same persisted cursor.
        yield* Effect.gen(function* () {
          yield* (yield* FogBugzAutomation).run();
        }).pipe(Effect.provide(layer));
        expect(test.state.launches).toHaveLength(1);
      }).pipe(Effect.provide(layer.pipe(Layer.provideMerge(test.dependencies))));
    },
  );

  it.effect("retries an interrupted analysis with the same IDs and stops when disabled", () => {
    const test = fixture("assigned");
    return Effect.gen(function* () {
      const service = yield* FogBugzAutomation;
      yield* TestClock.setTime(Date.parse(baselineAt));
      yield* service.run();
      test.state.cases[0] = { ...caseState, eventId: 3 };
      test.state.events = [
        { id: 1, verb: "Assigned", assignedTo: 8, createdAt: baselineAt },
        { id: 3, verb: "Assigned", assignedTo: 7, createdAt: eventAt },
      ];
      test.state.failed = true;
      yield* service.run();
      test.state.failed = false;
      yield* service.run();
      yield* service.run();
      expect(test.state.launches).toHaveLength(2);
      expect(test.state.launches[0]!.commandId).toBe(test.state.launches[1]!.commandId);
      expect(test.state.launches[0]!.threadId).toBe(test.state.launches[1]!.threadId);
      expect(test.state.launches[0]!.initialMessage!.text).toContain("expected to contribute now");
      expect(test.state.launches[0]!.initialMessage!.text).toContain("assignment event #3");
      expect(test.state.launches[0]!.initialMessage!.text).toContain("FogBugz person #7");
      expect(test.state.launches[0]!.initialMessage!.text).toContain(
        "explicit requests from inferred expectations",
      );
      expect(test.state.launches[0]!.initialMessage!.text).toContain("Do not implement changes");
      test.state.settings = { ...test.state.settings, fogbugzAutoAnalyze: "never" };
      test.state.cases[0] = { ...caseState, id: 44 };
      yield* service.run();
      expect(test.state.launches).toHaveLength(2);
    }).pipe(Effect.provide(test.service));
  });

  it.effect("settles after active work ends and unsettles on reactivation", () => {
    const test = fixture("never");
    test.state.settings = {
      ...test.state.settings,
      fogbugzAutoSettle: "resolved",
      fogbugzAutoUnsettle: true,
    };
    test.state.linked = true;
    return Effect.gen(function* () {
      const service = yield* FogBugzAutomation;
      yield* service.run();
      test.state.cases[0] = { ...caseState, resolved: true, eventId: 3 };
      test.state.active = true;
      yield* service.run();
      expect(test.state.settles).toHaveLength(0);
      test.state.active = false;
      yield* service.run();
      yield* service.run();
      expect(test.state.settles).toHaveLength(1);
      test.state.cases[0] = { ...caseState, eventId: 4 };
      yield* service.run();
      yield* service.run();
      expect(test.state.unsettles).toHaveLength(1);
      expect(test.state.unsettleReasons).toEqual(["fogbugz-reactivated"]);
      expect(test.state.launches).toHaveLength(0);
    }).pipe(Effect.provide(test.service));
  });

  it.effect("waits for closed status and respects project opt-outs", () => {
    const test = fixture("never");
    test.state.settings = { ...test.state.settings, fogbugzAutoSettle: "closed" };
    test.state.linked = true;
    return Effect.gen(function* () {
      const service = yield* FogBugzAutomation;
      yield* service.run();
      test.state.cases[0] = { ...caseState, resolved: true, eventId: 3 };
      yield* service.run();
      expect(test.state.settles).toHaveLength(0);
      test.state.settings = {
        ...test.state.settings,
        projectSettingsOverrides: { [projectId]: { fogbugzAutoSettle: "never" } },
      };
      test.state.cases[0] = { ...caseState, resolved: true, open: false, eventId: 4 };
      yield* service.run();
      expect(test.state.settles).toHaveLength(0);
      test.state.settings = { ...test.state.settings, projectSettingsOverrides: {} };
      yield* service.run();
      yield* service.run();
      expect(test.state.settles).toHaveLength(1);
    }).pipe(Effect.provide(test.service));
  });

  it.effect("retains an unprocessed assignment when a launch prerequisite is missing", () => {
    const test = fixture();
    return Effect.gen(function* () {
      const service = yield* FogBugzAutomation;
      yield* TestClock.setTime(Date.parse(baselineAt));
      yield* service.run();
      const model = test.state.settings.defaultModelSelection;
      test.state.settings = { ...test.state.settings, defaultModelSelection: null };
      test.state.cases[0] = { ...caseState, id: 43 };
      yield* service.run();
      expect(test.state.launches).toHaveLength(0);
      test.state.settings = { ...test.state.settings, defaultModelSelection: model };
      yield* service.run();
      expect(test.state.launches).toHaveLength(1);
    }).pipe(Effect.provide(test.service));
  });
});
