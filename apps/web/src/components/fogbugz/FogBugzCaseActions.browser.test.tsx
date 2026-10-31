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
  type FogBugzThreadLink,
  type FogBugzLinkThreadInput,
  type PreviewOpenInput,
  PreviewTabId,
  FogBugzError,
  ThreadId,
  DEFAULT_SERVER_SETTINGS,
  type ServerSettingsPatch,
} from "@t3tools/contracts";
import { scopeThreadRef, scopeProjectRef } from "@t3tools/client-runtime/environment";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import "~/index.css";
import { AppRoot } from "~/AppRoot";
import { getRouter } from "~/router";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { selectThreadRightPanelState, useRightPanelStore } from "~/rightPanelStore";
import { DraftId, useComposerDraftStore } from "~/composerDraftStore";
import {
  ENVIRONMENT_ID,
  installFakeEnvironment as installEnvironment,
  threadWithHistory,
  projectionOf,
  emitThreadShell,
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

it("shows case metadata and acknowledges reactivated threads on wide and narrow screens", async () => {
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
  const reactivatedAt = DateTime.makeUnsafe("2026-10-31T10:00:00.000Z");
  const reactivatedThread = {
    ...threadWithHistory("reactivated-case", 1),
    title: "#43 Investigate reopened case",
    lifecycle: {
      unsettledReason: "fogbugz-reactivated" as const,
      unsettledAt: reactivatedAt,
      settledOverride: "active" as const,
    },
  };
  const visits: { threadId: ThreadId; visitedAt: string }[] = [];
  using _environment = installFakeEnvironment([thread, reactivatedThread], {
    [WS_METHODS.fogbugzThreadCases]: () => Effect.succeed([{ threadId: thread.id, case: item }]),
    [WS_METHODS.fogbugzThread]: () => Effect.succeed(null),
    [WS_METHODS.fogbugzStatus]: () => Effect.succeed({ connection: null, projects: [] }),
    [ORCHESTRATION_V2_WS_METHODS.dispatchCommand]: (input: {
      type: string;
      threadId: ThreadId;
      visitedAt: string;
    }) => {
      if (input.type === "thread.visit") {
        visits.push(input);
        if (input.threadId === reactivatedThread.id) {
          return Effect.promise(() =>
            emitThreadShell({
              ...reactivatedThread,
              lifecycle: {
                ...reactivatedThread.lifecycle,
                lastVisitedAt: DateTime.makeUnsafe(input.visitedAt),
              },
            }),
          ).pipe(Effect.as({ sequence: 1, storedEvents: [] }));
        }
      }
      return Effect.succeed({ sequence: 1, storedEvents: [] });
    },
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
  await userEvent.click(screen.getByTestId("sidebar-idle-projects-shelf-toggle"));
  await expect.element(screen.getByText("Reactivated", { exact: true })).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: "Dismiss Reactivated notification" }))
    .toHaveClass("text-warning-foreground");
  await page.screenshot({ path: ".t3/fogbugz-thread-wide.png" });
  await page.viewport(390, 900);
  screen.container.className = "h-[900px] w-[390px]";
  await userEvent.click(page.getByRole("button", { name: "Toggle main sidebar", exact: true }));
  await expect.element(page.getByText("Prio 1", { exact: true })).toBeVisible();
  await expect.element(page.getByRole("dialog")).toHaveStyle({ opacity: "1" });
  await expect.element(page.getByText("Reactivated", { exact: true })).toBeVisible();
  await page.screenshot({ path: ".t3/fogbugz-thread-narrow.png" });
  await userEvent.click(page.getByRole("button", { name: "Dismiss Reactivated notification" }));
  await expect.element(page.getByText("Reactivated", { exact: true })).not.toBeInTheDocument();
  await vi.waitFor(() =>
    expect(visits).toContainEqual(
      expect.objectContaining({
        threadId: reactivatedThread.id,
        visitedAt: DateTime.formatIso(reactivatedAt),
      }),
    ),
  );
});

