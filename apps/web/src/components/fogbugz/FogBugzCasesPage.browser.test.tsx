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

const state = vi.hoisted(() => ({
  status: { connection: null, projects: [] } as typeof FogBugzStatus.Type,
  requests: [] as { environmentId: string; input: Record<string, unknown> }[],
  cases: { cases: [], threads: [], projects: [], truncated: false } as typeof FogBugzCaseList.Type,
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

it.each([390, 700])("keeps case actions in the current project at %i px", async (width) => {
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
  try {
    await using screen = await render(
      <div className="dark h-[800px] bg-background text-foreground">
        <FogBugzCases environmentId={environmentId} projectId={projectId} />
      </div>,
    );
    await expect
      .element(screen.getByRole("link", { name: "#12345" }))
      .toHaveAttribute("href", "https://fogbugz.example/default.asp?12345");
    await expect
      .element(screen.getByRole("button", { name: "New Thread in /workspace/server" }))
      .toBeVisible();
    expect(screen.container.querySelectorAll("article button")).toHaveLength(1);
    expect(screen.container.scrollWidth).toBeLessThanOrEqual(width);
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
