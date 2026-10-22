import { parsePatchFiles } from "@pierre/diffs/utils/parsePatchFiles";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { act, render } from "../../../test/render";
import { DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { AnnotatableCodeView } from "./AnnotatableCodeView";
import type { StyledDiffCodeView } from "./StyledDiffCodeView";
import { restoreDiffReviewCommentRange } from "~/reviewCommentContext";

vi.mock("./StyledDiffCodeView", () => ({
  StyledDiffCodeView: ({
    items,
    options,
    renderAnnotation,
  }: ComponentProps<typeof StyledDiffCodeView>) => (
    <div>
      <button
        onClick={() =>
          options?.onGutterUtilityClick?.({ start: 2, end: 2, side: "additions" }, {
            item: items![0]!,
          } as never)
        }
      >
        Select review lines
      </button>
      {items?.flatMap(
        (item) =>
          item.annotations?.map((annotation) =>
            renderAnnotation?.(annotation, { item } as never),
          ) ?? [],
      )}
    </div>
  ),
}));
const target = DraftId.make("snapshot-integration");
function fileDiff(value: string) {
  return parsePatchFiles(
    `diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n@@ -1,2 +1,2 @@\n before\n-old\n+${value}\n`,
  )[0]!.files[0]!;
}

describe("diff comment snapshots", () => {
  it("submits the selected snapshot after an agent replaces the file, and clears saved annotations", async () => {
    using _draft = {
      [Symbol.dispose]() {
        useComposerDraftStore.getState().setReviewComments(target, []);
      },
    };
    const original = fileDiff("selected");
    const replacement = fileDiff("agent replacement");
    const view = (file: ReturnType<typeof fileDiff>) => (
      <AnnotatableCodeView
        codeViewKey="view"
        composerDraftTarget={target}
        sectionId="working"
        sectionTitle="Working tree"
        files={[
          {
            fileDiff: file,
            filePath: "file.ts",
            fileKey: "file",
            fileVersion: 1,
            collapsed: false,
          },
        ]}
        pendingFiles={[]}
        options={{}}
        onRevealSearchMatch={() => {}}
        renderHeaderFilenameSuffix={() => null}
        renderHeaderPrefix={() => null}
      />
    );
    await using screen = await render(view(original));
    await screen.getByRole("button", { name: "Select review lines" }).click();
    await screen.getByRole("textbox").fill("Keep the selected code");
    await screen.rerender(view(replacement));
    await expect.element(screen.getByText("Source changed.", { exact: false })).toBeVisible();
    await screen.getByRole("button", { name: "Comment", exact: true }).click();
    const comments = useComposerDraftStore.getState().getComposerDraft(target)!.reviewComments;
    expect(comments).toHaveLength(1);
    expect(comments[0]!.diff).toContain("+selected");
    expect(comments[0]!.diff).not.toContain("agent replacement");
    expect(restoreDiffReviewCommentRange(replacement, comments[0]!)).toBeNull();
    expect(restoreDiffReviewCommentRange(original, comments[0]!)).not.toBeNull();
    await screen.rerender(view(original));
    await expect.element(screen.getByText("Keep the selected code")).toBeVisible();
    await act(() => useComposerDraftStore.getState().setReviewComments(target, []));
    await expect.element(screen.getByText("Keep the selected code")).not.toBeInTheDocument();
  });
});
