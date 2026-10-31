import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { CommandId, EnvironmentId, ProjectId, type FogBugzCase } from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { Link, useNavigate } from "@tanstack/react-router";
import { BellIcon, HistoryIcon, MessageSquareIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { fogbugzEnvironment } from "../../state/fogbugz";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { useProjects } from "../../state/entities";
import { environmentServerConfigsAtom } from "../../state/server";
import { formatEnvironmentQueryError, useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { threadEnvironment } from "../../state/threads";
import { useComposerDraftStore } from "../../composerDraftStore";
import { resolveProjectDefaultProviderModelSelection } from "../../providerInstances";
import { buildThreadRouteParams } from "../../threadRoutes";
import { newMessageId, newThreadId } from "../../lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SidebarInset } from "../ui/sidebar";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { toastManager } from "../ui/toast";
import { FogBugzCategoryIcon } from "./FogBugzCategoryIcon";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuTrigger,
  MenuSub,
  MenuSubTrigger,
  MenuSubPopup,
} from "../ui/menu";
import {
  fogbugzCaseActions,
  fogbugzCasePrompt,
  type FogBugzCaseAction,
} from "./fogbugzCaseActions";

export function FogBugzCasesPage() {
  const primary = usePrimaryEnvironmentId();
  const { environments } = useEnvironments();
  const [selected, setSelected] = useState<EnvironmentId | null>(null);
  const environmentId = selected ?? primary;
  return (
    <SidebarInset className="h-dvh min-w-0">
      <header className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 border-b py-2 pr-4 pl-14 sm:py-0">
        <h1 className="shrink-0 text-base font-semibold sm:text-lg">Fogbugz Cases</h1>
        <div className="ml-auto min-w-0 max-w-full sm:max-w-xs">
          <Select
            value={environmentId ?? ""}
            onValueChange={(value) => {
              if (value) setSelected(EnvironmentId.make(value));
            }}
          >
            <SelectTrigger size="xs" aria-label="Environment">
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
  const startTurn = useOrchestrationCommand(threadEnvironment.startTurn, { reportFailure: false });

  async function createThread(item: FogBugzCase, target: ProjectId, action: FogBugzCaseAction) {
    const connection = status.data?.connection;
    if (!config || !connection) throw new Error("Connect to the environment and FogBugz first.");
    const project = projects.find((candidate) => candidate.id === target);
    const settings = resolveProjectSettings(config.settings, target, project);
    const modelSelection =
      settings.settings.defaultModelSelection ??
      resolveProjectDefaultProviderModelSelection(config.providers, config.settings, target);
    if (!modelSelection)
      throw new Error("Configure a provider and default model before creating a thread.");
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
    if (result._tag === "Failure") throw new Error(formatEnvironmentQueryError(result.cause));
    const ref = scopeThreadRef(environmentId, result.value);
    const text = fogbugzCasePrompt(action, item.id, connection.baseUrl);
    // Keep the selected instruction available if starting the turn fails.
    useComposerDraftStore.getState().setPrompt(ref, text);
    await navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(ref),
    });
    if (action !== "context") {
      const sent = await startTurn({
        environmentId,
        input: {
          threadId: result.value,
          message: { messageId: newMessageId(), role: "user", text, attachments: [] },
          runtimeMode: "full-access",
          interactionMode: "default",
          dispatchMode: "queue",
        },
      });
      if (sent._tag === "Failure") throw new Error(formatEnvironmentQueryError(sent.cause));
      if (useComposerDraftStore.getState().getComposerDraft(ref)?.prompt === text) {
        useComposerDraftStore.getState().setPrompt(ref, "");
      }
    }
  }

  async function processCase(action: FogBugzCaseAction, item: FogBugzCase, target?: ProjectId) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (scopedProjectId && onCaseAction) await onCaseAction(action, item);
      else if (target) await createThread(item, target, action);
    } catch (cause) {
      const description = cause instanceof Error ? cause.message : "Unable to process the case.";
      setError(description);
      if (!scopedProjectId)
        toastManager.add({ type: "error", title: "Unable to process the case", description });
    }
    setBusy(false);
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <WorkspacePageContainer
        width="expanded"
        className="grid grid-cols-1 items-center gap-2 py-3 min-[360px]:grid-cols-2 sm:flex sm:flex-row sm:flex-wrap"
      >
        <form
          className="flex min-w-0 flex-1 gap-2 min-[360px]:col-span-2 sm:basis-64"
          onSubmit={(event) => {
            event.preventDefault();
            setSearch(query);
          }}
        >
          <Input
            size="sm"
            aria-label="Search cases"
            value={query}
            placeholder="Search cases"
            onChange={(event) => setQuery(event.target.value)}
          />
          <Button size="sm" variant="outline" type="submit">
            Search
          </Button>
        </form>
        <div className="min-w-0 sm:w-36">
          <Select
            value={state}
            onValueChange={(value) => {
              if (value === "open" || value === "closed" || value === "all") setState(value);
            }}
          >
            <SelectTrigger size="sm" aria-label="Case status">
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
        <div className="min-w-0 sm:w-40">
          <Select
            value={assigned}
            onValueChange={(value) => {
              if (value) setAssigned(value);
            }}
          >
            <SelectTrigger size="sm" aria-label="Assignee">
              <SelectValue>{assigned === "me" ? "Assigned to me" : "All assignees"}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value="me">Assigned to me</SelectItem>
              <SelectItem value="all">All assignees</SelectItem>
            </SelectPopup>
          </Select>
        </div>
        <div className="flex min-w-0 gap-2 min-[360px]:col-span-2 sm:contents">
          {scopedProjectId === undefined ? (
            <div className="min-w-0 flex-1 sm:w-44 sm:flex-none">
              <Select
                value={projectId}
                onValueChange={(value) => {
                  if (value) setProjectId(value);
                }}
              >
                <SelectTrigger size="sm" aria-label="T3 project">
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
            size="sm"
            variant="outline"
            disabled={cases.isPending}
            onClick={() => {
              status.refresh();
              cases.refresh();
            }}
          >
            Refresh
          </Button>
        </div>
      </WorkspacePageContainer>
      {status.error || cases.error || error ? (
        <p role="alert" className="p-4 text-destructive">
          {error ?? cases.error ?? status.error}
        </p>
      ) : null}
      {(!status.data && status.isPending) ||
      (status.data?.connection?.authenticated && linked.length > 0 && cases.isPending) ? (
        <p role="status" className="px-5 py-1 text-xs text-muted-foreground sm:px-6">
          {cases.data ? "Refreshing cases…" : "Loading cases…"}
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
          {cases.data?.cases.map((item) => {
            const targets = projects.filter((project) =>
              cases.data?.projects.some(
                (link) =>
                  link.fogbugzProjectId === item.projectId &&
                  link.projectId === project.id &&
                  (projectId === "all" || link.projectId === projectId),
              ),
            );
            const caseDate = item.notifiedAt ?? item.updatedAt;
            const dateLabel = item.notifiedAt ? "Your latest notification" : "Last modified";
            const DateIcon = item.notifiedAt ? BellIcon : HistoryIcon;
            const actionItems = (target?: ProjectId) =>
              fogbugzCaseActions.map(([action, label]) => (
                <MenuItem key={action} onClick={() => void processCase(action, item, target)}>
                  {label}
                </MenuItem>
              ));
            return (
              <article
                key={item.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 border-b py-3"
              >
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-start sm:gap-2">
                    <span className="inline-flex shrink-0 items-center gap-2">
                      <FogBugzCategoryIcon item={item} />
                      {status.data?.connection ? (
                        <a
                          href={
                            new URL(`default.asp?${item.id}`, status.data.connection.baseUrl).href
                          }
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-foreground hover:underline"
                        >
                          #{item.id}
                        </a>
                      ) : (
                        <span className="text-muted-foreground">#{item.id}</span>
                      )}
                    </span>
                    <h2 className="min-w-0 flex-1 break-words font-medium text-foreground/80">
                      {item.title}
                    </h2>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground sm:mt-1 sm:text-sm">
                    <span className="inline-flex max-w-full items-center gap-2">
                      <span className="min-w-0 break-words">{item.projectName}</span>
                      <span aria-hidden="true">|</span>
                    </span>
                    <span className="inline-flex max-w-full items-center gap-2">
                      <span>{item.status.replace(/^\d+\s*[.:-]?\s*/, "")}</span>
                      <span aria-hidden="true">|</span>
                    </span>
                    <span className="inline-flex max-w-full items-center gap-2">
                      <Tooltip>
                        <TooltipTrigger render={<span />}>{item.priority}</TooltipTrigger>
                        <TooltipPopup>Priority</TooltipPopup>
                      </Tooltip>
                      <span aria-hidden="true">|</span>
                    </span>
                    <span className="inline-flex max-w-full items-center gap-2">
                      <Tooltip>
                        <TooltipTrigger render={<span />}>{item.assignedToName}</TooltipTrigger>
                        <TooltipPopup>Assigned to</TooltipPopup>
                      </Tooltip>
                      {caseDate && <span aria-hidden="true">|</span>}
                    </span>
                    {caseDate && (
                      <span className="inline-flex max-w-full items-center gap-1">
                        <Tooltip>
                          <TooltipTrigger render={<span tabIndex={0} aria-label={dateLabel} />}>
                            <DateIcon aria-hidden className="size-3.5 shrink-0" />
                          </TooltipTrigger>
                          <TooltipPopup>{dateLabel}</TooltipPopup>
                        </Tooltip>
                        <time dateTime={caseDate}>{new Date(caseDate).toLocaleString()}</time>
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex min-w-0 flex-col gap-1 sm:mt-1">
                    {cases.data?.threads
                      .filter((thread) => thread.caseId === item.id)
                      .map((thread) => (
                        <Link
                          key={thread.threadId}
                          className="inline-flex min-w-0 items-center gap-1.5 text-xs text-foreground underline underline-offset-4 hover:text-muted-foreground sm:text-sm"
                          title={thread.title}
                          to="/$environmentId/$threadId"
                          params={buildThreadRouteParams(
                            scopeThreadRef(environmentId, thread.threadId),
                          )}
                        >
                          <MessageSquareIcon className="size-3.5 shrink-0" aria-hidden="true" />
                          <span className="truncate">{thread.title}</span>
                        </Link>
                      ))}
                  </div>
                </div>
                <Menu>
                  <MenuTrigger
                    render={
                      <Button
                        variant="outline"
                        size="icon"
                        aria-label={`Case actions for #${item.id}`}
                        disabled={
                          busy ||
                          (scopedProjectId
                            ? !onCaseAction || !canProcessCase
                            : !permission || targets.length === 0)
                        }
                      />
                    }
                  >
                    <PlusIcon aria-hidden="true" />
                  </MenuTrigger>
                  <MenuPopup align="end">
                    {scopedProjectId
                      ? actionItems()
                      : targets.length === 1
                        ? actionItems(targets[0]!.id)
                        : targets.map((project) => (
                            <MenuSub key={project.id}>
                              <MenuSubTrigger title={project.workspaceRoot}>
                                {project.title}
                              </MenuSubTrigger>
                              <MenuSubPopup>{actionItems(project.id)}</MenuSubPopup>
                            </MenuSub>
                          ))}
                  </MenuPopup>
                </Menu>
              </article>
            );
          })}
        </WorkspacePageContainer>
      </div>
      {cases.data?.truncated ? (
        <p className="px-5 py-2 text-xs text-muted-foreground sm:px-6 sm:text-sm">
          Showing the first 200 results. Narrow your search.
        </p>
      ) : null}
    </div>
  );
}
