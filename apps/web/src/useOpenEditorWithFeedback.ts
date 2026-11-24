import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import { EnvironmentAuthorizationError, ExternalLauncherError } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { msg } from "gt-react";
import { editorLabelForPlatform } from "./editorLabels";
import { m } from "./i18n/messages";
import { shellEnvironment } from "./state/shell";
import { useAtomCommand } from "./state/use-atom-command";
import { stackedThreadToast, toastManager } from "./components/ui/toast";

const isLauncherError = Schema.is(ExternalLauncherError);
const isAuthorizationError = Schema.is(EnvironmentAuthorizationError);
const pendingEditorRequests = new Set<string>();

/** Describe the observable failure and keep recovery instructions in the viewing user's language. */
export function editorFailure(error: unknown): string {
  if (isLauncherError(error)) {
    if (error._tag === "ExternalLauncherEditorConfigError") {
      return m(msg("Set T3CODE_VSCODE_REMOTE_CLI to true or false in the server environment."));
    }
    if (error._tag === "ExternalLauncherBrowserSpawnError") return error.message;
    const label =
      error._tag === "ExternalLauncherUnknownEditorError"
        ? error.editor
        : editorLabelForPlatform(error.editor, navigator.platform);
    switch (error._tag) {
      case "ExternalLauncherEditorExitError":
        if (error.exitCode === 69) {
          return m(
            msg(
              "{editor} is unavailable (code 69). Open a window connected to this environment and try again.",
              { editor: label },
            ),
          );
        }
        return m(
          msg(
            "{editor} returned exit code {code}. Run its command in the environment terminal for details.",
            {
              editor: label,
              code: error.exitCode,
            },
          ),
        );
      case "ExternalLauncherEditorTimeoutError":
        return m(
          msg(
            "{editor} did not respond. Check that its window is connected to this environment and try again.",
            { editor: label },
          ),
        );
      case "ExternalLauncherUnsupportedEditorError":
        return m(msg("This environment does not support opening {editor}.", { editor: label }));
      case "ExternalLauncherCommandNotFoundError":
      case "ExternalLauncherUnknownEditorError":
        return m(
          msg(
            "The environment could not find {editor}. Check that its command is installed and on PATH.",
            { editor: label },
          ),
        );
      case "ExternalLauncherEditorSpawnError":
        return m(
          msg(
            "The environment could not start {editor}. Check that its command can run in the environment terminal.",
            { editor: label },
          ),
        );
      case "ExternalLauncherUnsupportedTargetError":
        return m(msg("{editor} cannot open this path.", { editor: label }));
    }
  }
  if (isAuthorizationError(error)) {
    return m(msg("This connection cannot open an editor on this environment."));
  }
  return thrownErrorMessage(error, m) || m(msg("The editor command failed."));
}

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
