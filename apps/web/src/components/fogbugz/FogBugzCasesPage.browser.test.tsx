import {
  EnvironmentId,
  ProjectId,
  type FogBugzStatus,
  type FogBugzCaseList,
} from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import "~/index.css";
import { render } from "../../../test/render";
import { FogBugzCases } from "./FogBugzCasesPage";
import { RightPanelEmptyState } from "../RightPanelTabs";
import { TooltipProvider } from "../ui/tooltip";

const state = vi.hoisted(() => ({
  status: { connection: null, projects: [] } as typeof FogBugzStatus.Type,
  requests: [] as { environmentId: string; input: Record<string, unknown> }[],
  cases: { cases: [], threads: [], projects: [], truncated: false } as typeof FogBugzCaseList.Type,
  multipleProjects: false,
}));

vi.mock("../../state/fogbugz", async () => {
  const { Atom } = await import("effect/reactivity");
  return {
    fogbugzEnvironment: {
      status: () => ({ kind: "status" }),
      cases: (request: (typeof state.requests)[number]) => {
        state.requests.push(request);
        return { kind: "cases" };
      },
      createThread: { permissionAtom: () => Atom.make(true) },
    },
  };
});
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: (query: { kind: string } | null) => ({
    data: query?.kind === "status" ? state.status : query ? state.cases : undefined,
    isPending: false,
    isSuccess: query !== null,
    refresh: vi.fn(),
  }),
  formatEnvironmentQueryError: () => "Query failed",
}));
vi.mock(import("../../state/entities"), async (original) => ({
  ...(await original()),
  useProjects: () => [
    {
      id: projectId,
      environmentId,
      title: "Server",
      workspaceRoot: "/workspace/server",
      defaultModelSelection: null,
      scripts: [],
      createdAt: "2026-10-29T00:00:00Z",
      updatedAt: "2026-10-29T00:00:00Z",
    },
    ...(state.multipleProjects
      ? [
          {
            id: ProjectId.make("other-project"),
            environmentId,
            title: "Client",
            workspaceRoot: "/workspace/client",
            defaultModelSelection: null,
            scripts: [],
            createdAt: "2026-10-29T00:00:00Z",
            updatedAt: "2026-10-29T00:00:00Z",
          },
        ]
      : []),
  ],
}));
vi.mock(import("../../state/server"), async (original) => {
  const { Atom } = await import("effect/reactivity");
  return { ...(await original()), environmentServerConfigsAtom: Atom.make(new Map()) };
});
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));

const environmentId = EnvironmentId.make("fogbugz-test");
const projectId = ProjectId.make("project-a");

function setup() {
  state.requests = [];
  state.multipleProjects = false;
  state.cases = { cases: [], threads: [], projects: [], truncated: false };
  state.status = {
    connection: {
      id: "connection",
      baseUrl: "https://fogbugz.example/",
      username: "test@example.com",
      personId: 1,
      personName: "Test User",
      authenticated: true,
    },
    projects: [],
  };
}

it("offers the FogBugz surface only for a linked project and opens it on selection", async () => {
  setup();
  const open = vi.fn();
  const ignore = () => {};
  const props = {
    onAddBrowser: ignore,
    onAddBrowserInProfile: ignore,
    browserProfiles: [],
    onAddTerminal: ignore,
    onAddDiff: ignore,
    onAddFiles: ignore,
    onAddPullRequest: ignore,
    onAddPullRequests: ignore,
    onAddDevice: ignore,
    onAddFogBugzCases: open,
    browserAvailable: false,
    terminalAvailable: false,
    diffAvailable: false,
    filesAvailable: false,
    pullRequestAvailable: false,
    pullRequestsAvailable: false,
    deviceAvailable: false,
  };
  await using screen = await render(
    <RightPanelEmptyState {...props} fogbugzCasesAvailable={false} />,
  );
  await expect
    .element(screen.getByRole("button", { name: /Fogbugz-Cases/ }))
    .not.toBeInTheDocument();
  await screen.rerender(<RightPanelEmptyState {...props} fogbugzCasesAvailable />);
  await userEvent.click(screen.getByRole("button", { name: /Fogbugz-Cases/ }));
  expect(open).toHaveBeenCalledOnce();
});

it.each(["project", "group"] as const)(
  "keeps a %s-linked surface scoped while searching",
  async (kind) => {
    setup();
    state.status = {
      ...state.status,
      projects: [
        {
          projectId,
          fogbugzProjectId: kind === "project" ? 5 : null,
          fogbugzProjectGroupId: kind === "group" ? 9 : null,
        },
      ],
    };
    await using screen = await render(
      <FogBugzCases environmentId={environmentId} projectId={projectId} />,
    );
    await expect
      .element(screen.getByRole("combobox", { name: "T3 project" }))
      .not.toBeInTheDocument();
    await expect.element(screen.getByText("No matching cases")).toBeVisible();
    expect(state.requests.at(-1)).toMatchObject({
      environmentId,
      input: { projectId, state: "open", assignedToMe: true },
    });
    await userEvent.fill(screen.getByRole("textbox", { name: "Search cases" }), "server");
    await userEvent.click(screen.getByRole("button", { name: "Search", exact: true }));
    expect(state.requests.at(-1)?.input).toMatchObject({ projectId, query: "server" });
  },
);

it("does not query other projects after the current project's link is removed", async () => {
  setup();
  state.status = {
    ...state.status,
    projects: [
      {
        projectId: ProjectId.make("other-project"),
        fogbugzProjectId: 5,
        fogbugzProjectGroupId: null,
      },
    ],
  };
  await using screen = await render(
    <FogBugzCases environmentId={environmentId} projectId={projectId} />,
  );
  await expect.element(screen.getByText("Link a project")).toBeVisible();
  expect(state.requests).toEqual([]);
});

