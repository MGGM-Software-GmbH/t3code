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
  it("cancels an edit without deleting the saved comment, then saves revised text", async () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    const onCancel = vi.fn();
    const onComment = vi.fn();
    const root = await mount({
      kind: "comment",
      rangeLabel: "L3",
      text: "Original",
      onEdit,
      onDelete,
      onCancel,
      onComment,
    });
    await act(async () => root.findByProps({ "aria-label": "Edit comment" }).props.onClick());
    expect(root.findByType("textarea").props.value).toBe("Original");
    await act(async () =>
      root.findByType("textarea").props.onChange({ target: { value: "Discard" } }),
    );
    await act(async () =>
      root.findByType("textarea").props.onKeyDown({ key: "Escape", preventDefault: vi.fn() }),
    );
    expect(root.findAllByType("textarea")).toHaveLength(0);
    expect(onCancel).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
    expect(onEdit).not.toHaveBeenCalled();
    await act(async () => root.findByProps({ "aria-label": "Edit comment" }).props.onClick());
    expect(root.findByType("textarea").props.value).toBe("Original");
    await act(async () =>
      root.findByType("textarea").props.onChange({ target: { value: " Revised " } }),
    );
    await act(async () =>
      root
        .findAllByType("button")
        .find((button) => button.children.includes("Save comment"))!
        .props.onClick(),
    );
    expect(onEdit).toHaveBeenCalledWith("Revised");
    expect(onComment).not.toHaveBeenCalled();
  });
});
