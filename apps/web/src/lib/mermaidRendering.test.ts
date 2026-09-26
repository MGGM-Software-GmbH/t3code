import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mock = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn(), remove: vi.fn() }));
vi.mock("mermaid", () => ({ default: { initialize: mock.initialize, render: mock.render } }));

afterEach(() => vi.unstubAllGlobals());

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal("document", {
    createElement: () => ({ style: {}, setAttribute: vi.fn(), remove: mock.remove }),
    body: { append: vi.fn() },
  });
});

describe("local Mermaid rendering", () => {
  it("preserves fences and trailing newlines when copying", async () => {
    const { mermaidMarkdown } = await import("./mermaidRendering");
    expect(mermaidMarkdown("graph TD\nA-->B\n")).toBe("```mermaid\ngraph TD\nA-->B\n```\n\n");
    expect(mermaidMarkdown('graph TD\nA["```"]')).toBe('````mermaid\ngraph TD\nA["```"]\n````\n\n');
  });

  it("caches repeated source but renders again for a different theme", async () => {
    const { renderMermaid } = await import("./mermaidRendering");
    mock.render.mockResolvedValue({ svg: "<svg><text>A & B</text></svg>" });
    const result = await renderMermaid("graph TD;A-->B", "light");
    expect(decodeURIComponent(result.split(",")[1]!)).toBe("<svg><text>A & B</text></svg>");
    expect(await renderMermaid("graph TD;A-->B", "light")).toBe(result);
    await renderMermaid("graph TD;A-->B", "dark");
    expect(mock.render).toHaveBeenCalledTimes(2);
    expect(mock.initialize.mock.calls.map(([config]) => config.theme)).toEqual(["default", "dark"]);
    expect(mock.remove).toHaveBeenCalledTimes(2);
  });

  it("serializes theme configuration until the preceding render finishes", async () => {
    const { renderMermaid } = await import("./mermaidRendering");
    let finish!: (value: { svg: string }) => void;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    mock.render
      .mockImplementationOnce(() => {
        started();
        return new Promise((resolve) => {
          finish = resolve;
        });
      })
      .mockResolvedValueOnce({ svg: "<svg/>" });
    const first = renderMermaid("graph TD;A-->B", "light");
    const second = renderMermaid("graph TD;B-->C", "dark");
    await entered;
    expect(mock.initialize).toHaveBeenCalledTimes(1);
    finish({ svg: "<svg/>" });
    await Promise.all([first, second]);
    expect(mock.initialize).toHaveBeenCalledTimes(2);
  });

  it("reports errors, cleans temporary DOM, and permits retry and subsequent diagrams", async () => {
    const { renderMermaid } = await import("./mermaidRendering");
    mock.render
      .mockRejectedValueOnce(new Error("Parse error"))
      .mockResolvedValue({ svg: "<svg/>" });
    await expect(renderMermaid("invalid", "light")).rejects.toThrow("Parse error");
    await expect(renderMermaid("invalid", "light")).resolves.toContain("data:image/svg+xml");
    await expect(renderMermaid("graph TD;A-->B", "dark")).resolves.toContain("data:image/svg+xml");
    expect(mock.remove).toHaveBeenCalledTimes(3);
  });

  it("rejects oversized input before invoking Mermaid", async () => {
    const { renderMermaid } = await import("./mermaidRendering");
    await expect(renderMermaid("a".repeat(50_001), "light")).rejects.toThrow("50,000");
    expect(mock.render).not.toHaveBeenCalled();
  });
});
