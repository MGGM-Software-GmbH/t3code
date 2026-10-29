import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { CommandId, EnvironmentId, ProjectId, type FogBugzCase } from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { Link, useNavigate } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { fogbugzEnvironment } from "../../state/fogbugz";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { useProjects } from "../../state/entities";
import { environmentServerConfigsAtom } from "../../state/server";
import { formatEnvironmentQueryError, useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { resolveProjectDefaultProviderModelSelection } from "../../providerInstances";
import { buildThreadRouteParams } from "../../threadRoutes";
import { newThreadId } from "../../lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SidebarInset } from "../ui/sidebar";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { FogBugzCategoryIcon } from "./FogBugzCategoryIcon";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import type { FogBugzCaseAction } from "./fogbugzCaseActions";

export function FogBugzCasesPage() {
  const primary = usePrimaryEnvironmentId();
  const { environments } = useEnvironments();
  const [selected, setSelected] = useState<EnvironmentId | null>(null);
  const environmentId = selected ?? primary;
  return (
    <SidebarInset className="h-dvh min-w-0">
      <header className="flex min-h-14 flex-wrap items-center gap-3 border-b pr-4 pl-14">
        <h1 className="text-lg font-semibold">Fogbugz Cases</h1>
        <div className="ml-auto">
          <Select
            value={environmentId ?? ""}
            onValueChange={(value) => {
              if (value) setSelected(EnvironmentId.make(value));
            }}
          >
            <SelectTrigger aria-label="Environment">
              <SelectValue>
                {environments.find((item) => item.environmentId === environmentId)?.label ??
                  "Select environment"}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {environments.map((item) => (
                <SelectItem key={item.environmentId} value={item.environmentId}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
      </header>
      {environmentId ? (
        <FogBugzCases key={environmentId} environmentId={environmentId} />
      ) : (
        <p className="p-4">Connect to an environment to load cases.</p>
      )}
    </SidebarInset>
  );
}

export function FogBugzCases({
  environmentId,
  projectId: scopedProjectId,
  onCaseAction,
  canProcessCase = false,
}: {
  environmentId: EnvironmentId;
  projectId?: ProjectId;
  onCaseAction?: (action: FogBugzCaseAction, item: FogBugzCase) => Promise<void>;
  canProcessCase?: boolean;
}) {
  const navigate = useNavigate();
  const projects = useProjects().filter((item) => item.environmentId === environmentId);
  const configs = useAtomValue(environmentServerConfigsAtom);
  const config = configs.get(environmentId);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [state, setState] = useState<"open" | "closed" | "all">("open");
  const [assigned, setAssigned] = useState("me");
  const [selectedProjectId, setProjectId] = useState("all");
  const projectId = scopedProjectId ?? selectedProjectId;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = useEnvironmentQuery(fogbugzEnvironment.status({ environmentId, input: {} }));
  const linked = (status.data?.projects ?? []).filter(
    (link) => scopedProjectId === undefined || link.projectId === scopedProjectId,
  );
  const cases = useEnvironmentQuery(
    status.data?.connection?.authenticated && linked.length > 0
      ? fogbugzEnvironment.cases({
          environmentId,
          input: {
            query: search,
            state,
            assignedToMe: assigned === "me",
            ...(projectId === "all" ? {} : { projectId: ProjectId.make(projectId) }),
          },
        })
      : null,
  );
  const create = useAtomCommand(fogbugzEnvironment.createThread);
  const permission = useAtomValue(fogbugzEnvironment.createThread.permissionAtom(environmentId));

  async function createThread(item: FogBugzCase, target: ProjectId) {
    if (!config) return;
    const project = projects.find((candidate) => candidate.id === target);
    const settings = resolveProjectSettings(config.settings, target, project);
    const modelSelection =
      settings.settings.defaultModelSelection ??
      resolveProjectDefaultProviderModelSelection(config.providers, config.settings, target);
    if (!modelSelection) {
      setError("Configure a provider and default model before creating a thread.");
      return;
    }
    setBusy(true);
    setError(null);
    const threadId = newThreadId();
    const result = await create({
      environmentId,
      input: {
        commandId: CommandId.make(`fogbugz-create-${threadId}`),
        threadId,
        projectId: target,
        caseId: item.id,
        modelSelection,
      },
    });
    setBusy(false);
    if (result._tag === "Failure") setError(formatEnvironmentQueryError(result.cause));
    if (result._tag === "Success")
      await navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(environmentId, result.value)),
      });
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <WorkspacePageContainer
        width="expanded"
        className="flex-row flex-wrap items-center gap-2 py-4"
      >
        <form
          className="flex min-w-0 flex-1 basis-full gap-2 sm:basis-64"
          onSubmit={(event) => {
            event.preventDefault();
            setSearch(query);
          }}
        >
          <Input
            aria-label="Search cases"
            value={query}
            placeholder="Search cases"
            onChange={(event) => setQuery(event.target.value)}
          />
          <Button variant="outline" type="submit">
            Search
          </Button>
        </form>
        <div className="w-36">
          <Select
            value={state}
            onValueChange={(value) => {
              if (value === "open" || value === "closed" || value === "all") setState(value);
            }}
          >
            <SelectTrigger aria-label="Case status">
              <SelectValue>
                {state === "open" ? "Open" : state === "closed" ? "Closed" : "All statuses"}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
              <SelectItem value="all">All statuses</SelectItem>
            </SelectPopup>
          </Select>
        </div>
        <div className="w-44">
          <Select
            value={assigned}
            onValueChange={(value) => {
              if (value) setAssigned(value);
            }}
          >
            <SelectTrigger aria-label="Assignee">
              <SelectValue>{assigned === "me" ? "Assigned to me" : "All assignees"}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value="me">Assigned to me</SelectItem>
              <SelectItem value="all">All assignees</SelectItem>
            </SelectPopup>
          </Select>
        </div>
        {scopedProjectId === undefined ? (
          <div className="w-48">
            <Select
              value={projectId}
              onValueChange={(value) => {
                if (value) setProjectId(value);
              }}
            >
              <SelectTrigger aria-label="T3 project">
                <SelectValue>
                  {projects.find((item) => item.id === projectId)?.title ?? "All linked projects"}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="all">All linked projects</SelectItem>
                {projects
                  .filter((item) => linked.some((link) => link.projectId === item.id))
                  .map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.title}
                    </SelectItem>
                  ))}
              </SelectPopup>
            </Select>
          </div>
        ) : null}
        <Button
          variant="outline"
          disabled={cases.isPending}
          onClick={() => {
            status.refresh();
            cases.refresh();
          }}
        >
          Refresh
        </Button>
      </WorkspacePageContainer>
      {status.error || cases.error || error ? (
        <p role="alert" className="p-4 text-destructive">
          {error ?? cases.error ?? status.error}
        </p>
      ) : null}
      {(!status.data && status.isPending) ||
      (status.data?.connection?.authenticated && linked.length > 0 && cases.isPending) ? (
        <p role="status" className="p-4 text-muted-foreground">
          Loading cases…
        </p>
      ) : null}
      {status.isSuccess && !status.data?.connection?.authenticated ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Connect FogBugz</EmptyTitle>
            <EmptyDescription>
              <Link to="/settings/mggm">Set up your account in Settings &gt; MGGM.</Link>
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}
      {status.data?.connection?.authenticated && linked.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Link a project</EmptyTitle>
            <EmptyDescription>
              <Link to="/settings/projects">
                Assign a FogBugz project or group in Settings &gt; Projects.
              </Link>
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}
      {cases.isSuccess && linked.length > 0 && cases.data?.cases.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No matching cases</EmptyTitle>
            <EmptyDescription>Change the search or filters, or refresh the list.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto">
        <WorkspacePageContainer width="expanded" className="gap-0 pt-0">
          {cases.data?.cases.map((item) => (
            <article key={item.id} className="flex flex-wrap items-center gap-3 border-b py-3">
              <div className="min-w-0 flex-1 basis-64">
                <div className="flex gap-2">
                  <FogBugzCategoryIcon item={item} />
                  {status.data?.connection ? (
                    <a
                      href={new URL(`default.asp?${item.id}`, status.data.connection.baseUrl).href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground hover:text-foreground hover:underline"
                    >
                      #{item.id}
                    </a>
                  ) : (
                    <span className="text-muted-foreground">#{item.id}</span>
                  )}
                  <h2 className="min-w-0 flex-1 break-words font-medium text-foreground/80">
                    {item.title}
                  </h2>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                  <span>{item.projectName}</span>
                  <span className="inline-flex items-center gap-3">
                    <span aria-hidden="true">|</span>
                    <span>{item.status.replace(/^\d+\s*[.:-]?\s*/, "")}</span>
                  </span>
                  <span className="inline-flex items-center gap-3">
                    <span aria-hidden="true">|</span>
                    <Tooltip>
                      <TooltipTrigger render={<span />}>{item.priority}</TooltipTrigger>
                      <TooltipPopup>Priority</TooltipPopup>
                    </Tooltip>
                  </span>
                  <span className="inline-flex items-center gap-3">
                    <span aria-hidden="true">|</span>
                    <Tooltip>
                      <TooltipTrigger render={<span />}>{item.assignedToName}</TooltipTrigger>
                      <TooltipPopup>Assigned to</TooltipPopup>
                    </Tooltip>
                  </span>
                  <span className="inline-flex items-center gap-3">
                    <span aria-hidden="true">|</span>
                    <Tooltip>
                      <TooltipTrigger render={<span />}>
                        {item.notifiedAt ? (
                          <time dateTime={item.notifiedAt}>
                            {new Date(item.notifiedAt).toLocaleString()}
                          </time>
                        ) : (
                          "No notification"
                        )}
                      </TooltipTrigger>
                      <TooltipPopup>Your latest notification</TooltipPopup>
                    </Tooltip>
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                  {cases.data?.threads
                    .filter((thread) => thread.caseId === item.id)
                    .map((thread) => (
                      <Link
                        key={thread.threadId}
                        className="text-sm text-foreground underline underline-offset-4 hover:text-muted-foreground"
                        to="/$environmentId/$threadId"
                        params={buildThreadRouteParams(
                          scopeThreadRef(environmentId, thread.threadId),
                        )}
                      >
                        {thread.title}
                      </Link>
                    ))}
                </div>
              </div>
              {scopedProjectId ? (
                <Menu>
                  <MenuTrigger
                    render={
                      <Button
                        variant="outline"
                        size="icon"
                        aria-label={`Case actions for #${item.id}`}
                        disabled={busy || !onCaseAction || !canProcessCase}
                      />
                    }
                  >
                    <PlusIcon aria-hidden="true" />
                  </MenuTrigger>
                  <MenuPopup align="end">
                    {(
                      [
                        ["context", "Add to Context"],
                        ["prp", "Create PRP"],
                        ["implement", "Implement"],
                      ] as const
                    ).map(([action, label]) => (
                      <MenuItem
                        key={action}
                        onClick={() => {
                          if (!onCaseAction || busy) return;
                          setBusy(true);
                          setError(null);
                          void onCaseAction(action, item)
                            .catch((cause: unknown) => {
                              setError(
                                cause instanceof Error
                                  ? cause.message
                                  : "Unable to process the case.",
                              );
                            })
                            .finally(() => setBusy(false));
                        }}
                      >
                        {label}
                      </MenuItem>
                    ))}
                  </MenuPopup>
                </Menu>
              ) : (
                cases.data?.projects
                  .filter(
                    (link) =>
                      link.fogbugzProjectId === item.projectId &&
                      (projectId === "all" || link.projectId === projectId),
                  )
                  .map((link) => {
                    const project = projects.find((candidate) => candidate.id === link.projectId);
                    if (!project) return null;
                    const label = `New Thread in ${project.workspaceRoot}`;
                    return (
                      <Tooltip key={link.projectId}>
                        <TooltipTrigger
                          render={
                            <Button
                              variant="outline"
                              aria-label={label}
                              disabled={busy || !permission}
                              onClick={() => void createThread(item, link.projectId)}
                            >
                              <PlusIcon aria-hidden="true" />
                              {project.title}
                            </Button>
                          }
                        />
                        <TooltipPopup>{label}</TooltipPopup>
                      </Tooltip>
                    );
                  })
              )}
            </article>
          ))}
        </WorkspacePageContainer>
      </div>
      {cases.data?.truncated ? (
        <p className="p-3 text-sm text-muted-foreground">
          Showing the first 200 results. Narrow your search.
        </p>
      ) : null}
    </div>
  );
}