it("links, opens and unlinks a case from thread details on wide and narrow screens", async () => {
  const thread = threadWithHistory("case-details-actions", 1);
  let linked: typeof FogBugzThreadLink.Type | null = null;
  const opened: Array<PreviewOpenInput["url"]> = [];
  const otherThread = threadWithHistory("case-details-other", 1);
  using _environment = installFakeEnvironment([thread, otherThread], {
    [WS_METHODS.fogbugzStatus]: () =>
      Effect.succeed({
        connection: {
          id: "connection",
          baseUrl: "http://fogbugz.test/",
          username: "test@example.com",
          personId: 7,
          personName: "Test User",
          authenticated: true,
        },
        projects: [
          {
            projectId: ProjectId.make("project-render"),
            fogbugzProjectId: 12,
            fogbugzProjectGroupId: null,
          },
        ],
      }),
    [WS_METHODS.fogbugzThread]: (input: { threadId: ThreadId }) =>
      Effect.succeed(input.threadId === thread.id ? linked : null),
    [WS_METHODS.fogbugzThreadCases]: () => Effect.succeed([]),
    [WS_METHODS.fogbugzLinkThread]: (input: typeof FogBugzLinkThreadInput.Type) => {
      if (input.caseId === 999) {
        return Effect.fail(new FogBugzError({ code: "access" }));
      }
      linked =
        input.caseId === null
          ? null
          : {
              threadId: thread.id,
              projectId: ProjectId.make("project-render"),
              caseId: input.caseId,
              title: "Investigate the assigned case",
              url: `http://fogbugz.test/default.asp?${input.caseId}`,
            };
      return Effect.void;
    },
    [WS_METHODS.fogbugzOpenCase]: (input: PreviewOpenInput) => {
      opened.push(input.url);
      return Effect.succeed({
        threadId: thread.id,
        tabId: PreviewTabId.make("case-details-browser"),
        navStatus: { _tag: "Success", url: input.url, title: "FogBugz case" },
        canGoBack: false,
        canGoForward: false,
        updatedAt: "2026-10-31T10:00:00.000Z",
      });
    },
  });
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
    panelAnimationDurationMs: 0,
  });
  await page.viewport(1400, 900);
  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${thread.id}`] }),
  );
  await router.load();
  const container = document.createElement("div");
  container.className = "h-[900px] w-[1400px]";
  // AppRoot owns routing for this integrated thread-details journey.
  await using screen = await render(<AppRoot router={router} />, { container, router: false });
  const linkButton = page.getByRole("button", { name: "Link FogBugz case", exact: true });
  await expect.element(linkButton).toBeVisible();
  expect(linkButton.element().closest("[data-thread-details-card]")).not.toBeNull();
  const threadRef = scopeThreadRef(ENVIRONMENT_ID, thread.id);
  useRightPanelStore.getState().toggleVisibility(threadRef);
  await expect.element(page.getByText("Fogbugz-Cases", { exact: true })).toBeVisible();
  await expect
    .element(page.getByText("Fogbugz-Cases", { exact: true }).element().parentElement!)
    .toHaveAttribute("aria-disabled", "true");
  await userEvent.keyboard("C");
  await expect.element(page.getByRole("heading", { name: "Open a surface" })).toBeVisible();
  useRightPanelStore.getState().toggleVisibility(threadRef);
  await expect.element(linkButton).toBeVisible();
  await userEvent.click(linkButton);
  await userEvent.fill(page.getByRole("spinbutton", { name: "FogBugz case number" }), "999");
  await userEvent.click(page.getByRole("button", { name: "Link case", exact: true }));
  await expect
    .element(
      page.getByRole("alert").filter({ hasText: new FogBugzError({ code: "access" }).message }),
    )
    .toBeVisible();
  expect(linked).toBeNull();
  await userEvent.fill(page.getByRole("spinbutton", { name: "FogBugz case number" }), "42");
  await userEvent.click(page.getByRole("button", { name: "Link case", exact: true }));
  await expect
    .element(page.getByRole("button", { name: "Open FogBugz case", exact: true }))
    .toBeVisible();
  expect(opened).toEqual([]);
  useRightPanelStore.getState().toggleVisibility(threadRef);
  await userEvent.click(page.getByRole("button", { name: "Add panel surface" }));
  await expect.element(page.getByRole("menuitem", { name: /Fogbugz-Cases/ })).toBeEnabled();
  await userEvent.keyboard("{Escape}");
  await userEvent.click(page.getByRole("button", { name: "Toggle thread details panel" }));
  await expect
    .element(page.getByRole("button", { name: "Open FogBugz case", exact: true }))
    .toBeVisible();
  await expect
    .element(page.getByRole("dialog", { name: "Thread details", exact: true }))
    .toHaveStyle({ opacity: "1" });
  await page.screenshot({ path: ".t3/fogbugz-details-wide.png" });
  await userEvent.click(page.getByRole("button", { name: "Open FogBugz case", exact: true }));
  await vi.waitFor(() => expect(opened).toEqual(["http://fogbugz.test/default.asp?42"]));
  await userEvent.click(page.getByRole("button", { name: "Toggle thread details panel" }));
  await expect
    .element(page.getByRole("button", { name: "Open FogBugz case", exact: true }))
    .not.toBeInTheDocument();

  useRightPanelStore.getState().close(threadRef);
  await router.navigate({
    to: "/$environmentId/$threadId",
    params: { environmentId: ENVIRONMENT_ID, threadId: otherThread.id },
  });
  await expect.element(page.getByTestId("composer-editor")).toBeVisible();
  await router.navigate({
    to: "/$environmentId/$threadId",
    params: { environmentId: ENVIRONMENT_ID, threadId: thread.id },
  });
  await expect
    .element(page.getByRole("button", { name: "Open FogBugz case", exact: true }))
    .toBeVisible();
  expect(opened).toHaveLength(1);
  expect(
    selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, threadRef).isOpen,
  ).toBe(false);

  await page.viewport(390, 900);
  screen.container.className = "h-[900px] w-[390px]";
  await userEvent.click(page.getByRole("button", { name: "Toggle thread details panel" }));
  await expect
    .element(page.getByRole("button", { name: "Unlink FogBugz case", exact: true }))
    .toBeVisible();
  await expect
    .element(page.getByRole("dialog", { name: "Thread details", exact: true }))
    .toHaveStyle({ opacity: "1" });
  await page.screenshot({ path: ".t3/fogbugz-details-narrow.png" });
  await userEvent.click(page.getByRole("button", { name: "Unlink FogBugz case", exact: true }));
  await expect.element(linkButton).toBeVisible();
  expect(linked).toBeNull();
  await userEvent.click(linkButton);
  await expect.element(page.getByRole("spinbutton", { name: "FogBugz case number" })).toBeVisible();
  await page.screenshot({ path: ".t3/fogbugz-details-link-narrow.png" });
  await userEvent.keyboard("{Escape}");
  useRightPanelStore.getState().toggleVisibility(threadRef);
  await userEvent.click(page.getByRole("button", { name: "Add panel surface" }));
  await expect.element(page.getByRole("menuitem", { name: /Fogbugz-Cases/ })).toBeDisabled();
  await page.screenshot({ path: ".t3/fogbugz-surface-disabled-narrow.png" });
});

it("saves an alternate FogBugz address without asking for the password again", async () => {
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
      if (input.baseUrl.includes("unreachable")) {
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
    .element(page.getByText("Unsaved connection changes. Save changes to apply and verify them."))
    .toBeVisible();
  await page.screenshot({ path: ".t3/fogbugz-unsaved-wide.png" });
  await page.viewport(390, 900);
  await page.screenshot({ path: ".t3/fogbugz-unsaved-narrow.png" });
  await expect.element(test).toBeDisabled();
  await expect.element(page.getByText("Connection verified: Test User.")).not.toBeInTheDocument();
  await userEvent.fill(url, "http://127.0.0.1:18080/");
  await expect.element(test).toBeEnabled();
  await userEvent.fill(url, "https://unreachable.example/");
  const password = page.getByLabelText("FogBugz password");
  await expect.element(password).toHaveValue("");
  await expect.element(page.getByRole("button", { name: "Save changes" })).toBeEnabled();
  await userEvent.click(page.getByRole("button", { name: "Save changes" }));
  await expect
    .element(page.getByRole("alert"))
    .toHaveTextContent(new FogBugzError({ code: "authentication" }).message);
  await expect.element(test).toBeDisabled();
  await userEvent.fill(url, "http://192.168.2.159:18080");
  await userEvent.click(page.getByRole("button", { name: "Save changes" }));
  await expect.element(page.getByText("Connected as Test User.")).toBeVisible();
  expect(saved).toEqual([
    {
      baseUrl: "http://192.168.2.159:18080",
      username: "test@example.com",
      password: "",
    },
  ]);
  await expect.element(test).toBeEnabled();
  await userEvent.click(test);
  await vi.waitFor(() =>
    expect(testedUrls).toEqual(["http://127.0.0.1:18080/", "http://192.168.2.159:18080/"]),
  );
  await userEvent.fill(page.getByRole("textbox", { name: "FogBugz account" }), "other@example.com");
  await expect.element(page.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await expect
    .element(page.getByText("Enter your password to save these connection changes."))
    .toBeVisible();
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

it.each([
  { width: 1400, height: 900 },
  { width: 390, height: 844 },
])(
  "opens case Git through the surface menu and reads files from its own checkout at $width px",
  async ({ width, height }) => {
    const thread = threadWithHistory(`case-git-panel-${width}`, 0);
    const projectId = ProjectId.make("project-render");
    const cwd = `/case-files/connection/7/42/${thread.id}/repo`;
    let failing = true;
    const readRoots: string[] = [];
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
      [WS_METHODS.fogbugzThread]: () =>
        Effect.succeed({
          threadId: thread.id,
          projectId,
          caseId: 42,
          title: "Case files",
          url: "https://fogbugz.example/default.asp?42",
        }),
      [WS_METHODS.fogbugzEnsureCaseGit]: () =>
        failing
          ? Effect.fail(new FogBugzError({ code: "case_git" }))
          : Effect.succeed({
              caseId: 42,
              repositoryId: "fixture",
              cwd,
              canWrite: true,
              syncIssue: "Local and remote commits conflict. The working tree has been preserved.",
            }),
      [WS_METHODS.projectsListEntries]: (input: { cwd: string }) =>
        Effect.sync(() => {
          return {
            entries: input.cwd === cwd ? [{ path: "PRP.md", kind: "file" as const }] : [],
            truncated: false,
          };
        }),
      [WS_METHODS.projectsReadFile]: (input: { cwd: string; relativePath: string }) =>
        Effect.sync(() => {
          if (input.relativePath === "PRP.md") readRoots.push(input.cwd);
          return {
            relativePath: input.relativePath,
            contents: "# Case implementation plan\n\nFiles belong to this case checkout.\n",
            byteLength: 67,
            truncated: false,
          };
        }),
    });
    __setClientSettingsForTests({
      ...DEFAULT_CLIENT_SETTINGS,
      onboardingCompletedAt: "2026-01-01T00:00:00Z",
      panelAnimationDurationMs: 0,
    });
    await page.viewport(width, height);
    const router = getRouter(
      createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${thread.id}`] }),
    );
    await router.load();
    const container = document.createElement("div");
    container.style.width = `${width}px`;
    container.style.height = `${height}px`;
    // AppRoot owns the router and the file viewer's composer context.
    await using screen = await render(<AppRoot router={router} />, { container, router: false });
    const togglePanel = screen.getByRole("button", { name: "Toggle right panel", exact: true });
    await expect.element(togglePanel).toBeVisible();
    await userEvent.click(togglePanel);
    await userEvent.click(page.getByText("FogBugz-Case-Git", { exact: true }));
    await expect
      .element(
        page.getByRole("alert").filter({ hasText: "Could not prepare the case Git checkout" }),
      )
      .toBeVisible();
    failing = false;
    await userEvent.click(page.getByRole("button", { name: "Retry", exact: true }));
    await expect
      .element(page.getByRole("status").filter({ hasText: "Local and remote commits conflict." }))
      .toBeVisible();
    await expect.element(page.getByRole("treeitem", { name: "PRP.md", exact: true })).toBeVisible();
    await userEvent.click(page.getByRole("treeitem", { name: "PRP.md", exact: true }));
    await expect
      .element(page.getByText("Files belong to this case checkout.", { exact: true }))
      .toBeVisible();
    expect(readRoots.length).toBeGreaterThan(0);
    expect(readRoots.every((root) => root === cwd)).toBe(true);
  },
);

