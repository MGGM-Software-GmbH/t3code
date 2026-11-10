import "@t3tools/client-runtime/assembly-highlighting";
import {
  getSharedHighlighter,
  setCustomExtension,
  type DiffsHighlighter,
  type HighlighterTypes,
  type SupportedLanguages,
} from "@pierre/diffs";

import { DIFF_THEME_NAMES } from "./diffRendering";

// Highlights has no lexer for these dialects, so they use their base language's.
setCustomExtension("luau", "lua");
setCustomExtension("xsl", "xml");
setCustomExtension("xslt", "xml");

/**
 * Die WASM-Lexer von Highlights tokenisieren große Dateien 10-40x schneller als Shiki
 * und vermeiden das Backtracking seiner JavaScript-Regex-Engine.
 * Gemeinsame Highlighter müssen pro Thread denselben Typ verwenden.
 * Eigene TextMate-Dateigrammatiken verwenden unabhängige Shiki-Instanzen.
 */
export const PREFERRED_HIGHLIGHTER: HighlighterTypes = "highlights";

const highlighterPromiseCache = new Map<string, Promise<DiffsHighlighter>>();

export function getSyntaxHighlighterPromise(language: string): Promise<DiffsHighlighter> {
  const cached = highlighterPromiseCache.get(language);
  if (cached) return cached;

  const promise = getSharedHighlighter({
    // Both palettes, so switching appearance never needs a new highlighter.
    themes: Object.values(DIFF_THEME_NAMES),
    langs: [language as SupportedLanguages],
    preferredHighlighter: PREFERRED_HIGHLIGHTER,
  }).catch((error) => {
    if (language === "text") {
      highlighterPromiseCache.delete(language);
      throw error;
    }
    return getSyntaxHighlighterPromise("text");
  });
  highlighterPromiseCache.set(language, promise);
  return promise;
}
