import { renderToStaticMarkup } from "react-dom/server";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import type { ComponentProps, PropsWithChildren } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { buildFileReviewComment } from "~/reviewCommentContext";

import { ComposerPendingReviewComments } from "./ComposerPendingReviewComments";

vi.mock("../ui/tooltip", () => ({
  Tooltip: ({ children }: PropsWithChildren) => <>{children}</>,
  TooltipTrigger: ({ render }: { render: React.ReactNode }) => render,
  TooltipPopup: () => null,
}));
vi.mock("~/components/ui/button", () => ({
  Button: (props: ComponentProps<"button">) => <button {...props} />,
}));
vi.mock("~/components/ui/textarea", () => ({
  Textarea: (props: ComponentProps<"textarea">) => <textarea {...props} />,
}));
let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.unstubAllGlobals();
});

describe("ComposerPendingReviewComments", () => {
  it("edits and cancels from a chip without changing its source snapshot or removing the comment", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("window", { requestAnimationFrame: () => 1, cancelAnimationFrame: () => {} });
    const comment = buildFileReviewComment({
      id: "chip",
      filePath: "file.ts",
      contents: "target",
      startLine: 1,
      endLine: 1,
      text: "Saved",
    });
    const onEdit = vi.fn();
    const onRemove = vi.fn();
    await act(async () => {
      renderer = create(
        <ComposerPendingReviewComments comments={[comment]} onEdit={onEdit} onRemove={onRemove} />,
      );
    });
    const root = renderer!.root;
    for (const action of ["cancel", "save"]) {
      await act(async () =>
        root.findByProps({ "aria-label": "Edit comment on file.ts L1" }).props.onClick(),
      );
      await act(async () =>
        root.findByType("textarea").props.onChange({ target: { value: "Revised" } }),
      );
      await act(async () => {
        if (action === "cancel")
          root.findByType("textarea").props.onKeyDown({ key: "Escape", preventDefault: vi.fn() });
        else
          root
            .findAllByType("button")
            .find((button) => button.children.includes("Save comment"))!
            .props.onClick();
      });
      expect(root.findAllByType("textarea")).toHaveLength(0);
      expect(onEdit).toHaveBeenCalledTimes(action === "save" ? 1 : 0);
    }
    expect(onEdit).toHaveBeenCalledWith("chip", "Revised");
    expect(onRemove).not.toHaveBeenCalled();
    expect(comment).toMatchObject({ text: "Saved", diff: "target", rangeLabel: "L1" });
  });
  it("keeps an empty-note chip visible without an empty tooltip", () => {
    const markup = renderToStaticMarkup(
      <ComposerPendingReviewComments
        comments={[
          {
            id: "selection-1",
            sectionId: "pull-request:42",
            sectionTitle: "PR #42",
            filePath: "src/app.ts",
            startIndex: 3,
            endIndex: 5,
            rangeLabel: "L4-L6",
            text: "",
            diff: "+const answer = 42;",
          },
        ]}
        onRemove={vi.fn()}
        onEdit={vi.fn()}
      />,
    );

    expect(markup).toContain("src/app.ts L4-L6");
    expect(markup).not.toContain('data-slot="tooltip-trigger"');
  });
});
