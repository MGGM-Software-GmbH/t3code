import { FogBugzError, type PreviewOpenInput } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { FogBugzService } from "./FogBugzService.ts";
import * as ServerBrowser from "../preview/ServerBrowser.ts";
import { PreviewManager } from "../preview/Manager.ts";

export const openCase = Effect.fn("FogBugz.openCase")(function* (input: PreviewOpenInput) {
  const fogbugz = yield* FogBugzService;
  const browser = yield* ServerBrowser.ServerBrowser;
  const session = yield* fogbugz.browserSession(input.threadId).pipe(
    Effect.catchTags({
      FogBugzError: (error) =>
        error.code === "unsupported" ? Effect.succeed(null) : Effect.fail(error),
    }),
  );
  if (session) return yield* browser.openAuthenticated({ ...input, url: session.url }, session);
  const linked = yield* fogbugz.thread(input.threadId);
  if (!linked) return yield* new FogBugzError({ code: "thread" });
  return yield* (yield* PreviewManager).open({ ...input, url: linked.url });
});
