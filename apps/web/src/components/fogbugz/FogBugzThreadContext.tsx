import { useAtomValue } from "@effect/atom-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { openUrlInPreview } from "../../browser/openFileInPreview";
import { fogbugzEnvironment } from "../../state/fogbugz";
import { previewEnvironment } from "../../state/preview";
import { formatEnvironmentQueryError, useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

export function FogBugzThreadContext({ threadRef }: { threadRef: ScopedThreadRef }) {
  const { environmentId, threadId } = threadRef;
  const status = useEnvironmentQuery(fogbugzEnvironment.status({ environmentId, input: {} }));
  const linked = useEnvironmentQuery(
    fogbugzEnvironment.thread({ environmentId, input: { threadId } }),
  );
  const link = useAtomCommand(fogbugzEnvironment.linkThread);
  const openPreview = useAtomCommand(previewEnvironment.open, { reportFailure: false });
  const permission = useAtomValue(fogbugzEnvironment.linkThread.permissionAtom(environmentId));
  const browserPermission = useAtomValue(previewEnvironment.open.permissionAtom(environmentId));
  const [caseId, setCaseId] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const opened = useRef<string | null>(null);
  async function openCase() {
    if (!linked.data) return;
    const result = await openUrlInPreview({ threadRef, url: linked.data.url, openPreview });
    if (result._tag === "Failure")
      setError(
        "The case could not be opened in the Browser panel. Check Browser settings and permissions.",
      );
  }
  const openOnArrival = useEffectEvent(openCase);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Synchronizes the persisted case link with the external Browser panel once on arrival.
  useEffect(() => {
    if (linked.data && browserPermission && opened.current !== linked.data.url) {
      opened.current = linked.data.url;
      void openOnArrival();
    }
  }, [linked.data, browserPermission]);

  if (!status.data?.connection && !linked.data) return null;
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2 text-sm">
      {linked.data ? (
        <>
          <span className="min-w-0 flex-1 truncate">
            FogBugz #{linked.data.caseId}: {linked.data.title}
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={!browserPermission}
            onClick={() => void openCase()}
          >
            Open case
          </Button>
          <Button
            size="sm"
            variant="ghost"
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
            Unlink
          </Button>
        </>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          disabled={!permission}
          onClick={() => setEditing(!editing)}
        >
          Link FogBugz case
        </Button>
      )}
      {editing && !linked.data ? (
        <form
          className="flex items-center gap-2"
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
          <div className="w-28">
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
        <span role="alert" className="basis-full text-destructive">
          {error ?? linked.error}
        </span>
      ) : null}
    </div>
  );
}
