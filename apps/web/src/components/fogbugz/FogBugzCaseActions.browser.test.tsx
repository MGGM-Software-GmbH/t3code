import { createMemoryHistory } from "@tanstack/react-router";
import {
  ProjectId,
  CommandId,
  OrchestrationV2DispatchCommandError,
  WS_METHODS,
  ORCHESTRATION_V2_WS_METHODS,
  ProviderInstanceId,
  type OrchestrationV2ThreadLaunchInput,
  type FogBugzCase,
  type FogBugzCaseContextInput,
  type FogBugzCreateThreadInput,
  type FogBugzConnectInput,
  type FogBugzConnection,
  FogBugzError,
  ThreadId,
  DEFAULT_SERVER_SETTINGS,
  type ServerSettingsPatch,
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
  installFakeEnvironment as installEnvironment,
  threadWithHistory,
  projectionOf,
  type FakeDriver,
} from "../../../test/fakeEnvironment";
import { render } from "../../../test/render";
import { fogbugzCasePrompt } from "./fogbugzCaseActions";
import { applyServerSettingsPatch } from "@t3tools/shared/serverSettings";
import { buildSidebarProjectSnapshots } from "~/sidebarProjectGrouping";
import { readProjects } from "~/state/entities";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { fogbugzEnvironment } from "~/state/fogbugz";

function installFakeEnvironment(...args: Parameters<typeof installEnvironment>) {
  const fixture = installEnvironment(...args);
  // The shared registry outlives a render; each fixture owns its connection state.
  appAtomRegistry.refresh(fogbugzEnvironment.status({ environmentId: ENVIRONMENT_ID, input: {} }));
  return fixture;
}

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

