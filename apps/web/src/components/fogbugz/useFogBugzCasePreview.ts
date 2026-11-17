import type { ScopedThreadRef } from "@t3tools/contracts";
import { openUrlInPreview } from "../../browser/openFileInPreview";
import { useBrowserDefaults } from "../../browser/browserDefaults";
import { useRenderedAppearance } from "../../hooks/useTheme";
import { fogbugzEnvironment } from "../../state/fogbugz";
import { useAtomCommand } from "../../state/use-atom-command";

export function useFogBugzCasePreview() {
  const openPreview = useAtomCommand(fogbugzEnvironment.openCase, { reportFailure: false });
  const browserDefaults = useBrowserDefaults();
  const appearance = useRenderedAppearance();

  return (threadRef: ScopedThreadRef, url: string) =>
    openUrlInPreview({
      threadRef,
      url,
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
}
