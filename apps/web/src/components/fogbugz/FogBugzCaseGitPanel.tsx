import { useAtomValue } from "@effect/atom-react";
import type { FogBugzCaseGitCheckout, FogBugzCaseFilesInput } from "@t3tools/contracts";
import {
  runAttachmentUploadCycle,
  deletePendingAttachmentUpload,
} from "@t3tools/client-runtime/state/attachments";
import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import { useEffect, useEffectEvent, useRef, useState, type ComponentProps } from "react";
import { useMediaQuery } from "~/hooks/useMediaQuery";
import { fogbugzEnvironment } from "~/state/fogbugz";
import { useAtomCommand } from "~/state/use-atom-command";
import { formatEnvironmentQueryError, useEnvironmentQuery } from "~/state/query";
import FilePreviewPanel from "../files/FilePreviewPanel";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogPanel,
  DialogFooter,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { attachmentEnvironment } from "~/state/attachments";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { readPreparedConnection } from "~/state/session";

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
  const mutate = useAtomCommand(fogbugzEnvironment.mutateCaseFiles, { reportFailure: false });
  const writePermission = useAtomValue(
    fogbugzEnvironment.mutateCaseFiles.permissionAtom(environmentId),
  );
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [mutating, setMutating] = useState(false);
  const [revision, setRevision] = useState(0);
  const [dialog, setDialog] = useState<{
    type: "create-file" | "create-directory" | "delete";
    path: string;
  } | null>(null);
  const [name, setName] = useState("");
  const [checkout, setCheckout] = useState<typeof FogBugzCaseGitCheckout.Type | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [relativePath, setRelativePath] = useState<string | null>(null);
  const [folderTrail, setFolderTrail] = useState<string | undefined>();
  const [pending, setPending] = useState(false);
  const requestId = useRef(0);
  const singleColumn = useMediaQuery("(max-width: 639px)");
  async function change(action: typeof FogBugzCaseFilesInput.Type.action) {
    const result = await mutate({ environmentId, input: { threadId, action } });
    if (result._tag !== "Success") throw new Error(formatEnvironmentQueryError(result.cause));
    if (
      action.type === "delete" &&
      relativePath &&
      (relativePath === action.path || relativePath.startsWith(`${action.path}/`))
    )
      setRelativePath(null);
    if (action.type === "create-file") setRelativePath(action.path);
    setRevision((value) => value + 1);
  }
  async function runChange(action: typeof FogBugzCaseFilesInput.Type.action) {
    if (mutating) return;
    setMutating(true);
    setMutationError(null);
    try {
      await change(action);
      setDialog(null);
    } catch (failure) {
      setMutationError(failure instanceof Error ? failure.message : "Could not change case files.");
    } finally {
      setMutating(false);
    }
  }
  async function upload(files: File[], folder: string, containsDirectories = false) {
    if (containsDirectories) {
      setMutationError("Drop individual files. Create folders in the case file tree first.");
      return;
    }
    if (mutating || !files.length) return;
    setMutating(true);
    setMutationError(null);
    const attachments: Array<{ path: string; attachmentId: string | null }> = [];
    const pendingIds: string[] = [];
    try {
      for (const file of files) {
        const path = folder ? `${folder}/${file.name}` : file.name;
        if (file.size === 0) {
          attachments.push({ path, attachmentId: null });
          continue;
        }
        const result = await runAttachmentUploadCycle({
          registry: appAtomRegistry,
          createUploadUrl: attachmentEnvironment.createUploadUrl,
          remove: attachmentEnvironment.remove,
          environmentId,
          onMinted: (attachmentId) => {
            pendingIds.push(attachmentId);
            return "continue";
          },
          upload: {
            type: "file",
            name: file.name,
            mimeType: file.type || "application/octet-stream",
            sizeBytes: file.size,
          },
          resolveUploadUrl: (url) => {
            const connection = readPreparedConnection(environmentId);
            return connection ? resolveAssetUrl(connection.httpBaseUrl, url) : null;
          },
          transport: (url) => {
            const controller = new AbortController();
            return {
              abort: () => controller.abort(),
              done: fetch(url, {
                method: "POST",
                body: file,
                headers: { "Content-Type": file.type || "application/octet-stream" },
                signal: controller.signal,
              }).then((response) => {
                if (!response.ok) throw new Error(`Upload rejected (${response.status})`);
              }),
            };
          },
        });
        if (result.status !== "uploaded") throw new Error("Could not upload case files.");
        attachments.push({
          path,
          attachmentId: result.attachmentId,
        });
      }
      await change({ type: "upload", files: attachments });
    } catch (failure) {
      setMutationError(failure instanceof Error ? failure.message : "Could not upload case files.");
    } finally {
      for (const attachmentId of pendingIds)
        deletePendingAttachmentUpload({
          registry: appAtomRegistry,
          remove: attachmentEnvironment.remove,
          environmentId,
          attachmentId,
        });
      setMutating(false);
    }
  }
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
    <div
      className="flex h-full min-h-0 flex-col"
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect =
          checkout.canWrite && writePermission && !mutating ? "copy" : "none";
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        if (checkout.canWrite && writePermission && !mutating)
          void upload(
            Array.from(event.dataTransfer.files),
            "",
            Array.from(event.dataTransfer.items).some(
              (item) => item.webkitGetAsEntry()?.isDirectory,
            ),
          );
      }}
    >
      {mutationError && (
        <p role="alert" className="border-b px-4 py-2 text-sm text-destructive">
          {mutationError}
        </p>
      )}
      {mutating && (
        <p role="status" className="border-b px-4 py-2 text-sm">
          Updating case files…
        </p>
      )}
      {checkout.syncIssue && (
        <p role="status" className="border-b px-4 py-2 text-sm text-warning-foreground">
          {checkout.syncIssue}
        </p>
      )}
      <div className="flex min-h-0 flex-1">
        <FilePreviewPanel
          {...props}
          absoluteFileReferences
          workspaceMutationId={`${props.workspaceMutationId ?? ""}:${revision}`}
          readOnly={!checkout.canWrite || mutating}
          fileActions={{
            disabled: !checkout.canWrite || !writePermission || mutating,
            create: (folder, directory) => {
              setName("");
              setMutationError(null);
              setDialog({ type: directory ? "create-directory" : "create-file", path: folder });
            },
            delete: (path) => {
              setMutationError(null);
              setDialog({ type: "delete", path });
            },
            upload: (files, folder, containsDirectories) =>
              void upload(files, folder, containsDirectories),
          }}
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
      </div>
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open && !mutating) setDialog(null);
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>
              {dialog?.type === "delete"
                ? "Delete case files"
                : dialog?.type === "create-directory"
                  ? "New folder"
                  : "New file"}
            </DialogTitle>
          </DialogHeader>
          <DialogPanel>
            {mutationError && (
              <p role="alert" className="mb-3 text-sm text-destructive">
                {mutationError}
              </p>
            )}
            {dialog?.type === "delete" ? (
              <p className="text-sm">
                Delete “<span className="break-all">{dialog.path}</span>” and any files inside it
                from this checkout?
              </p>
            ) : (
              <>
                <label htmlFor="case-file-name" className="text-sm">
                  Name in {dialog?.path || "case root"}
                </label>
                <Input
                  id="case-file-name"
                  autoFocus
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && name.trim() && dialog)
                      void runChange({
                        type: dialog.type,
                        path: dialog.path ? `${dialog.path}/${name.trim()}` : name.trim(),
                      });
                  }}
                />
              </>
            )}
          </DialogPanel>
          <DialogFooter>
            <Button variant="outline" disabled={mutating} onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              variant={dialog?.type === "delete" ? "destructive" : "default"}
              disabled={mutating || (dialog?.type !== "delete" && !name.trim())}
              onClick={() => {
                if (dialog)
                  void runChange({
                    type: dialog.type,
                    path:
                      dialog.type === "delete"
                        ? dialog.path
                        : dialog.path
                          ? `${dialog.path}/${name.trim()}`
                          : name.trim(),
                  });
              }}
            >
              {dialog?.type === "delete" ? "Delete" : "Create"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </div>
  );
}
