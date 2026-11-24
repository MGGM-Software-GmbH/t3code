import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { editorFailure } from "./editorFailure";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { msg } from "gt-react";
import { editorLabelForPlatform } from "./editorLabels";
import { m } from "./i18n/messages";
import { shellEnvironment } from "./state/shell";
import { useAtomCommand } from "./state/use-atom-command";
import { stackedThreadToast, toastManager } from "./components/ui/toast";

const pendingEditorRequests = new Set<string>();

/** Opening an editor is normally instant. Only show progress while a slow request is outstanding. */
export function useOpenEditorWithFeedback(errorFeedback: "toast" | "caller" = "toast") {
  const open = useAtomCommand(shellEnvironment.openInEditor, {
    label: "open in editor",
    reportFailure: false,
  });
  return async (request: Parameters<typeof open>[0]) => {
    const { editor: editorId, cwd, projectRoot, position, reveal } = request.input;
    // Position {} disables suffix parsing, so it differs from an omitted position.
    const key = JSON.stringify([
      request.environmentId,
      editorId,
      cwd,
      projectRoot,
      position !== undefined,
      position?.line,
      position?.column,
      reveal === true,
    ]);
    if (pendingEditorRequests.has(key)) return AsyncResult.failure<void, never>(Cause.interrupt());
    const editor = editorLabelForPlatform(editorId, navigator.platform);
    pendingEditorRequests.add(key);
    let pending: string | undefined;
    const timer = globalThis.setTimeout(() => {
      pending = toastManager.add(
        stackedThreadToast({
          type: "loading",
          title: m(msg("Waiting for {editor}…", { editor })),
          timeout: 0,
        }),
      );
    }, 1000);
    const result = await open(request).finally(() => {
      pendingEditorRequests.delete(key);
      globalThis.clearTimeout(timer);
      if (pending !== undefined) toastManager.close(pending);
    });
    if (
      errorFeedback === "toast" &&
      result._tag === "Failure" &&
      !isAtomCommandInterrupted(result)
    ) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: m(msg("Failed to open editor")),
          description: editorFailure(squashAtomCommandFailure(result)),
        }),
      );
    }
    return result;
  };
}
