import { createHighlighter, getHighlighterType } from "@pierre/diffs";
import { describe, expect, it } from "vite-plus/test";

import { isDwsFile } from "../hooks/useFileHighlighter";
import { DIFF_THEME_NAMES } from "./diffRendering";
import { getDwsHighlighter } from "./dwsHighlighting";
import { getSyntaxHighlighterPromise } from "./syntaxHighlighting";

describe("DWS-Dateiansichten", () => {
  it.each([
    ["motivzuordnung.dws", true],
    ["mainmenu_js.dws", true],
    ["templates/index.shtml", true],
    ["C:\\OPS\\INDEX.SHTML", true],
    ["INDEX.DWS", true],
    ["index.html", false],
    ["index.dws.js", false],
  ])("erkennt %s", (name, expected) => {
    expect(isDwsFile(name)).toBe(expected);
  });

  it.each(Object.values(DIFF_THEME_NAMES))(
    "erhält JavaScript, DWS und Strings mit %s",
    async (theme) => {
      const highlighter = await getDwsHighlighter();
      const source = [
        "<% var QueryName := 'sql_test';",
        "IF true THEN BEGIN",
        "// Kommentar",
        "end; %>",
        'const query = "<%= QueryName %>";',
      ].join("\n");
      const { tokens } = highlighter.codeToTokens(source, { lang: "mggm-dws", theme });
      expect(tokens.map((line) => line.map((token) => token.content).join("")).join("\n")).toBe(
        source,
      );
      expect(new Set(tokens.flat().map((token) => token.color)).size).toBeGreaterThan(3);
      expect(tokens[4]?.some((token) => token.content === "QueryName")).toBe(true);
      const lower = highlighter.codeToTokens("<% if true then begin end; %>", {
        lang: "mggm-dws",
        theme,
      });
      const upper = highlighter.codeToTokens("<% IF TRUE THEN BEGIN END; %>", {
        lang: "mggm-dws",
        theme,
      });
      expect(lower.tokens[0]?.find((token) => token.content === "if")?.color).toBeDefined();
      expect(lower.tokens[0]?.find((token) => token.content === "true")?.color).toBeDefined();
      expect(upper.tokens[0]?.find((token) => token.content === "IF")?.color).toBe(
        lower.tokens[0]?.find((token) => token.content === "if")?.color,
      );
      expect(upper.tokens[0]?.find((token) => token.content === "TRUE")?.color).toBe(
        lower.tokens[0]?.find((token) => token.content === "true")?.color,
      );
    },
  );

  it("erhält den gemeinsamen Highlighter beim Laden und Freigeben eines eigenen", async () => {
    const shared = await getSyntaxHighlighterPromise("javascript");
    const dws = await getDwsHighlighter();
    const temporary = await createHighlighter("shiki-wasm", { independent: true });
    temporary.dispose();
    expect(getHighlighterType()).toBe("highlights");
    expect(await getSyntaxHighlighterPromise("javascript")).toBe(shared);
    expect(await getDwsHighlighter()).toBe(dws);
    expect(
      shared.codeToTokens("const value = 42;", {
        lang: "javascript",
        theme: DIFF_THEME_NAMES.dark,
      }).tokens[0]?.length,
    ).toBeGreaterThan(1);
  });
});
