import { EnvironmentId, type ProjectEntry } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { useState } from "react";
import { Dialog, DialogPopup, DialogTitle } from "../ui/dialog";

import { COMPOSER_MENTION_DRAG_TYPE } from "~/components/chat/composerMentionDrag";
import { dismissContextMenu } from "~/contextMenuFallback";
import { render } from "../../../test/render";
import FileBrowserPanel from "./FileBrowserPanel";

const entries: readonly ProjectEntry[] = [
  { path: "src", kind: "directory" },
  { path: "README.md", kind: "file" },
];
const loadingDirectories: ReadonlySet<string> = new Set();
const directory = {
  entries,
  load: () => Promise.resolve(),
  refresh: () => {},
  ready: true,
  error: null,
  isPending: false,
  loadingDirectories,
};
const pathSearch = {
  entries: [],
  isPending: false,
  error: null,
  truncated: false,
  refresh: () => {},
};

vi.mock("./useDirectoryEntries", () => ({ useDirectoryEntries: () => directory }));
vi.mock("~/state/queries", () => ({ useProjectPathSearch: () => pathSearch }));
vi.mock("~/fileContextMenu", () => ({
  useFileContextMenu: () => ({ buildItems: () => [], activate: () => Promise.resolve() }),
}));
vi.mock("~/hooks/useWorkspaceMutationRefresh", () => ({ useWorkspaceMutationRefresh: () => {} }));

function findTreeRow(path: string): HTMLElement | null {
  for (const host of document.querySelectorAll("*")) {
    const row = host.shadowRoot?.querySelector<HTMLElement>(`[data-item-path="${path}"]`);
    if (row) return row;
  }
  return null;
}

