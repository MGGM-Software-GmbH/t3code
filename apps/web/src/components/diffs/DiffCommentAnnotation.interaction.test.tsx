import { act, create, type ReactTestRenderer } from "react-test-renderer";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { DiffCommentAnnotation } from "./DiffCommentAnnotation";

vi.mock("~/components/ui/button", () => ({
  Button: (props: ComponentProps<"button">) => <button {...props} />,
}));
vi.mock("~/components/ui/textarea", () => ({
  Textarea: (props: ComponentProps<"textarea">) => <textarea {...props} />,
}));

let renderer: ReactTestRenderer | undefined;
const focus = vi.fn();
const frames = new Map<number, FrameRequestCallback>();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", {
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      frames.set(1, callback);
      return 1;
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
  });
  focus.mockClear();
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  frames.clear();
  vi.unstubAllGlobals();
});

async function mount(props: ComponentProps<typeof DiffCommentAnnotation>) {
  await act(async () => {
    renderer = create(<DiffCommentAnnotation {...props} />, {
      createNodeMock: (element) => (element.type === "textarea" ? { focus } : null),
    });
  });
  return renderer!.root;
}

describe("comment editing", () => {
  it("retains an uncontrolled draft and focuses without changing its selection or scroll", async () => {
    const onComment = vi.fn();
    const root = await mount({
      kind: "draft",
      rangeLabel: "L3",
      text: "Existing draft",
      onComment,
      onCancel: vi.fn(),
    });
    expect(root.findByType("textarea").props.value).toBe("Existing draft");
    for (const callback of frames.values()) callback(0);
    expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    await act(async () =>
      root.findByType("textarea").props.onChange({ target: { value: "Modified draft" } }),
    );
    expect(root.findByType("textarea").props.value).toBe("Modified draft");
    expect(onComment).not.toHaveBeenCalled();
  });
});
