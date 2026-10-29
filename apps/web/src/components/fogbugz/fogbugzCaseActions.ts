import type { FogBugzCaseContext } from "@t3tools/contracts";

export type FogBugzCaseAction = "context" | "prp" | "implement";

export async function performFogBugzCaseAction(
  action: FogBugzCaseAction,
  options: {
    loadContext: () => Promise<FogBugzCaseContext>;
    isCurrentThread: () => boolean;
    addContext: (text: string) => void;
    sendMessage: (text: string) => Promise<void>;
  },
) {
  const context = await options.loadContext();
  if (!options.isCurrentThread()) {
    throw new Error("The active thread changed. Select the case action again in that thread.");
  }
  const item = context.case;
  const text = [
    `FogBugz #${item.id}: ${item.title}`,
    context.url,
    `Project: ${item.projectName} | Status: ${item.status} | Priority: ${item.priority} | Assigned to: ${item.assignedToName}`,
    ...context.events
      .filter((event) => event.text.trim())
      .map(
        (event) =>
          `\n${event.author}${event.createdAt ? ` (${event.createdAt})` : ""}:\n${event.text}`,
      ),
  ].join("\n");
  if (action === "context") {
    options.addContext(text);
    return;
  }
  const instruction =
    action === "prp"
      ? "Create a PRP for the FogBugz case below in the current project. Follow the project's instructions and PRP conventions. Inspect the relevant code, describe the implementation and validation plan, and identify open questions. Do not implement the changes yet."
      : "Implement the FogBugz case below in the current project. Follow the project's instructions, inspect the relevant code, make the required changes, and run focused validation. Report the changes, test results, and any blockers.";
  await options.sendMessage(`${instruction}\n\n${text}`);
}
