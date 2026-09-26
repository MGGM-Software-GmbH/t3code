const MAX_SOURCE_LENGTH = 50_000;
const MAX_CACHE_SIZE = 16;
const MAX_CACHE_BYTES = 4_000_000;
const cache = new Map<string, string>();
let renderQueue: Promise<unknown> = Promise.resolve();
let nextId = 0;

/** Keep copied diagrams usable as Markdown, including backticks in labels. */
export function mermaidMarkdown(code: string): string {
  const longestFence = Math.max(2, ...Array.from(code.matchAll(/`+/g), (match) => match[0].length));
  const fence = "`".repeat(longestFence + 1);
  return `${fence}mermaid\n${code.replace(/\n$/, "")}\n${fence}\n\n`;
}

/** Serialize Mermaid's global configuration and cache only successful renders. */
export function renderMermaid(code: string, theme: "light" | "dark"): Promise<string> {
  if (code.length > MAX_SOURCE_LENGTH) {
    return Promise.reject(new Error("Diagram exceeds the 50,000 character limit."));
  }
  const key = JSON.stringify([theme, code]);
  const render = renderQueue.then(async () => {
    const cached = cache.get(key);
    if (cached !== undefined) {
      cache.delete(key);
      cache.set(key, cached);
      return cached;
    }

    const { default: mermaid } = await import("mermaid");
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      theme: theme === "dark" ? "dark" : "default",
      fontFamily: "Arial, sans-serif",
      htmlLabels: false,
      flowchart: { htmlLabels: false },
      maxTextSize: MAX_SOURCE_LENGTH,
      maxEdges: 500,
      secure: [
        "secure",
        "securityLevel",
        "startOnLoad",
        "suppressErrorRendering",
        "maxTextSize",
        "maxEdges",
        "theme",
        "themeCSS",
        "themeVariables",
        "fontFamily",
        "htmlLabels",
        "flowchart",
      ],
    });
    const container = document.createElement("div");
    container.style.cssText = "position:fixed;left:-100000px;top:0;visibility:hidden";
    container.setAttribute("aria-hidden", "true");
    document.body.append(container);
    try {
      const { svg } = await mermaid.render(`t3-mermaid-${++nextId}`, code, container);
      // An image isolates SVG styles and prevents diagram links/scripts from acting on the app.
      const image = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      if (image.length <= MAX_CACHE_BYTES) {
        cache.set(key, image);
        while (
          cache.size > MAX_CACHE_SIZE ||
          Array.from(cache.values()).reduce((total, value) => total + value.length, 0) >
            MAX_CACHE_BYTES
        ) {
          const oldest = cache.keys().next().value;
          if (oldest === undefined) break;
          cache.delete(oldest);
        }
      }
      return image;
    } finally {
      container.remove();
    }
  });
  // A failed diagram must not poison later, independent render requests.
  renderQueue = render.catch(() => undefined);
  return render;
}
