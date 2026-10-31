export type FogBugzCaseAction = "context" | "prp" | "implement";

export const fogbugzCaseActions = [
  ["context", "Add to Context"],
  ["prp", "Create PRP"],
  ["implement", "Implement"],
] as const;

export function fogbugzCasePrompt(action: FogBugzCaseAction, caseId: number, baseUrl: string) {
  const url = new URL(`default.asp?${caseId}`, baseUrl).href;
  const read = `Use the FogBugz MCP to read case #${caseId}, including its description and history, before working with it.`;
  const instruction =
    action === "context"
      ? "Use this case as context for my request. Do not start implementation from this reference alone."
      : action === "prp"
        ? "Create a PRP for this case in the linked case Git checkout, never in the project's docs/prp/ directory. Follow the project's PRP conventions with their output paths redirected to the case checkout. Inspect the relevant code, describe the implementation and validation plan, and identify open questions. Do not implement the changes yet."
        : "Implement this case in the current project. Follow the project's instructions, inspect the relevant code, make the required changes, and run focused validation. Report the changes, test results, and any blockers.";
  return `[FogBugz #${caseId}](${url} "${read} ${instruction}")`;
}

export async function performFogBugzCaseAction(
  action: FogBugzCaseAction,
  options: {
    caseId: number;
    baseUrl: string;
    isCurrentThread: () => boolean;
    addContext: (text: string) => void;
    sendMessage: (text: string) => Promise<void>;
  },
) {
  if (!options.isCurrentThread()) {
    throw new Error("The active thread changed. Select the case action again in that thread.");
  }
  const text = fogbugzCasePrompt(action, options.caseId, options.baseUrl);
  if (action === "context") {
    options.addContext(text);
    return;
  }
  await options.sendMessage(text);
}
