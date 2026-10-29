import { createMemoryHistory } from "@tanstack/react-router";
import {
  ProjectId,
  WS_METHODS,
  ORCHESTRATION_V2_WS_METHODS,
  type FogBugzCase,
  type ThreadId,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
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
import {
  ENVIRONMENT_ID,
  installFakeEnvironment,
  threadWithHistory,
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

it("processes sidepanel cases through the current thread and preserves its draft", async () => {
  const thread = threadWithHistory("fogbugz-actions", 1);
  const projectId = ProjectId.make("project-render");
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
  const requests: { threadId: ThreadId; caseId: number }[] = [];
  const messages: unknown[] = [];
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
    [WS_METHODS.fogbugzCaseContext]: (input: { threadId: ThreadId; caseId: number }) =>
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
  });
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  await page.viewport(1400, 900);
  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${thread.id}`] }),
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
  useRightPanelStore.getState().open(scopeThreadRef(ENVIRONMENT_ID, thread.id), "fogbugz-cases");
  await userEvent.click(page.getByRole("button", { name: "Case actions for #42" }));
  await userEvent.click(page.getByRole("menuitem", { name: "Add to Context", exact: true }));
  await vi.waitFor(() => {
    expect(editor.element().textContent).toContain("Existing draft.");
    expect(editor.element().textContent).toContain("Preserve notification preferences.");
  });
  expect(requests).toEqual([{ threadId: thread.id, caseId: 42 }]);
  expect(messages).toEqual([]);
  const draft = editor.element().textContent;
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
