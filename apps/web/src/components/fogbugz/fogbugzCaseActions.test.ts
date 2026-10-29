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
  "uses the case history for %s without invoking the other action",
  async (action) => {
    const addContext = vi.fn<(text: string) => void>();
    const sendMessage = vi.fn<(text: string) => Promise<void>>(async () => {});
    await performFogBugzCaseAction(action, {
      loadContext: async () => context,
      isCurrentThread: () => true,
      addContext,
      sendMessage,
    });
    const text =
      action === "context" ? addContext.mock.calls[0]?.[0] : sendMessage.mock.calls[0]?.[0];
    expect(text).toContain("FogBugz #42: Repair notifications");
    expect(text).toContain(context.url);
    expect(text).toContain(
      "Reporter (2026-10-29T10:00:00Z):\nNotify every project member.\nPreserve user preferences.",
    );
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

it.each(["navigation", "load failure"])("does not change any thread after %s", async (reason) => {
  const addContext = vi.fn();
  const sendMessage = vi.fn(async () => {});
  await expect(
    performFogBugzCaseAction("implement", {
      loadContext: async () => {
        if (reason === "load failure") throw new Error("Access denied");
        return context;
      },
      isCurrentThread: () => reason !== "navigation",
      addContext,
      sendMessage,
    }),
  ).rejects.toThrow(reason === "navigation" ? "active thread changed" : "Access denied");
  expect(addContext).not.toHaveBeenCalled();
  expect(sendMessage).not.toHaveBeenCalled();
});
