import { FogBugzError, type FogBugzCreateThreadInput } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { FogBugzService } from "./FogBugzService.ts";
import { ThreadManagementService } from "../orchestration-v2/ThreadManagementService.ts";

export const createThread = Effect.fn("FogBugz.createThread")(function* (
  input: typeof FogBugzCreateThreadInput.Type,
) {
  const fogbugz = yield* FogBugzService;
  const threads = yield* ThreadManagementService;
  // Reserve the binding first; a retry with the same command/thread IDs repairs an interrupted creation.
  const item = yield* fogbugz.prepareThread(input);
  yield* threads
    .dispatch({
      type: "thread.create",
      commandId: input.commandId,
      threadId: input.threadId,
      projectId: input.projectId,
      title: `#${item.id} ${item.title}`,
      modelSelection: input.modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdBy: "user",
      creationSource: "web",
    })
    .pipe(Effect.mapError(() => new FogBugzError({ code: "thread" })));
  return input.threadId;
});
