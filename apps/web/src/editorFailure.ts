import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import { EnvironmentAuthorizationError, ExternalLauncherError } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { msg } from "gt-react";
import { editorLabelForPlatform } from "./editorLabels";
import { m } from "./i18n/messages";

const isLauncherError = Schema.is(ExternalLauncherError);
const isAuthorizationError = Schema.is(EnvironmentAuthorizationError);

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
