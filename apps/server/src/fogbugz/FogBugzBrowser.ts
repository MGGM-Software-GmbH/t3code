import { type PreviewOpenInput } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { FogBugzService } from "./FogBugzService.ts";
import * as ServerBrowser from "../preview/ServerBrowser.ts";

export const openCase = Effect.fn("FogBugz.openCase")(function* (input: PreviewOpenInput) {
  const fogbugz = yield* FogBugzService;
  const browser = yield* ServerBrowser.ServerBrowser;
  const session = yield* fogbugz.browserSession(input.threadId);
  return yield* browser.openAuthenticated({ ...input, url: session.url }, session);
});