describe("FileBrowserPanel", () => {
  it("opens a file action dialog from the tree context menu", async () => {
    function EditableFiles() {
      const [selected, setSelected] = useState<string | null>(null);
      return (
        <>
          <FileBrowserPanel
            environmentId={EnvironmentId.make("env-files")}
            cwd="/repo"
            projectName="repo"
            selectedPath={null}
            selectedPathRevealId={0}
            onOpenFile={() => {}}
            workspaceMutationId={null}
            fileActions={{
              disabled: false,
              create: () => {},
              upload: () => {},
              delete: setSelected,
            }}
          />
          <Dialog
            open={selected !== null}
            onOpenChange={(open) => {
              if (!open) setSelected(null);
            }}
          >
            <DialogPopup>
              <DialogTitle>Delete {selected}</DialogTitle>
            </DialogPopup>
          </Dialog>
        </>
      );
    }
    await using _screen = await render(<EditableFiles />);
    await vi.waitFor(() => expect(findTreeRow("src/")).not.toBeNull());
    findTreeRow("src/")!.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, composed: true, cancelable: true }),
    );
    await expect.element(page.getByRole("menuitem", { name: "Delete", exact: true })).toBeVisible();
    const item = page.getByRole("menuitem", { name: "Delete", exact: true }).element();
    (item as HTMLElement).focus();
    item.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await expect.element(page.getByRole("dialog", { name: "Delete src" })).toBeVisible();
  });
  it("drops external files into the targeted folder or root and blocks read-only drops", async () => {
    const upload = vi.fn();
    const actions = { disabled: false, create: vi.fn(), delete: vi.fn(), upload };
    await using screen = await render(
      <FileBrowserPanel
        environmentId={EnvironmentId.make("env-files")}
        cwd="/repo"
        projectName="repo"
        selectedPath={null}
        selectedPathRevealId={0}
        onOpenFile={() => {}}
        workspaceMutationId={null}
        fileActions={actions}
      />,
    );
    await vi.waitFor(() => expect(findTreeRow("src/")).not.toBeNull());
    const transfer = new DataTransfer();
    const file = new File(["prototype"], "prototype.html", { type: "text/html" });
    transfer.items.add(file);
    const folder = findTreeRow("src/")!;
    folder.dispatchEvent(
      new DragEvent("dragover", {
        bubbles: true,
        composed: true,
        cancelable: true,
        dataTransfer: transfer,
      }),
    );
    await vi.waitFor(() =>
      expect(screen.getByRole("status").element().textContent).toContain("src"),
    );
    folder.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        composed: true,
        cancelable: true,
        dataTransfer: transfer,
      }),
    );
    expect(upload).toHaveBeenLastCalledWith([file], "src", false);
    const panel = screen.container.querySelector("[data-file-browser-panel]")!;
    panel.dispatchEvent(
      new DragEvent("dragover", {
        bubbles: true,
        composed: true,
        cancelable: true,
        dataTransfer: transfer,
      }),
    );
    await vi.waitFor(() =>
      expect(screen.getByRole("status").element().textContent).toContain("case root"),
    );
    panel.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        composed: true,
        cancelable: true,
        dataTransfer: transfer,
      }),
    );
    expect(upload).toHaveBeenLastCalledWith([file], "", false);
    await screen.rerender(
      <FileBrowserPanel
        environmentId={EnvironmentId.make("env-files")}
        cwd="/repo"
        projectName="repo"
        selectedPath={null}
        selectedPathRevealId={0}
        onOpenFile={() => {}}
        workspaceMutationId={null}
        fileActions={{ ...actions, disabled: true }}
      />,
    );
    panel.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        composed: true,
        cancelable: true,
        dataTransfer: transfer,
      }),
    );
    expect(upload).toHaveBeenCalledTimes(2);
  });
  it.each([false, true])(
    "dragging a file row carries a composer mention (absolute: %s) without opening it, and dragend releases it",
    async (absoluteFileReferences) => {
      const onOpenFile = vi.fn();
      await using _screen = await render(
        <FileBrowserPanel
          environmentId={EnvironmentId.make("env-files")}
          cwd="/repo"
          projectName="repo"
          selectedPath={null}
          selectedPathRevealId={0}
          onOpenFile={onOpenFile}
          workspaceMutationId={null}
          absoluteFileReferences={absoluteFileReferences}
        />,
      );
      await vi.waitFor(() => expect(findTreeRow("README.md")).not.toBeNull());
      const row = findTreeRow("README.md")!;

      const dataTransfer = new DataTransfer();
      row.dispatchEvent(
        new DragEvent("dragstart", {
          bubbles: true,
          cancelable: true,
          composed: true,
          dataTransfer,
        }),
      );
      // The tree selects the row the drag picked up; mid-drag that must not open it.
      row.click();
      await vi.waitFor(() => expect(row.getAttribute("aria-selected")).toBe("true"));

      const mention = dataTransfer.getData(COMPOSER_MENTION_DRAG_TYPE);
      expect(mention).toContain(absoluteFileReferences ? "/repo/README.md" : "README.md");
      if (!absoluteFileReferences) expect(mention).not.toContain("/repo/");
      expect(onOpenFile).not.toHaveBeenCalled();

      row.dispatchEvent(new DragEvent("dragend", { bubbles: true, composed: true, dataTransfer }));
      await vi.waitFor(() => expect(row.getAttribute("aria-selected")).not.toBe("true"));

      row.click();
      await vi.waitFor(() => expect(onOpenFile).toHaveBeenCalledTimes(1));
      expect(onOpenFile).toHaveBeenCalledWith("README.md");
    },
  );
  it("copies with the pointer and returns to the row after keyboard dismissal", async () => {
    await using _screen = await render(
      <FileBrowserPanel
        environmentId={EnvironmentId.make("env-files")}
        cwd="/repo"
        projectName="repo"
        selectedPath={null}
        selectedPathRevealId={0}
        onOpenFile={() => {}}
        workspaceMutationId={null}
      />,
    );
    using _menu = { [Symbol.dispose]: () => dismissContextMenu() };
    using clipboard = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    await vi.waitFor(() => expect(findTreeRow("README.md")).not.toBeNull());
    findTreeRow("README.md")!.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        composed: true,
        button: 2,
      }),
    );
    const action = page.getByRole("menuitem", { name: "Copy mention", exact: true });
    await expect.element(action).toBeVisible();
    await userEvent.click(action);
    await vi.waitFor(() => expect(clipboard).toHaveBeenCalledWith("[README.md](README.md)"));

    const row = findTreeRow("README.md")!;
    await userEvent.keyboard("{Tab}");
    row.focus();
    await userEvent.keyboard("{Shift>}{F10}{/Shift}");
    await expect.element(action).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect((row.getRootNode() as ShadowRoot).activeElement).toBe(row));
  });

  it("dragging a file row carries a composer mention without opening it, and dragend releases it", async () => {
    const onOpenFile = vi.fn();
    await using _screen = await render(
      <FileBrowserPanel
        environmentId={EnvironmentId.make("env-files")}
        cwd="/repo"
        projectName="repo"
        selectedPath={null}
        selectedPathRevealId={0}
        onOpenFile={onOpenFile}
        workspaceMutationId={null}
      />,
    );
    await vi.waitFor(() => expect(findTreeRow("README.md")).not.toBeNull());
    const row = findTreeRow("README.md")!;

    const dataTransfer = new DataTransfer();
    row.dispatchEvent(
      new DragEvent("dragstart", { bubbles: true, cancelable: true, composed: true, dataTransfer }),
    );
    // The tree selects the row the drag picked up; mid-drag that must not open it.
    row.click();
    await vi.waitFor(() => expect(row.getAttribute("aria-selected")).toBe("true"));

    expect(dataTransfer.getData(COMPOSER_MENTION_DRAG_TYPE)).toContain("README.md");
    expect(onOpenFile).not.toHaveBeenCalled();

    row.dispatchEvent(new DragEvent("dragend", { bubbles: true, composed: true, dataTransfer }));
    await vi.waitFor(() => expect(row.getAttribute("aria-selected")).not.toBe("true"));

    row.click();
    await vi.waitFor(() => expect(onOpenFile).toHaveBeenCalledTimes(1));
  });
});
