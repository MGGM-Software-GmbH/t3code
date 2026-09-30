import { act, create, type ReactTestRenderer } from "react-test-renderer";
import type { ComponentProps, ReactNode } from "react";
import type { FileContents, LineAnnotation } from "@pierre/diffs";
import { DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { buildFileReviewComment, type ReviewCommentContext } from "~/reviewCommentContext";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { DiffCommentAnnotation } from "./DiffCommentAnnotation";

const renderChildrenUrl = new URL(
  "./utils/renderFileChildren.js",
  import.meta.resolve("@pierre/diffs/react"),
);
const { renderFileChildren } = (await import(/* @vite-ignore */ renderChildrenUrl.href)) as {
  renderFileChildren(props: {
    file: FileContents;
    lineAnnotations: LineAnnotation<ReviewCommentContext>[];
    renderAnnotation: (annotation: LineAnnotation<ReviewCommentContext>) => ReactNode;
  }): ReactNode;
};
const editTarget = DraftId.make("annotation-edit-lifecycle");

function SavedComments({ detached = false }: { detached?: boolean }) {
  const comments = useComposerDraftStore(
    (store) => store.getComposerDraft(editTarget)?.reviewComments,
  );
  const renderComment = (comment: ReviewCommentContext) => (
    <DiffCommentAnnotation
      kind="comment"
      rangeLabel={comment.rangeLabel}
      text={comment.text}
      editDraft={comment.editDraft}
      onEditDraftChange={(text) =>
        useComposerDraftStore.getState().setReviewCommentEditDraft(editTarget, comment.id, text)
      }
      onEdit={(text) =>
        useComposerDraftStore.getState().addReviewComment(editTarget, { ...comment, text })
      }
      onComment={vi.fn()}
      onCancel={vi.fn()}
    />
  );
  return detached ? (
    <section>
      {comments?.map((comment) => (
        <div key={comment.id}>{renderComment(comment)}</div>
      ))}
    </section>
  ) : (
    renderFileChildren({
      file: { name: "example.ts", contents: "first\nsecond" },
      lineAnnotations: (comments ?? []).map((comment) => ({
        lineNumber: comment.endIndex + 1,
        metadata: comment,
      })),
      renderAnnotation: (annotation) => renderComment(annotation.metadata),
    })
  );
}

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
  it.each(["remove preceding", "detach"])(
    "retains unsaved edits through annotation remounts: %s",
    async (change) => {
      const store = useComposerDraftStore.getState();
      store.setReviewComments(
        editTarget,
        [1, 2].map((line) =>
          buildFileReviewComment({
            id: String(line),
            filePath: "example.ts",
            contents: "first\nsecond",
            startLine: line,
            endLine: line,
            text: `Saved ${line}`,
          }),
        ),
      );
      await act(async () => {
        renderer = create(<SavedComments />);
      });
      await act(async () =>
        renderer!.root
          .findAllByType("button")
          .filter((button) => button.props["aria-label"] === "Edit comment")[1]!
          .props.onClick(),
      );
      await act(async () =>
        renderer!.root
          .findByType("textarea")
          .props.onChange({ target: { value: "Unsaved second edit" } }),
      );
      expect(store.getComposerDraft(editTarget)!.reviewComments[1]!.text).toBe("Saved 2");
      await act(async () => {
        if (change === "detach") renderer!.update(<SavedComments detached />);
        else store.removeReviewComment(editTarget, "1");
      });
      expect(
        store.getComposerDraft(editTarget)!.reviewComments.find((comment) => comment.id === "2")!
          .editDraft,
      ).toBe("Unsaved second edit");
      expect(renderer!.root.findByType("textarea").props.value).toBe("Unsaved second edit");
      await act(async () =>
        renderer!.root
          .findByType("textarea")
          .props.onKeyDown({ key: "Escape", preventDefault: vi.fn() }),
      );
      expect(
        store.getComposerDraft(editTarget)!.reviewComments.find((comment) => comment.id === "2"),
      ).toMatchObject({ text: "Saved 2" });
      expect(
        store.getComposerDraft(editTarget)!.reviewComments.find((comment) => comment.id === "2")!
          .editDraft,
      ).toBeUndefined();
      store.setReviewComments(editTarget, []);
    },
  );
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

  it("retains an uncontrolled draft and requests focus with preventScroll", async () => {
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
