import { File } from "@pierre/diffs/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { act, render } from "../../../test/render";
import { DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { buildFileReviewComment, type ReviewCommentContext } from "~/reviewCommentContext";
import { DiffCommentAnnotation } from "./DiffCommentAnnotation";

const editTarget = DraftId.make("annotation-edit-lifecycle");

function SavedComments({ detached = false }: { detached?: boolean }) {
  const comments = useComposerDraftStore(
    (store) => store.getComposerDraft(editTarget)?.reviewComments ?? [],
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
      onComment={() => {}}
      onCancel={() => {}}
    />
  );
  return detached ? (
    <section>
      {comments.map((comment) => (
        <div key={comment.id}>{renderComment(comment)}</div>
      ))}
    </section>
  ) : (
    <File
      file={{ name: "example.ts", contents: "first\nsecond" }}
      lineAnnotations={comments.map((comment) => ({
        lineNumber: comment.endIndex + 1,
        metadata: comment,
      }))}
      renderAnnotation={(annotation) => renderComment(annotation.metadata)}
    />
  );
}

describe("comment editing", () => {
  it.each(["remove preceding", "detach"])(
    "retains unsaved edits through annotation remounts: %s",
    async (change) => {
      using _draft = {
        [Symbol.dispose]() {
          useComposerDraftStore.getState().setReviewComments(editTarget, []);
        },
      };
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
      await using screen = await render(<SavedComments />);
      await screen.getByRole("button", { name: "Edit comment" }).nth(1).click();
      await screen.getByRole("textbox").fill("Unsaved second edit");
      expect(store.getComposerDraft(editTarget)!.reviewComments[1]!.text).toBe("Saved 2");
      if (change === "detach") await screen.rerender(<SavedComments detached />);
      else await act(() => store.removeReviewComment(editTarget, "1"));
      await expect.element(screen.getByRole("textbox")).toHaveValue("Unsaved second edit");
      expect(
        store.getComposerDraft(editTarget)!.reviewComments.find((comment) => comment.id === "2")!
          .editDraft,
      ).toBe("Unsaved second edit");
      await screen.getByRole("button", { name: "Cancel" }).click();
      expect(
        store.getComposerDraft(editTarget)!.reviewComments.find((comment) => comment.id === "2"),
      ).toMatchObject({ text: "Saved 2" });
      expect(
        store.getComposerDraft(editTarget)!.reviewComments.find((comment) => comment.id === "2")!
          .editDraft,
      ).toBeUndefined();
    },
  );

  it("cancels an edit without deleting and saves trimmed changes without adding a comment", async () => {
    const onEdit = vi.fn();
    const onComment = vi.fn();
    const onCancel = vi.fn();
    await using screen = await render(
      <DiffCommentAnnotation
        kind="comment"
        rangeLabel="L3"
        text="Original"
        onEdit={onEdit}
        onComment={onComment}
        onCancel={onCancel}
      />,
    );
    await screen.getByRole("button", { name: "Edit comment" }).click();
    await screen.getByRole("textbox").fill(" Changed ");
    await screen.getByRole("button", { name: "Cancel" }).click();
    expect(onCancel).not.toHaveBeenCalled();
    await screen.getByRole("button", { name: "Edit comment" }).click();
    await expect.element(screen.getByRole("textbox")).toHaveValue("Original");
    await screen.getByRole("textbox").fill(" Revised ");
    await screen.getByRole("button", { name: "Save comment" }).click();
    expect(onEdit).toHaveBeenCalledExactlyOnceWith("Revised");
    expect(onComment).not.toHaveBeenCalled();
  });

  it("retains an uncontrolled draft and focuses without scrolling the viewport", async () => {
    const onComment = vi.fn();
    await using screen = await render(
      <DiffCommentAnnotation
        kind="draft"
        rangeLabel="L3"
        text="Existing draft"
        onComment={onComment}
        onCancel={() => {}}
      />,
    );
    await expect.element(screen.getByRole("textbox")).toHaveValue("Existing draft");
    await expect.element(screen.getByRole("textbox")).toHaveFocus();
    await screen.getByRole("textbox").fill("Modified draft");
    await expect.element(screen.getByRole("textbox")).toHaveValue("Modified draft");
    expect(onComment).not.toHaveBeenCalled();
  });
});