it.each(["saved", "draft"])("gates sidepanel cases in a %s thread", async (kind) => {
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
    [WS_METHODS.fogbugzThread]: () =>
      Effect.succeed(
        kind === "draft"
          ? null
          : {
              threadId: thread.id,
              projectId,
              caseId: item.id,
              title: item.title,
              url: "https://fogbugz.example/default.asp?42",
            },
      ),
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
  if (kind === "draft") {
    await expect.element(page.getByText("Fogbugz-Cases", { exact: true })).toBeVisible();
    await expect
      .element(page.getByText("Fogbugz-Cases", { exact: true }).element().parentElement!)
      .toHaveAttribute("aria-disabled", "true");
    expect(messages).toEqual([]);
    expect(launches).toEqual([]);
    return;
  }
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
    useComposerDraftStore.getState().getComposerDraft(scopeThreadRef(ENVIRONMENT_ID, thread.id))
      ?.prompt,
  ).toContain("Use the FogBugz MCP");
  await expect.element(editor.getByRole("link", { name: "FogBugz #42" })).toBeVisible();
  expect(messages).toEqual([]);
  expect(launches).toEqual([]);
  const draft = editor.element().textContent;
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

it.each(["context", "prp", "implement", "send failure", "preview failure"] as const)(
  "starts the global case %s action in the selected project",
  async (scenario) => {
    const action =
      scenario === "send failure"
        ? "implement"
        : scenario === "preview failure"
          ? "context"
          : scenario;
    const projectId = ProjectId.make("project-render");
    const fixtures = [threadWithHistory("global-existing", 1)];
    const created: (typeof FogBugzCreateThreadInput.Type)[] = [];
    const messages: { threadId: ThreadId; text: string }[] = [];
    const opened: PreviewOpenInput[] = [];
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
      [WS_METHODS.fogbugzOpenCase]: (input: PreviewOpenInput) => {
        opened.push(input);
        if (scenario === "preview failure")
          return Effect.fail(new FogBugzError({ code: "network" }));
        return Effect.succeed({
          threadId: input.threadId,
          tabId: PreviewTabId.make(`case-${input.threadId}`),
          navStatus: { _tag: "Success", url: input.url, title: "FogBugz case" },
          canGoBack: false,
          canGoForward: false,
          updatedAt: "2026-10-31T10:00:00.000Z",
        });
      },
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
    await vi.waitFor(() =>
      expect(opened).toEqual([
        expect.objectContaining({
          threadId: ref.threadId,
          url: "https://fogbugz.example/default.asp?42",
        }),
      ]),
    );
    const prompt = fogbugzCasePrompt(action, 42, "https://fogbugz.example/");
    if (scenario !== "preview failure") {
      await vi.waitFor(() =>
        expect(
          selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, ref).isOpen,
        ).toBe(true),
      );
      useRightPanelStore.getState().close(ref);
    }
    if (scenario === "preview failure") {
      await expect
        .element(page.getByText("Unable to open FogBugz case", { exact: true }))
        .toBeVisible();
      expect(useComposerDraftStore.getState().getComposerDraft(ref)?.prompt).toBe(prompt);
      expect(messages).toEqual([]);
    } else if (action === "context") {
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