it("shows case metadata in the sidebar on wide and narrow screens", async () => {
  const thread = {
    ...threadWithHistory("linked-case-sidebar", 1),
    title: "#42 Analyze notification handling",
  };
  const item: FogBugzCase = {
    id: 42,
    title: "Analyze notification handling",
    projectId: 12,
    projectName: "OPS MGGM",
    status: "1 ToDo",
    open: true,
    assignedTo: 7,
    assignedToName: "Test User",
    priority: "High",
    priorityId: 1,
    categoryId: 1,
    categoryName: "Bug",
    categoryIconType: 1,
    notifiedAt: null,
    updatedAt: null,
  };
  using _environment = installFakeEnvironment([thread], {
    [WS_METHODS.fogbugzThreadCases]: () => Effect.succeed([{ threadId: thread.id, case: item }]),
    [WS_METHODS.fogbugzThread]: () => Effect.succeed(null),
    [WS_METHODS.fogbugzStatus]: () => Effect.succeed({ connection: null, projects: [] }),
  });
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
    mggmThreadSidebarEnabled: true,
    panelAnimationDurationMs: 0,
  });
  await page.viewport(1400, 900);
  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${thread.id}`] }),
  );
  await router.load();
  const container = document.createElement("div");
  container.className = "h-[900px] w-[1400px]";
  // AppRoot owns the router in this integrated client scenario.
  await using screen = await render(<AppRoot router={router} />, { container, router: false });
  await expect.element(screen.getByText("OPS MGGM", { exact: true })).toBeVisible();
  await expect.element(screen.getByText("Prio 1", { exact: true })).toBeVisible();
  await expect.element(screen.getByText("ToDo", { exact: true })).toBeVisible();
  await expect.element(screen.getByLabelText("Bug", { exact: true })).toBeVisible();
  await page.screenshot({ path: ".t3/fogbugz-thread-wide.png" });
  await page.viewport(390, 900);
  screen.container.className = "h-[900px] w-[390px]";
  await userEvent.click(page.getByRole("button", { name: "Toggle main sidebar", exact: true }));
  await expect.element(page.getByText("Prio 1", { exact: true })).toBeVisible();
  await expect.element(page.getByRole("dialog")).toHaveStyle({ opacity: "1" });
  await page.screenshot({ path: ".t3/fogbugz-thread-narrow.png" });
});

it("requires saving edited FogBugz connection details before testing them", async () => {
  let connection: FogBugzConnection = {
    id: "connection",
    baseUrl: "http://127.0.0.1:18080/",
    username: "test@example.com",
    personId: 7,
    personName: "Test User",
    authenticated: true,
  };
  const testedUrls: string[] = [];
  const saved: (typeof FogBugzConnectInput.Type)[] = [];
  using _environment = installFakeEnvironment([], {
    [WS_METHODS.fogbugzStatus]: () => Effect.succeed({ connection, projects: [] }),
    [WS_METHODS.fogbugzTest]: () =>
      Effect.sync(() => {
        testedUrls.push(connection.baseUrl);
        return connection;
      }),
    [WS_METHODS.fogbugzConnect]: (input: typeof FogBugzConnectInput.Type) => {
      if (input.password === "rejected-password") {
        return Effect.fail(new FogBugzError({ code: "authentication" }));
      }
      saved.push(input);
      connection = {
        ...connection,
        baseUrl: new URL(input.baseUrl).href,
        username: input.username,
      };
      return Effect.succeed(connection);
    },
  });
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  await page.viewport(1400, 900);
  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/settings/mggm?machine=${ENVIRONMENT_ID}`] }),
  );
  await router.load();
  // AppRoot owns the settings route and connection mutation pipeline.
  await using _screen = await render(<AppRoot router={router} />, { router: false });
  const url = page.getByRole("textbox", { name: "FogBugz base URL" });
  const test = page.getByRole("button", { name: "Test connection" });
  await expect.element(url).toHaveValue(connection.baseUrl);
  await userEvent.click(test);
  await vi.waitFor(() => expect(testedUrls).toEqual(["http://127.0.0.1:18080/"]));
  await userEvent.fill(url, "http://192.168.2.159:18080/");
  await expect
    .element(page.getByText(/Unsaved connection changes. Enter your password/))
    .toBeVisible();
  await page.screenshot({ path: ".t3/fogbugz-unsaved-wide.png" });
  await page.viewport(390, 900);
  await page.screenshot({ path: ".t3/fogbugz-unsaved-narrow.png" });
  await expect.element(test).toBeDisabled();
  await expect.element(page.getByText("Connection verified: Test User.")).not.toBeInTheDocument();
  await userEvent.fill(url, "http://127.0.0.1:18080/");
  await expect.element(test).toBeEnabled();
  await userEvent.fill(url, "http://192.168.2.159:18080");
  const password = page.getByLabelText("FogBugz password");
  await userEvent.fill(password, "rejected-password");
  await userEvent.click(page.getByRole("button", { name: "Update connection" }));
  await expect
    .element(page.getByRole("alert"))
    .toHaveTextContent(new FogBugzError({ code: "authentication" }).message);
  await expect.element(test).toBeDisabled();
  await userEvent.fill(password, "test-password");
  await userEvent.click(page.getByRole("button", { name: "Update connection" }));
  await expect.element(page.getByText("Connected as Test User.")).toBeVisible();
  expect(saved).toEqual([
    {
      baseUrl: "http://192.168.2.159:18080",
      username: "test@example.com",
      password: "test-password",
    },
  ]);
  await expect.element(test).toBeEnabled();
  await userEvent.click(test);
  await vi.waitFor(() =>
    expect(testedUrls).toEqual(["http://127.0.0.1:18080/", "http://192.168.2.159:18080/"]),
  );
});

