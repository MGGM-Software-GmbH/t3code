import * as React from "react";
import { mermaidMarkdown, renderMermaid } from "../lib/mermaidRendering";

/** Render completed fences locally while retaining source and explicit error details. */
export function MermaidDiagram({ code, theme }: { code: string; theme: "light" | "dark" }) {
  const container = React.useRef<HTMLDivElement>(null);
  const [showSource, setShowSource] = React.useState(false);
  const [visible, setVisible] = React.useState(false);
  const [result, setResult] = React.useState<{
    code: string;
    theme: string;
    image?: string;
    error?: string;
  } | null>(null);
  const current = result?.code === code && result.theme === theme ? result : null;

  React.useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void renderMermaid(code, theme).then(
      (image) => {
        if (!cancelled) setResult({ code, theme, image });
      },
      (error: unknown) => {
        if (!cancelled)
          setResult({ code, theme, error: error instanceof Error ? error.message : String(error) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [code, theme, visible]);

  return (
    <div
      ref={container}
      data-mermaid-diagram
      data-markdown-copy={mermaidMarkdown(code)}
      style={{ padding: "8px 12px 12px" }}
    >
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
        <button
          type="button"
          className="chat-markdown-chrome-action"
          aria-pressed={showSource}
          onClick={() => setShowSource((value) => !value)}
          style={{ fontSize: 12, padding: "4px 8px", borderRadius: 4 }}
        >
          {showSource ? "Diagram" : "Source"}
        </button>
      </div>
      {current?.error && (
        <div
          role="alert"
          style={{ color: "var(--destructive, #dc2626)", whiteSpace: "pre-wrap", marginBottom: 8 }}
        >
          Mermaid: {current.error}
        </div>
      )}
      {showSource || current?.error ? (
        <pre style={{ maxHeight: "70vh", overflow: "auto", margin: 0 }}>
          <code>{code}</code>
        </pre>
      ) : current?.image ? (
        <div style={{ maxHeight: "70vh", overflow: "auto", textAlign: "center" }}>
          <img
            src={current.image}
            alt="Mermaid diagram"
            style={{ display: "inline-block", maxWidth: "100%", height: "auto" }}
          />
        </div>
      ) : (
        <div role="status" style={{ padding: "12px 0" }}>
          Rendering diagram…
        </div>
      )}
    </div>
  );
}