it.each([390, 700])("shows case dates and actions at %i px", async (width) => {
  setup();
  await page.viewport(width, 800);
  const wasDark = document.documentElement.classList.contains("dark");
  document.documentElement.classList.add("dark");
  state.status = {
    ...state.status,
    projects: [{ projectId, fogbugzProjectId: null, fogbugzProjectGroupId: 9 }],
  };
  state.cases = {
    cases: [
      {
        id: 12345,
        title: "Restore notification delivery for project updates",
        projectId: 5,
        projectName: "Operations",
        status: "1 ToDo",
        open: true,
        assignedTo: 1,
        assignedToName: "Test User",
        priority: "2 High",
        categoryId: 1,
        categoryName: "Bug",
        categoryIconType: 1,
        notifiedAt: "2026-10-29T10:30:00Z",
        updatedAt: "2026-10-29T12:30:00Z",
      },
    ],
    threads: [],
    truncated: false,
    projects: [
      { projectId, fogbugzProjectId: 5 },
      { projectId: ProjectId.make("other-project"), fogbugzProjectId: 5 },
    ],
  };
  state.cases = {
    ...state.cases,
    cases: [
      ...state.cases.cases,
      {
        ...state.cases.cases[0]!,
        id: 23456,
        title: "Restore the case list after a server restart",
        notifiedAt: null,
        updatedAt: "2026-10-30T08:15:00Z",
      },
    ],
  };
  try {
    const onCaseAction = vi.fn(async () => {});
    const container = document.createElement("div");
    container.className = "dark h-[800px] bg-background text-foreground";
    await using screen = await render(
      <TooltipProvider delay={0}>
        <FogBugzCases
          environmentId={environmentId}
          projectId={projectId}
          canProcessCase
          onCaseAction={onCaseAction}
        />
      </TooltipProvider>,
      { container },
    );
    await expect
      .element(screen.getByRole("link", { name: "#12345" }))
      .toHaveAttribute("href", "https://fogbugz.example/default.asp?12345");
    await expect
      .element(screen.getByRole("button", { name: "Case actions for #12345" }))
      .toBeVisible();
    expect(screen.container.querySelectorAll("article button")).toHaveLength(2);
    expect([...screen.container.querySelectorAll("time")].map((time) => time.dateTime)).toEqual([
      "2026-10-29T10:30:00Z",
      "2026-10-30T08:15:00Z",
    ]);
    await expect.element(screen.getByText("No notification")).not.toBeInTheDocument();
    await expect.element(screen.getByLabelText("Your latest notification")).toBeVisible();
    await expect.element(screen.getByLabelText("Last modified")).toBeVisible();
    await userEvent.hover(screen.getByLabelText("Last modified"));
    await expect.element(page.getByText("Last modified", { exact: true })).toBeVisible();
    expect(screen.container.scrollWidth).toBeLessThanOrEqual(width);
    for (const [label, action] of [
      ["Add to Context", "context"],
      ["Create PRP", "prp"],
      ["Implement", "implement"],
    ] as const) {
      await userEvent.click(screen.getByRole("button", { name: "Case actions for #12345" }));
      await expect.element(page.getByRole("menuitem", { name: label, exact: true })).toBeVisible();
      await userEvent.click(page.getByRole("menuitem", { name: label, exact: true }));
      expect(onCaseAction).toHaveBeenLastCalledWith(action, state.cases.cases[0]);
    }
    await page.screenshot({ path: `.t3/fogbugz-case-dates-${width}.png` });
    await screen.rerender(
      <FogBugzCases
        environmentId={environmentId}
        projectId={projectId}
        canProcessCase
        onCaseAction={async () => {
          throw new Error("Case access was revoked");
        }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Case actions for #12345" }));
    await userEvent.click(page.getByRole("menuitem", { name: "Add to Context", exact: true }));
    await expect.element(screen.getByRole("alert")).toHaveTextContent("Case access was revoked");
    await screen.rerender(<FogBugzCases key="global" environmentId={environmentId} />);
    await expect
      .element(screen.getByRole("button", { name: "Case actions for #12345" }))
      .toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Case actions for #12345" }));
    await expect
      .element(page.getByRole("menuitem", { name: "Add to Context", exact: true }))
      .toBeVisible();
    await expect
      .element(page.getByRole("menuitem", { name: "Server", exact: true }))
      .not.toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    state.multipleProjects = true;
    await screen.rerender(<FogBugzCases key="global" environmentId={environmentId} />);
    await userEvent.click(screen.getByRole("button", { name: "Case actions for #12345" }));
    await expect
      .element(page.getByRole("menuitem", { name: "Add to Context", exact: true }))
      .not.toBeInTheDocument();
    await userEvent.click(page.getByRole("menuitem", { name: "Client", exact: true }));
    await expect
      .element(page.getByRole("menuitem", { name: "Create PRP", exact: true }))
      .toBeVisible();
  } finally {
    document.documentElement.classList.toggle("dark", wasDark);
    await page.viewport(1280, 800);
  }
});

it("shows the connection state without querying cases after disconnecting", async () => {
  setup();
  state.status = { connection: null, projects: [] };
  await using screen = await render(
    <FogBugzCases environmentId={environmentId} projectId={projectId} />,
  );
  await expect.element(screen.getByText("Connect FogBugz")).toBeVisible();
  expect(state.requests).toEqual([]);
});
