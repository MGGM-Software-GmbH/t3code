import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import {
  EnvironmentAuthorizationError,
  ExternalLauncherCommandNotFoundError,
  ExternalLauncherEditorConfigError,
  ExternalLauncherEditorExitError,
  ExternalLauncherEditorSpawnError,
  ExternalLauncherEditorTimeoutError,
  ExternalLauncherUnknownEditorError,
  ExternalLauncherUnsupportedEditorError,
  ExternalLauncherUnsupportedTargetError,
} from "@t3tools/contracts";
import { msg } from "gt-react";
import { editorLabelForPlatform } from "../../editorLabels";
import { m } from "../../i18n/messages";
import { shellEnvironment } from "../../state/shell";
import { useAtomCommand } from "../../state/use-atom-command";
import { stackedThreadToast, toastManager } from "../ui/toast";

/** Describe the observable failure and keep recovery instructions in the viewing user's language. */
function editorFailure(error: unknown, editor: string): string {
  if (error instanceof ExternalLauncherEditorConfigError) {
    return m(msg("Set T3CODE_VSCODE_REMOTE_CLI to true or false in the server environment."));
  }
  if (error instanceof ExternalLauncherEditorExitError) {
    if (error.exitCode === 69) {
      return m(
        msg(
          "{editor} is unavailable (code 69). Open a window connected to this environment and try again.",
          { editor },
        ),
      );
    }
    return m(
      msg(
        "{editor} returned exit code {code}. Run its command in the environment terminal for details.",
        {
          editor,
          code: error.exitCode,
        },
      ),
    );
  }
  if (error instanceof ExternalLauncherEditorTimeoutError) {
    return m(
      msg(
        "{editor} did not respond. Check that its window is connected to this environment and try again.",
        { editor },
      ),
    );
  }
  if (
    error instanceof ExternalLauncherCommandNotFoundError ||
    error instanceof ExternalLauncherUnsupportedEditorError ||
    error instanceof ExternalLauncherUnknownEditorError
  ) {
    return m(
      msg(
        "The environment could not find {editor}. Check that its command is installed and on PATH.",
        { editor },
      ),
    );
  }
  if (error instanceof ExternalLauncherEditorSpawnError) {
    return m(
      msg(
        "The environment could not start {editor}. Check that its command can run in the environment terminal.",
        { editor },
      ),
    );
  }
  if (error instanceof ExternalLauncherUnsupportedTargetError) {
    return m(msg("{editor} cannot open this path.", { editor }));
  }
  if (error instanceof EnvironmentAuthorizationError) {
    return m(msg("This connection cannot open an editor on this environment."));
  }
  return thrownErrorMessage(error, m) || m(msg("The editor command failed."));
}

/** Opening an editor is normally instant. Only show progress while a slow request is outstanding. */
export function useOpenEditorWithFeedback() {
  const open = useAtomCommand(shellEnvironment.openInEditor, {
    label: "open in editor",
    reportFailure: false,
  });
  return async (request: Parameters<typeof open>[0]) => {
    const editor = editorLabelForPlatform(request.input.editor, navigator.platform);
    let pending: string | undefined;
    const timer = window.setTimeout(() => {
      pending = toastManager.add(
        stackedThreadToast({
          type: "loading",
          title: m(msg("Waiting for {editor}…", { editor })),
          timeout: 0,
        }),
      );
    }, 1000);
    try {
      const result = await open(request);
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: m(msg("Failed to open editor")),
            description: editorFailure(squashAtomCommandFailure(result), editor),
          }),
        );
      }
      return result;
    } finally {
      window.clearTimeout(timer);
      if (pending !== undefined) toastManager.close(pending);
    }
  };
}
