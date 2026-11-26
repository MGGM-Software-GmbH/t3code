import {
  createHighlighter,
  getResolvedOrResolveTheme,
  registerCustomLanguage,
  registerCustomTheme,
  resolveLanguage,
} from "@pierre/diffs";

import grammar from "./dws.tmLanguage.json";
import { DIFF_THEME_NAMES } from "./diffRendering";
import { READABLE_LIGHT_THEME_NAME, readableSyntaxColor } from "./readableSyntaxTheme";

// Die MGGM-Grammatik benötigt JavaScript und DWS-Injections innerhalb von Strings.
registerCustomLanguage(grammar.name, async () => ({
  default: [...(await resolveLanguage("javascript")).data, grammar],
}));

registerCustomTheme(READABLE_LIGHT_THEME_NAME, async () => {
  const base = await getResolvedOrResolveTheme("pierre-light", "shiki-wasm");
  if (!base.textmate) throw new Error("pierre-light has no TextMate palette");
  return {
    ...base.textmate,
    name: READABLE_LIGHT_THEME_NAME,
    settings: base.textmate.settings.map((entry) => ({
      ...entry,
      settings: {
        ...entry.settings,
        ...(entry.settings.foreground
          ? { foreground: readableSyntaxColor(entry.settings.foreground) }
          : {}),
      },
    })),
  };
});

let highlighterPromise: ReturnType<typeof createHighlighter> | undefined;

/** Lädt die DWS-Grammatik getrennt vom gemeinsamen Highlights-Highlighter. */
export function getDwsHighlighter() {
  highlighterPromise ??= (async () => {
    const highlighter = await createHighlighter("shiki-wasm", { independent: true });
    await Promise.all([
      highlighter.themeResolver.resolveThemes(Object.values(DIFF_THEME_NAMES)),
      highlighter.loadLanguages([grammar.name]),
    ]);
    return highlighter;
  })();
  return highlighterPromise;
}
