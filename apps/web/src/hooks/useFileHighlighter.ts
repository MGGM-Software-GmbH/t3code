import type { DiffsHighlighter } from "@pierre/diffs";
import { useEffect, useState } from "react";

export function isDwsFile(name: string) {
  return /\.(?:dws|shtml)$/i.test(name);
}

/** Bindet die zusätzliche Grammatik nur an DWS- und SHTML-Dateiansichten. */
export function useFileHighlighter(name: string) {
  const needsDws = isDwsFile(name);
  const [highlighter, setHighlighter] = useState<DiffsHighlighter>();
  const [error, setError] = useState<unknown>();

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Die zusätzliche Grammatik wird asynchron geladen und beim Verlassen der Ansicht abgemeldet.
  useEffect(() => {
    if (!needsDws) return;
    let mounted = true;
    void import("~/lib/dwsHighlighting")
      .then(({ getDwsHighlighter }) => getDwsHighlighter())
      .then(
        (loaded) => {
          if (mounted) setHighlighter(loaded);
        },
        (cause: unknown) => {
          if (mounted) setError(cause);
        },
      );
    return () => {
      mounted = false;
    };
  }, [needsDws]);

  if (needsDws && error) throw error;
  return {
    highlighter: needsDws ? highlighter : undefined,
    language: needsDws ? "mggm-dws" : undefined,
    ready: !needsDws || highlighter !== undefined,
  };
}
