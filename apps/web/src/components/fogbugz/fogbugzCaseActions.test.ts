import { expect, it, vi } from "vite-plus/test";
import type { FogBugzCaseContext } from "@t3tools/contracts";
import { performFogBugzCaseAction } from "./fogbugzCaseActions";

const context: FogBugzCaseContext = {
  case: {
    id: 42,
    title: "Repair notifications",
    projectId: 12,
    projectName: "OPS",
    status: "1 ToDo",
    open: true,
    assignedTo: 7,
    assignedToName: "Test User",
    priority: "High",
    categoryId: 1,
    categoryName: "Bug",
    categoryIconType: 1,
    notifiedAt: null,
    updatedAt: null,
  },
  url: "https://fogbugz.example/default.asp?42",
  events: [
    {
      id: 501,
      author: "Reporter",
      createdAt: "2026-10-29T10:00:00Z",
      text: "Notify every project member.\nPreserve user preferences.",
    },
  ],
};

it.each(["context", "prp", "implement"] as const)(
  "references the case through MCP for %s without embedding the case history",
  async (action) => {
    const addContext = vi.fn<(text: string) => void>();
    const sendMessage = vi.fn<(text: string) => Promise<void>>(async () => {});
    await performFogBugzCaseAction(action, {
      caseId: context.case.id,
      baseUrl: "https://fogbugz.example/",
      isCurrentThread: () => true,
      addContext,
      sendMessage,
    });
    const text =
      action === "context" ? addContext.mock.calls[0]?.[0] : sendMessage.mock.calls[0]?.[0];
    expect(text).toContain("[FogBugz #42]");
    expect(text).toContain(context.url);
    expect(text).toContain("Use the FogBugz MCP to read case #42");
    expect(text).not.toContain(context.case.title);
    expect(text).not.toContain(context.events[0]!.text);
    if (action === "context") {
      expect(sendMessage).not.toHaveBeenCalled();
    } else {
      expect(addContext).not.toHaveBeenCalled();
      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(text).toContain(
        action === "prp" ? "Do not implement the changes yet." : "run focused validation",
      );
    }
  },
);

it("does not change a different thread after navigation", async () => {
  const addContext = vi.fn();
  const sendMessage = vi.fn(async () => {});
  await expect(
    performFogBugzCaseAction("implement", {
      caseId: 42,
      baseUrl: "https://fogbugz.example/",
      isCurrentThread: () => false,
      addContext,
      sendMessage,
    }),
  ).rejects.toThrow("active thread changed");
  expect(addContext).not.toHaveBeenCalled();
  expect(sendMessage).not.toHaveBeenCalled();
});
