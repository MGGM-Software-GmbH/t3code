import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import { EnvironmentAuthorizationError, ExternalLauncherError } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { msg } from "gt-react";
import { editorLabelForPlatform } from "../../editorLabels";
import { m } from "../../i18n/messages";
import { shellEnvironment } from "../../state/shell";
import { useAtomCommand } from "../../state/use-atom-command";
import { stackedThreadToast, toastManager } from "../ui/toast";

const isLauncherError = Schema.is(ExternalLauncherError);
const isAuthorizationError = Schema.is(EnvironmentAuthorizationError);

/** Describe the observable failure and keep recovery instructions in the viewing user's language. */
function editorFailure(error: unknown, editor: string): string {
  if (isLauncherError(error)) {
    switch (error._tag) {
      case "ExternalLauncherEditorConfigError":
        return m(msg("Set T3CODE_VSCODE_REMOTE_CLI to true or false in the server environment."));
      case "ExternalLauncherEditorExitError":
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
      case "ExternalLauncherEditorTimeoutError":
        return m(
          msg(
            "{editor} did not respond. Check that its window is connected to this environment and try again.",
            { editor },
          ),
        );
      case "ExternalLauncherCommandNotFoundError":
      case "ExternalLauncherUnsupportedEditorError":
      case "ExternalLauncherUnknownEditorError":
        return m(
          msg(
            "The environment could not find {editor}. Check that its command is installed and on PATH.",
            { editor },
          ),
        );
      case "ExternalLauncherEditorSpawnError":
        return m(
          msg(
            "The environment could not start {editor}. Check that its command can run in the environment terminal.",
            { editor },
          ),
        );
      case "ExternalLauncherUnsupportedTargetError":
        return m(msg("{editor} cannot open this path.", { editor }));
    }
  }
  if (isAuthorizationError(error)) {
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
