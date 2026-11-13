import { useAtomValue } from "@effect/atom-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { ExternalLinkIcon, FolderGit2Icon, LinkIcon, UnlinkIcon } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { fogbugzEnvironment } from "../../state/fogbugz";
import { formatEnvironmentQueryError, useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { toastManager } from "../ui/toast";
import { ThreadDetailsControl } from "../chat/ThreadDetailsControl";
import { ThreadDetailsSection } from "../chat/ThreadDetailsSection";
import {
  THREAD_DETAILS_PANEL_ICON_CLASS,
  THREAD_DETAILS_PANEL_LABEL_CLASS,
} from "../chat/threadDetailsPanelStyles";
import { useFogBugzCasePreview } from "./useFogBugzCasePreview";
import { useRightPanelStore } from "../../rightPanelStore";

export function FogBugzThreadContext({
  threadRef,
  display = "context",
}: {
  threadRef: ScopedThreadRef;
  display?: "context" | "details";
}) {
  const { environmentId, threadId } = threadRef;
  const status = useEnvironmentQuery(fogbugzEnvironment.status({ environmentId, input: {} }));
  const linked = useEnvironmentQuery(
    fogbugzEnvironment.thread({ environmentId, input: { threadId } }),
  );
  const link = useAtomCommand(fogbugzEnvironment.linkThread);
  const openPreview = useFogBugzCasePreview();
  const permission = useAtomValue(fogbugzEnvironment.linkThread.permissionAtom(environmentId));
  const browserPermission = useAtomValue(fogbugzEnvironment.openCase.permissionAtom(environmentId));
  const prepareCaseGit = useAtomCommand(fogbugzEnvironment.ensureCaseGit, { reportFailure: false });
  const caseGitPermission = useAtomValue(
    fogbugzEnvironment.ensureCaseGit.permissionAtom(environmentId),
  );
  const caseGitAvailable = status.data?.connection?.capabilities?.caseGit !== false;
  const [caseId, setCaseId] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preparedCase = useRef<number | null>(null);
  async function openCase() {
    if (!linked.data) return;
    const result = await openPreview(threadRef, linked.data.url);
    if (result._tag === "Failure") {
      const description = formatEnvironmentQueryError(result.cause);
      if (display === "context") {
        toastManager.add({ type: "error", title: "Unable to open FogBugz case", description });
      } else {
        setError(description);
      }
    } else {
      setError(null);
    }
  }
  const prepareOnArrival = useEffectEvent(async () => {
    const result = await prepareCaseGit({ environmentId, input: { threadId } });
    if (result._tag === "Failure")
      toastManager.add({
        type: "error",
        title: "Unable to prepare FogBugz case files",
        description: formatEnvironmentQueryError(result.cause),
      });
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Provision the linked thread's external case checkout on arrival.
  useEffect(() => {
    if (display !== "context" || status.isPending || !caseGitAvailable) return;
    if (!linked.data) preparedCase.current = null;
    if (linked.data && caseGitPermission && preparedCase.current !== linked.data.caseId) {
      preparedCase.current = linked.data.caseId;
      void prepareOnArrival();
    }
  }, [linked.data, caseGitPermission, display, status.isPending, caseGitAvailable]);

  if (display === "context") return null;
  if (!status.data?.connection && !linked.data) return null;
  return (
    <ThreadDetailsSection headingId="thread-details-fogbugz-heading" title="FogBugz">
      {linked.data ? (
        <>
          <p className="mb-1 px-2.5 text-xs break-words text-muted-foreground">
            #{linked.data.caseId}: {linked.data.title}
          </p>
          <ThreadDetailsControl disabled={!browserPermission} onClick={() => void openCase()}>
            <ExternalLinkIcon className={THREAD_DETAILS_PANEL_ICON_CLASS} />
            <span className={THREAD_DETAILS_PANEL_LABEL_CLASS}>Open FogBugz case</span>
          </ThreadDetailsControl>
          <ThreadDetailsControl
            disabled={!caseGitPermission || !caseGitAvailable}
            onClick={() => {
              const panels = useRightPanelStore.getState();
              panels.open(threadRef, "fogbugz-case-git");
              panels.setThreadPanelOpen(threadRef, "popover", false);
            }}
          >
            <FolderGit2Icon className={THREAD_DETAILS_PANEL_ICON_CLASS} />
            <span className={THREAD_DETAILS_PANEL_LABEL_CLASS}>FogBugz-Case-Git</span>
          </ThreadDetailsControl>
          <ThreadDetailsControl
            disabled={!permission || busy}
            onClick={async () => {
              setBusy(true);
              const result = await link({ environmentId, input: { threadId, caseId: null } });
              setBusy(false);
              setError(
                result._tag === "Failure" ? formatEnvironmentQueryError(result.cause) : null,
              );
              if (result._tag === "Success") linked.refresh();
            }}
          >
            <UnlinkIcon className={THREAD_DETAILS_PANEL_ICON_CLASS} />
            <span className={THREAD_DETAILS_PANEL_LABEL_CLASS}>Unlink FogBugz case</span>
          </ThreadDetailsControl>
        </>
      ) : (
        <ThreadDetailsControl
          disabled={!permission}
          onClick={() => setEditing(!editing)}
          aria-expanded={editing}
        >
          <LinkIcon className={THREAD_DETAILS_PANEL_ICON_CLASS} />
          <span className={THREAD_DETAILS_PANEL_LABEL_CLASS}>Link FogBugz case</span>
        </ThreadDetailsControl>
      )}
      {editing && !linked.data ? (
        <form
          className="mt-1 flex items-center gap-2 px-2.5"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            const result = await link({
              environmentId,
              input: { threadId, caseId: Number(caseId) },
            });
            setBusy(false);
            setError(result._tag === "Failure" ? formatEnvironmentQueryError(result.cause) : null);
            if (result._tag === "Success") {
              setEditing(false);
              linked.refresh();
            }
          }}
        >
          <div className="min-w-0 flex-1">
            <Input
              aria-label="FogBugz case number"
              type="number"
              min={1}
              step={1}
              required
              value={caseId}
              onChange={(event) => setCaseId(event.target.value)}
            />
          </div>
          <Button type="submit" size="sm" variant="outline" disabled={busy}>
            Link case
          </Button>
        </form>
      ) : null}
      {error || linked.error ? (
        <p role="alert" className="mt-1 px-2.5 text-xs break-words text-destructive">
          {error ?? linked.error}
        </p>
      ) : null}
    </ThreadDetailsSection>
  );
}
