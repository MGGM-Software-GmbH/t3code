import { createMemoryHistory } from "@tanstack/react-router";
import {
  ProjectId,
  WS_METHODS,
  ORCHESTRATION_V2_WS_METHODS,
  ProviderInstanceId,
  type OrchestrationV2ThreadLaunchInput,
  type FogBugzCase,
  type FogBugzCaseContextInput,
  ThreadId,
} from "@t3tools/contracts";
import { scopeThreadRef, scopeProjectRef } from "@t3tools/client-runtime/environment";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import "~/index.css";
import { AppRoot } from "~/AppRoot";
import { getRouter } from "~/router";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { useRightPanelStore } from "~/rightPanelStore";
import { DraftId, useComposerDraftStore } from "~/composerDraftStore";
import {
  ENVIRONMENT_ID,
  installFakeEnvironment,
  threadWithHistory,
  projectionOf,
  type FakeDriver,
} from "../../../test/fakeEnvironment";
import { render } from "../../../test/render";

vi.mock(
  "../../../../../packages/client-runtime/src/connection/driver.ts",
  async (importOriginal) => {
    const [actual, { fakeDriver }, Layer] = await Promise.all([
      importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
      import("../../../test/fakeEnvironment"),
      import("effect/Layer"),
    ]);
    return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
  },
);
vi.mock(import("~/rpc/requestLatencyState"), async (original) => ({
  ...(await original()),
  trackRpcRequestSent: () => {},
}));

it.each(["saved", "draft"])("processes sidepanel cases in a %s thread", async (kind) => {
  const thread = threadWithHistory("fogbugz-actions", 1);
  const projectId = ProjectId.make("project-render");
  const draftId = DraftId.make("fogbugz-new-draft");
  const activeThreadId = kind === "draft" ? ThreadId.make("fogbugz-new") : thread.id;
  if (kind === "draft") {
    useComposerDraftStore
      .getState()
      .setLogicalProjectDraftThreadId(
        "fogbugz-project",
        scopeProjectRef(ENVIRONMENT_ID, projectId),
        draftId,
        {
          threadId: activeThreadId,
          envMode: "local",
          branch: "main",
        },
      );
    useComposerDraftStore.getState().setModelSelection(draftId, {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.4",
    });
  }
  const item: FogBugzCase = {
    id: 42,
    title: "Repair notifications",
    projectId: 12,
    projectName: "OPS",
    status: "1 ToDo",
    open: true,
    assignedTo: 7,
    assignedToName: "Test User",
    priority: "High",
    categoryId: 1,
    categoryName: "Bug",
    categoryIconType: 1,
    notifiedAt: null,
    updatedAt: null,
  };
  const requests: (typeof FogBugzCaseContextInput.Type)[] = [];
  const messages: unknown[] = [];
  const launches: OrchestrationV2ThreadLaunchInput[] = [];
  using _environment = installFakeEnvironment([thread], {
    [WS_METHODS.fogbugzStatus]: () =>
      Effect.succeed({
        connection: {
          id: "connection",
          baseUrl: "https://fogbugz.example/",
          username: "test@example.com",
          personId: 7,
          personName: "Test User",
          authenticated: true,
        },
        projects: [{ projectId, fogbugzProjectId: 12, fogbugzProjectGroupId: null }],
      }),
    [WS_METHODS.fogbugzThread]: () => Effect.succeed(null),
    [WS_METHODS.fogbugzCases]: () =>
      Effect.succeed({
        cases: [item],
        threads: [],
        projects: [{ projectId, fogbugzProjectId: 12 }],
        truncated: false,
      }),
    [WS_METHODS.fogbugzCaseContext]: (input: typeof FogBugzCaseContextInput.Type) =>
      Effect.sync(() => {
        requests.push(input);
        return {
          case: item,
          url: "https://fogbugz.example/default.asp?42",
          events: [
            {
              id: 501,
              author: "Reporter",
              createdAt: null,
              text: "Preserve notification preferences.",
            },
          ],
        };
      }),
    [ORCHESTRATION_V2_WS_METHODS.dispatchCommand]: (input: { type: string }) =>
      Effect.sync(() => {
        if (input.type === "message.dispatch") messages.push(input);
        return { sequence: 1 };
      }),
    [ORCHESTRATION_V2_WS_METHODS.launchThread]: (input: OrchestrationV2ThreadLaunchInput) =>
      Effect.sync(() => {
        if (!input.threadId)
          throw new Error("The case action must use the current draft's thread ID.");
        launches.push(input);
        return {
          threadId: input.threadId,
          projection: projectionOf(threadWithHistory(input.threadId, 0)),
          resumed: false,
          sequence: 1,
        };
      }),
  });
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  await page.viewport(1400, 900);
  const router = getRouter(
    createMemoryHistory({
      initialEntries: [kind === "draft" ? `/draft/${draftId}` : `/${ENVIRONMENT_ID}/${thread.id}`],
    }),
  );
  await router.load();
  const container = document.createElement("div");
  container.className = "h-[900px] w-[1400px]";
  // AppRoot provides the application's router.
  await using screen = await render(<AppRoot router={router} />, { container, router: false });
  const editor = screen.getByTestId("composer-editor");
  await expect.element(editor).toBeVisible();
  await userEvent.click(editor);
  await userEvent.type(editor, "Existing draft. ");
  useRightPanelStore.getState().toggleVisibility(scopeThreadRef(ENVIRONMENT_ID, activeThreadId));
  await userEvent.click(page.getByRole("button", { name: /Fogbugz-Cases/ }));
  await userEvent.click(page.getByRole("button", { name: "Case actions for #42" }));
  await userEvent.click(page.getByRole("menuitem", { name: "Add to Context", exact: true }));
  await vi.waitFor(() => {
    expect(editor.element().textContent).toContain("Existing draft.");
    expect(editor.element().textContent).toContain("Preserve notification preferences.");
  });
  expect(requests).toEqual([
    kind === "draft" ? { projectId, caseId: 42 } : { threadId: thread.id, caseId: 42 },
  ]);
  expect(messages).toEqual([]);
  expect(launches).toEqual([]);
  const draft = editor.element().textContent;
  if (kind === "draft") {
    await page.viewport(390, 900);
    screen.container.className = "h-[900px] w-[390px]";
    await expect.element(page.getByRole("button", { name: "Case actions for #42" })).toBeVisible();
    await page.viewport(1400, 900);
    screen.container.className = "h-[900px] w-[1400px]";
    await userEvent.click(page.getByRole("button", { name: "Case actions for #42" }));
    await userEvent.click(page.getByRole("menuitem", { name: "Implement", exact: true }));
    await vi.waitFor(() => expect(launches).toHaveLength(1));
    expect(launches[0]).toMatchObject({
      threadId: activeThreadId,
      projectId,
      workspaceStrategy: { type: "root" },
      initialMessage: { text: expect.stringContaining("Implement the FogBugz case") },
    });
    expect(launches[0]?.initialMessage?.text).toContain("Existing draft.");
    expect(launches[0]?.initialMessage?.text).toContain("Preserve notification preferences.");
    return;
  }
  for (const label of ["Create PRP", "Implement"]) {
    await userEvent.click(page.getByRole("button", { name: "Case actions for #42" }));
    await userEvent.click(page.getByRole("menuitem", { name: label, exact: true }));
    await vi.waitFor(() => expect(messages).toHaveLength(label === "Create PRP" ? 1 : 2));
    expect(messages.at(-1)).toMatchObject({
      threadId: thread.id,
      text: expect.stringContaining("Preserve notification preferences."),
    });
    expect(editor.element().textContent).toBe(draft);
  }
});
