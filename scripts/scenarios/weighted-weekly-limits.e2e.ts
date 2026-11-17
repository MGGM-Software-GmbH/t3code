// @effect-diagnostics-next-line nodeBuiltinImport:off - Serves quota fixtures to the real usage-limit hub adapter.
import * as NodeHttp from "node:http";
import { expect } from "e2e";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { T3_HOME } from "../e2e.config.ts";
import { runPromise, test, WEB } from "./t3.ts";

const decodeSettings = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
);
const encodeSettings = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeCall = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ auth_index: Schema.String, url: Schema.String })),
);

test(
  "Weekly limits weight Pro and Business seats by their allowance",
  WEB,
  async ({ t3, app, screen, browser }) => {
    const capture = async (label: string) => {
      // Capture the settled view rather than an intermediate tooltip or drawer transition.
      await browser.evaluate(`() => {
        for (const animation of document.getAnimations()) {
          if (animation.effect?.getComputedTiming().iterations !== Infinity) animation.finish();
        }
        return null;
      }`);
      await app.screenshot(label);
    };
    const accounts = [
      { plan: "promax", used: 0 },
      { plan: "pro", used: 100 },
      { plan: "pro", used: 100 },
      { plan: "pro", used: 100 },
      { plan: "team", used: 100 },
      { plan: "self_serve_business_prolite", used: 100 },
    ];
    await using hub = NodeHttp.createServer(async (request, response) => {
      response.setHeader("Content-Type", "application/json");
      if (request.url === "/v0/management/auth-files") {
        response.end(
          encodeJson({
            files: accounts.map((account, index) => ({
              id: `account-${index}.json`,
              auth_index: String(index),
              provider: "codex",
              email: `account-${index}@example.invalid`,
              id_token: { plan_type: account.plan },
            })),
          }),
        );
        return;
      }
      if (request.url !== "/v0/management/api-call") {
        response.writeHead(404).end();
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const call = decodeCall(Buffer.concat(chunks).toString());
      const account = accounts[Number(call.auth_index)];
      if (!account) {
        response.writeHead(400).end();
        return;
      }
      const body = call.url.endsWith("/rate-limit-reset-credits")
        ? { credits: [] }
        : {
            plan_type: account.plan,
            rate_limit: {
              secondary_window: {
                used_percent: account.used,
                reset_at: 4070908800,
                limit_window_seconds: 604800,
              },
            },
          };
      response.end(encodeJson({ status_code: 200, body: encodeJson(body) }));
    });
    await new Promise<void>((resolve) => hub.listen(0, "127.0.0.1", resolve));
    const address = hub.address();
    if (address === null || typeof address === "string") throw new Error("No hub fixture port");
    await t3.project("WeightedLimits");
    await runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const settingsPath = path.join(T3_HOME, "userdata/settings.json");
        const settings = yield* fs
          .readFileString(settingsPath)
          .pipe(Effect.flatMap(decodeSettings));
        yield* fs.writeFileString(
          settingsPath,
          yield* encodeSettings({
            ...settings,
            usageLimitSources: {
              scenario: {
                kind: "cliproxy",
                label: "Plan fixture",
                enabled: true,
                url: `http://127.0.0.1:${address.port}`,
                managementKey: "scenario-key",
              },
            },
          }),
        );
      }),
    );
    await t3.open();
    await expect(
      screen.getByRole("button", /^Weekly limit, all accounts: \d+% remaining$/),
    ).toBeVisible();
    await screen.getByRole("button", /^Weekly limit, all accounts: \d+% remaining$/).hover();
    await expect(screen.getByText("Weekly limit, all accounts", { exact: true })).toBeVisible();
    await capture("weighted-weekly-limit");
    await expect(
      screen.getByRole("button", "Weekly limit, all accounts: 41% remaining", { exact: true }),
    ).toBeVisible();
    await browser.keyboard.press("Escape");
    await browser.setViewport({ width: 390, height: 844 });
    await screen.getByRole("button", "Toggle main sidebar", { exact: true }).tap();
    await screen
      .getByRole("button", "Weekly limit, all accounts: 41% remaining", { exact: true })
      .hover();
    await expect(screen.getByText("Weekly limit, all accounts", { exact: true })).toBeVisible();
    await capture("weighted-weekly-limit-narrow");
    await screen.getByText(/^Updated /).scrollIntoView();
    await expect(screen.getByText(/^Updated /)).toBeVisible();
    await capture("weighted-weekly-limit-narrow-scrolled");
  },
);
