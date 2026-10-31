import { useAtomValue } from "@effect/atom-react";
import type { FogBugzCaseGitCheckout } from "@t3tools/contracts";
import { useEffect, useEffectEvent, useRef, useState, type ComponentProps } from "react";
import { useMediaQuery } from "~/hooks/useMediaQuery";
import { fogbugzEnvironment } from "~/state/fogbugz";
import { useAtomCommand } from "~/state/use-atom-command";
import { formatEnvironmentQueryError, useEnvironmentQuery } from "~/state/query";
import FilePreviewPanel from "../files/FilePreviewPanel";
import { Button } from "../ui/button";

type Props = Pick<
  ComponentProps<typeof FilePreviewPanel>,
  | "threadRef"
  | "composerDraftTarget"
  | "keybindings"
  | "availableEditors"
  | "workspaceMutationId"
  | "openInShortcutEnabled"
>;

export function FogBugzCaseGitPanel(props: Props) {
  const { environmentId, threadId } = props.threadRef;
  const permission = useAtomValue(fogbugzEnvironment.ensureCaseGit.permissionAtom(environmentId));
  const link = useEnvironmentQuery(
    fogbugzEnvironment.thread({ environmentId, input: { threadId } }),
  );
  if (!permission)
    return (
      <p className="p-4 text-sm text-muted-foreground">
        Source control permission is required to prepare case files.
      </p>
    );
  if (link.error)
    return (
      <div className="space-y-3 p-4 text-sm">
        <p role="alert">{link.error}</p>
        <Button onClick={link.refresh}>Retry</Button>
      </div>
    );
  if (!link.isSuccess)
    return (
      <p role="status" className="p-4 text-sm text-muted-foreground">
        Loading case…
      </p>
    );
  if (!link.data)
    return (
      <p className="p-4 text-sm text-muted-foreground">
        Link this thread to a FogBugz case to open its Git files.
      </p>
    );
  return <CaseGitFiles key={`${environmentId}:${threadId}:${link.data.caseId}`} {...props} />;
}

function CaseGitFiles(props: Props) {
  const { environmentId, threadId } = props.threadRef;
  const prepare = useAtomCommand(fogbugzEnvironment.ensureCaseGit, { reportFailure: false });
  const [checkout, setCheckout] = useState<typeof FogBugzCaseGitCheckout.Type | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [relativePath, setRelativePath] = useState<string | null>(null);
  const [folderTrail, setFolderTrail] = useState<string | undefined>();
  const [pending, setPending] = useState(false);
  const requestId = useRef(0);
  const singleColumn = useMediaQuery("(max-width: 639px)");
  async function load() {
    const currentRequest = ++requestId.current;
    const result = await prepare({ environmentId, input: { threadId } });
    if (currentRequest !== requestId.current) return;
    if (result._tag === "Success") {
      setError(null);
      setCheckout(result.value);
    } else setError(formatEnvironmentQueryError(result.cause));
  }
  const loadOnArrival = useEffectEvent(load);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Opening the surface provisions its external Git checkout.
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- Checkout state is published after the external Git request resolves.
    void loadOnArrival();
    return () => {
      requestId.current++;
    };
  }, []);
  if (error)
    return (
      <div className="space-y-3 p-4 text-sm">
        <p role="alert">{error}</p>
        <Button onClick={() => void load()}>Retry</Button>
      </div>
    );
  if (!checkout)
    return (
      <p role="status" className="p-4 text-sm text-muted-foreground">
        Preparing case Git checkout…
      </p>
    );
  return (
    <FilePreviewPanel
      {...props}
      absoluteFileReferences
      singleColumn={singleColumn}
      environmentId={environmentId}
      cwd={checkout.cwd}
      projectName={`Case #${checkout.caseId}`}
      relativePath={relativePath}
      revealLine={null}
      revealRequestId={0}
      onOpenFile={(file) => {
        setRelativePath(file);
        setPending(false);
      }}
      onNavigateFolder={(folder, trail) => {
        setRelativePath(folder);
        setFolderTrail(trail);
        setPending(false);
      }}
      folderTrail={folderTrail}
      onPendingChange={(_file, value) => setPending(value)}
      selectedFilePending={pending}
    />
  );
}
