import { it, expect } from "@effect/vitest";
import { FogBugzError, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { FogBugzService } from "./FogBugzService.ts";
import { openCase } from "./FogBugzBrowser.ts";
import { PreviewManager } from "../preview/Manager.ts";
import { ServerBrowser } from "../preview/ServerBrowser.ts";

it.effect("opens the case for manual sign-in only when the browser exchange is unsupported", () => {
  let failure: FogBugzError["code"] | null = null;
  const opened: string[] = [];
  const dependencies = Layer.mergeAll(
    Layer.mock(FogBugzService)({
      browserSession: () =>
        failure
          ? Effect.fail(new FogBugzError({ code: failure }))
          : Effect.succeed({
              url: "https://fogbugz.example/default.asp?42",
              baseUrl: "https://fogbugz.example/",
              cookie: "private-cookie",
            }),
      thread: (threadId) =>
        Effect.succeed({
          threadId,
          projectId: "project" as never,
          caseId: 42,
          title: "Test",
          url: "https://fogbugz.example/default.asp?42",
        }),
    }),
    Layer.mock(ServerBrowser)({
      openAuthenticated: (input) =>
        Effect.sync(() => {
          opened.push(`authenticated:${input.url}`);
          return {} as never;
        }),
    }),
    Layer.mock(PreviewManager)({
      open: (input) =>
        Effect.sync(() => {
          opened.push(`manual:${input.url}`);
          return {} as never;
        }),
    }),
  );
  return Effect.gen(function* () {
    const input = { threadId: ThreadId.make("thread"), url: "https://untrusted.example/" };
    yield* openCase(input);
    failure = "unsupported";
    yield* openCase(input);
    expect(opened).toEqual([
      "authenticated:https://fogbugz.example/default.asp?42",
      "manual:https://fogbugz.example/default.asp?42",
    ]);
    for (const code of ["authentication", "access", "network", "response"] as const) {
      failure = code;
      expect(yield* openCase(input).pipe(Effect.flip)).toMatchObject({ code });
    }
    expect(opened).toHaveLength(2);
  }).pipe(Effect.provide(dependencies));
});
