import { useAtomValue } from "@effect/atom-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { ExternalLinkIcon, LinkIcon, UnlinkIcon } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { openUrlInPreview } from "../../browser/openFileInPreview";
import { useBrowserDefaults } from "../../browser/browserDefaults";
import { useRenderedAppearance } from "../../hooks/useTheme";
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
  const openPreview = useAtomCommand(fogbugzEnvironment.openCase, { reportFailure: false });
  const permission = useAtomValue(fogbugzEnvironment.linkThread.permissionAtom(environmentId));
  const browserPermission = useAtomValue(fogbugzEnvironment.openCase.permissionAtom(environmentId));
  const prepareCaseGit = useAtomCommand(fogbugzEnvironment.ensureCaseGit, { reportFailure: false });
  const caseGitPermission = useAtomValue(
    fogbugzEnvironment.ensureCaseGit.permissionAtom(environmentId),
  );
  const [caseId, setCaseId] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const opened = useRef<string | null>(null);
  const preparedCase = useRef<number | null>(null);
  const browserDefaults = useBrowserDefaults();
  const appearance = useRenderedAppearance();
  async function openCase() {
    if (!linked.data) return;
    const result = await openUrlInPreview({
      threadRef,
      url: linked.data.url,
      openPreview: (parameters) =>
        openPreview({
          ...parameters,
          input: {
            ...parameters.input,
            // A remote headless browser cannot resolve the client's system appearance.
            colorScheme:
              browserDefaults.appearance === "system" ? appearance : browserDefaults.appearance,
          },
        }),
    });
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
  const openOnArrival = useEffectEvent(openCase);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Synchronizes the persisted case link with the external Browser panel once on arrival.
  useEffect(() => {
    if (display !== "context") return;
    if (!linked.data) opened.current = null;
    if (linked.data && browserPermission && opened.current !== linked.data.url) {
      opened.current = linked.data.url;
      void openOnArrival();
    }
  }, [linked.data, browserPermission, display]);

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
    if (display !== "context") return;
    if (!linked.data) preparedCase.current = null;
    if (linked.data && caseGitPermission && preparedCase.current !== linked.data.caseId) {
      preparedCase.current = linked.data.caseId;
      void prepareOnArrival();
    }
  }, [linked.data, caseGitPermission, display]);

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