it("saves global and project FogBugz automation choices", async () => {
  const patches: ServerSettingsPatch[] = [];
  using _environment = installFakeEnvironment([], {
    [WS_METHODS.fogbugzStatus]: () => Effect.succeed({ connection: null, projects: [] }),
    [WS_METHODS.serverUpdateSettings]: ({ patch }: { patch: ServerSettingsPatch }) =>
      Effect.sync(() => {
        patches.push(patch);
        return applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, patch);
      }),
  });
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
    panelAnimationDurationMs: 0,
  });
  await page.viewport(1400, 900);
  const router = getRouter(
    createMemoryHistory({
      initialEntries: [`/settings/mggm?machine=${ENVIRONMENT_ID}`],
    }),
  );
  await router.load();
  const container = document.createElement("div");
  container.className = "h-[900px] w-[1400px]";
  // AppRoot owns the router in this integrated client scenario.
  await using screen = await render(<AppRoot router={router} />, { container, router: false });
  await expect.element(page.getByRole("combobox", { name: "Auto-Settle on" })).toBeVisible();
  await expect
    .element(page.getByRole("combobox", { name: "Auto-Analyze New Cases" }))
    .toBeVisible();
  await userEvent.click(page.getByRole("combobox", { name: "Auto-Analyze New Cases" }));
  await userEvent.click(page.getByRole("option", { name: "Only initial event", exact: true }));
  await vi.waitFor(() =>
    expect(patches).toContainEqual(expect.objectContaining({ fogbugzAutoAnalyze: "initial" })),
  );
  await page.screenshot({ path: ".t3/fogbugz-settings-wide.png" });
  await page.viewport(390, 900);
  screen.container.className = "h-[900px] w-[390px]";
  await expect
    .element(page.getByRole("combobox", { name: "Auto-Analyze New Cases" }))
    .toBeVisible();
  page.getByRole("combobox", { name: "Auto-Analyze New Cases" }).element().scrollIntoView();
  await page.screenshot({ path: ".t3/fogbugz-settings-narrow.png" });
  const projectKey = buildSidebarProjectSnapshots({
    projects: readProjects(),
    settings: DEFAULT_CLIENT_SETTINGS,
    primaryEnvironmentId: ENVIRONMENT_ID,
    resolveEnvironmentLabel: () => "Test",
  })[0]!.projectKey;
  await router.navigate({
    to: "/settings/projects",
    search: { machine: ENVIRONMENT_ID, project: projectKey },
  });
  await expect.element(page.getByRole("combobox", { name: "Auto-Settle on" })).toBeVisible();
  page.getByRole("combobox", { name: "Auto-Settle on" }).element().scrollIntoView();
  await userEvent.click(page.getByRole("combobox", { name: "Auto-Settle on" }));
  await userEvent.click(page.getByRole("option", { name: "On closed", exact: true }));
  await vi.waitFor(() =>
    expect(patches).toContainEqual(
      expect.objectContaining({
        projectSettingsOverrides: expect.objectContaining({
          [ProjectId.make("project-render")]: expect.objectContaining({
            fogbugzAutoSettle: "closed",
          }),
        }),
      }),
    ),
  );
  page
    .getByRole("combobox", { name: "Auto-Settle on" })
    .element()
    .closest("section")
    ?.scrollIntoView();
  await page.screenshot({ path: ".t3/fogbugz-project-settings-narrow.png" });
  await page.viewport(1400, 900);
  screen.container.className = "h-[900px] w-[1400px]";
  page
    .getByRole("combobox", { name: "Auto-Settle on" })
    .element()
    .closest("section")
    ?.scrollIntoView();
  await page.screenshot({ path: ".t3/fogbugz-project-settings-wide.png" });
});

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
    expect(editor.element().textContent).toContain("FogBugz #42");
    expect(editor.element().textContent).not.toContain("Use the FogBugz MCP");
    expect(editor.element().textContent).not.toContain("Preserve notification preferences.");
  });
  expect(requests).toEqual([]);
  expect(
    useComposerDraftStore
      .getState()
      .getComposerDraft(kind === "draft" ? draftId : scopeThreadRef(ENVIRONMENT_ID, thread.id))
      ?.prompt,
  ).toContain("Use the FogBugz MCP");
  await expect.element(editor.getByRole("link", { name: "FogBugz #42" })).toBeVisible();
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
      initialMessage: { text: expect.stringContaining("Implement this case") },
    });
    expect(launches[0]?.initialMessage?.text).toContain("Existing draft.");
    expect(launches[0]?.initialMessage?.text).toContain("Use the FogBugz MCP");
    expect(launches[0]?.initialMessage?.text).not.toContain("Preserve notification preferences.");
    return;
  }
  for (const label of ["Create PRP", "Implement"]) {
    await userEvent.click(page.getByRole("button", { name: "Case actions for #42" }));
    await userEvent.click(page.getByRole("menuitem", { name: label, exact: true }));
    await vi.waitFor(() => expect(messages).toHaveLength(label === "Create PRP" ? 1 : 2));
    expect(messages.at(-1)).toMatchObject({
      threadId: thread.id,
      text: expect.stringContaining("Use the FogBugz MCP"),
    });
    expect(editor.element().textContent).toBe(draft);
  }
});

