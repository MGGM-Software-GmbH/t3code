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
  it("retains intrinsic SVG dimensions and rejects missing or invalid bounds", async () => {
    const { mermaidImageSource } = await import("./mermaidRendering");
    expect(
      decodeURIComponent(
        mermaidImageSource('<svg width="100%" viewBox="0 0 900 300"></svg>').split(",")[1]!,
      ),
    ).toBe('<svg width="900" height="300" viewBox="0 0 900 300"></svg>');
    expect(() => mermaidImageSource('<svg viewBox="0 0 NaN 10"/>')).toThrow("dimensions");
    expect(() => mermaidImageSource("<svg/>")).toThrow("dimensions");
  });
  it("preserves fences and trailing newlines when copying", async () => {
    const { mermaidMarkdown } = await import("./mermaidRendering");
    expect(mermaidMarkdown("graph TD\nA-->B\n")).toBe("```mermaid\ngraph TD\nA-->B\n```\n\n");
    expect(mermaidMarkdown('graph TD\nA["```"]')).toBe('````mermaid\ngraph TD\nA["```"]\n````\n\n');
  });

  it("caches repeated source but renders again for a different theme", async () => {
    const { renderMermaid } = await import("./mermaidRendering");
    mock.render.mockResolvedValue({ svg: '<svg viewBox="0 0 100 50"><text>A & B</text></svg>' });
    const result = await renderMermaid("graph TD;A-->B", "light");
    expect(decodeURIComponent(result.split(",")[1]!)).toContain("<text>A & B</text>");
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
      .mockResolvedValueOnce({ svg: '<svg viewBox="0 0 100 50"/>' });
    const first = renderMermaid("graph TD;A-->B", "light");
    const second = renderMermaid("graph TD;B-->C", "dark");
    await entered;
    expect(mock.initialize).toHaveBeenCalledTimes(1);
    finish({ svg: '<svg viewBox="0 0 100 50"/>' });
    await Promise.all([first, second]);
    expect(mock.initialize).toHaveBeenCalledTimes(2);
  });

  it("reports errors, cleans temporary DOM, and permits retry and subsequent diagrams", async () => {
    const { renderMermaid } = await import("./mermaidRendering");
    mock.render
      .mockRejectedValueOnce(new Error("Parse error"))
      .mockResolvedValue({ svg: '<svg viewBox="0 0 100 50"/>' });
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
