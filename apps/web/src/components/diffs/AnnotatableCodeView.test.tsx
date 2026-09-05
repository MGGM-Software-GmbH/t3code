import { parsePatchFiles } from "@pierre/diffs/utils/parsePatchFiles";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { AnnotatableCodeView } from "./AnnotatableCodeView";
import { DiffCommentAnnotation } from "./DiffCommentAnnotation";
import { StyledDiffCodeView } from "./StyledDiffCodeView";
import { restoreDiffReviewCommentRange } from "~/reviewCommentContext";

vi.mock("./StyledDiffCodeView", () => ({ StyledDiffCodeView: () => null }));
vi.mock("./DiffCommentAnnotation", () => ({ DiffCommentAnnotation: () => null }));

let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.unstubAllGlobals();
});

function fileDiff(value: string) {
  return parsePatchFiles(
    `diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n@@ -1,2 +1,2 @@\n before\n-old\n+${value}\n`,
  )[0]!.files[0]!;
}

describe("diff comment snapshots", () => {
  it("submits the selected snapshot after an agent replaces the file, and clears saved annotations", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const target = DraftId.make("snapshot-integration");
    useComposerDraftStore.getState().setReviewComments(target, []);
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
        options={{}}
        renderHeaderFilenameSuffix={() => null}
        renderHeaderPrefix={() => null}
      />
    );
    await act(async () => {
      renderer = create(view(original));
    });
    const surface = () => renderer!.root.findByType(StyledDiffCodeView);
    await act(async () =>
      surface().props.options.onGutterUtilityClick(
        { start: 2, end: 2, side: "additions" },
        { item: surface().props.items[0] },
      ),
    );
    await act(async () => renderer!.update(view(replacement)));
    expect(surface().props.items[0].annotations).toEqual([]);
    const detached = renderer!.root.findByType(DiffCommentAnnotation);
    await act(async () => detached.props.onComment("Keep the selected code"));
    const comments = useComposerDraftStore.getState().getComposerDraft(target)!.reviewComments;
    expect(comments).toHaveLength(1);
    expect(comments[0]!.diff).toContain("+selected");
    expect(comments[0]!.diff).not.toContain("agent replacement");
    expect(restoreDiffReviewCommentRange(replacement, comments[0]!)).toBeNull();
    expect(restoreDiffReviewCommentRange(original, comments[0]!)).not.toBeNull();
    await act(async () => renderer!.update(view(original)));
    expect(surface().props.items[0].annotations).toHaveLength(1);
    await act(async () => useComposerDraftStore.getState().setReviewComments(target, []));
    expect(surface().props.items[0].annotations).toEqual([]);
  });
});