it.each(["context", "prp", "implement", "send failure"] as const)(
  "starts the global case %s action in the selected project",
  async (scenario) => {
    const action = scenario === "send failure" ? "implement" : scenario;
    const projectId = ProjectId.make("project-render");
    const fixtures = [threadWithHistory("global-existing", 1)];
    const created: (typeof FogBugzCreateThreadInput.Type)[] = [];
    const messages: { threadId: ThreadId; text: string }[] = [];
    const item: FogBugzCase = {
      id: 42,
      title: "Order confirmation: create multiple confirmations per customer reference",
      projectId: 12,
      projectName: "OPS ItWorks",
      status: "1 ToDo",
      open: true,
      assignedTo: 7,
      assignedToName: "Alex Developer",
      priority: "Must Fix (P3)",
      categoryId: 1,
      categoryName: "Bug",
      categoryIconType: 1,
      notifiedAt: null,
      updatedAt: null,
    };
    using _environment = installFakeEnvironment(fixtures, {
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
      [WS_METHODS.fogbugzCases]: () =>
        Effect.succeed({
          cases: [item],
          threads: [
            {
              threadId: fixtures[0]!.id,
              projectId,
              caseId: 42,
              title: "#42 Order confirmation: create multiple confirmations per customer reference",
              url: "https://fogbugz.example/default.asp?42",
            },
          ],
          projects: [{ projectId, fogbugzProjectId: 12 }],
          truncated: false,
        }),
      [WS_METHODS.fogbugzThread]: () => Effect.succeed(null),
      [WS_METHODS.fogbugzCreateThread]: (input: typeof FogBugzCreateThreadInput.Type) =>
        Effect.sync(() => {
          created.push(input);
          fixtures.push(threadWithHistory(input.threadId, 0));
          return input.threadId;
        }),
      [ORCHESTRATION_V2_WS_METHODS.dispatchCommand]: (input: {
        commandId: CommandId;
        type: string;
        threadId: ThreadId;
        text: string;
      }) => {
        if (input.type === "message.dispatch") messages.push(input);
        return scenario === "send failure"
          ? Effect.fail(
              new OrchestrationV2DispatchCommandError({
                commandId: input.commandId,
                commandType: input.type,
                message: "Provider offline",
              }),
            )
          : Effect.succeed({ sequence: 1 });
      },
    });
    __setClientSettingsForTests({
      ...DEFAULT_CLIENT_SETTINGS,
      onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
    });
    const router = getRouter(createMemoryHistory({ initialEntries: ["/cases"] }));
    await router.load();
    // AppRoot owns the real router and command pipeline.
    await using screen = await render(<AppRoot router={router} />, { router: false });
    if (scenario === "context") {
      await expect
        .element(page.getByRole("button", { name: "Case actions for #42" }))
        .toBeVisible();
      await page.viewport(390, 900);
      await page.screenshot({ path: ".t3/fogbugz-cases-mobile.png" });
      await page.viewport(320, 740);
      await page.screenshot({ path: ".t3/fogbugz-cases-small-mobile.png" });
      await page.viewport(1400, 900);
      await page.screenshot({ path: ".t3/fogbugz-cases-desktop.png" });
      await page.viewport(390, 900);
    }
    await userEvent.click(page.getByRole("button", { name: "Case actions for #42" }));
    if (scenario === "context") {
      await expect.element(page.getByRole("menuitem", { name: "Add to Context" })).toBeVisible();
      await page.screenshot({ path: ".t3/fogbugz-cases-mobile-actions.png" });
    }
    await userEvent.click(
      page.getByRole("menuitem", {
        name:
          action === "context" ? "Add to Context" : action === "prp" ? "Create PRP" : "Implement",
        exact: true,
      }),
    );
    await vi.waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({ projectId, caseId: 42 });
    const ref = scopeThreadRef(ENVIRONMENT_ID, created[0]!.threadId);
    const prompt = fogbugzCasePrompt(action, 42, "https://fogbugz.example/");
    if (action === "context") {
      await userEvent.click(screen.getByRole("button", { name: "Expand composer" }));
      await expect
        .element(screen.getByTestId("composer-editor").getByRole("link", { name: "FogBugz #42" }))
        .toBeVisible();
      expect(useComposerDraftStore.getState().getComposerDraft(ref)?.prompt).toBe(prompt);
      expect(messages).toEqual([]);
    } else if (scenario === "send failure") {
      await expect
        .element(page.getByText("Unable to process the case", { exact: true }))
        .toBeVisible();
      expect(useComposerDraftStore.getState().getComposerDraft(ref)?.prompt).toBe(prompt);
    } else {
      await vi.waitFor(() => expect(messages).toHaveLength(1));
      expect(messages[0]).toMatchObject({ threadId: ref.threadId, text: prompt });
      await vi.waitFor(() =>
        expect(useComposerDraftStore.getState().getComposerDraft(ref)?.prompt ?? "").toBe(""),
      );
    }
    expect(router.state.location.pathname).toBe(`/${ENVIRONMENT_ID}/${ref.threadId}`);
  },
);
