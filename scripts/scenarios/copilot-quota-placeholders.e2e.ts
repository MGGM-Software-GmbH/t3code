import * as HostProcess from "@t3tools/shared/HostProcess";
import { expect } from "e2e";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { APP_DIR, T3_HOME } from "../e2e.config.ts";
import { runPromise, test, WEB } from "./t3.ts";

const settingsRecord = Schema.Record(Schema.String, Schema.Unknown);
const decodeSettings = Schema.decodeUnknownEffect(Schema.fromJsonString(settingsRecord));
const decodeInstances = Schema.decodeUnknownEffect(settingsRecord);
const encodeSettings = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

test(
  "Copilot without quota data has no limit placeholder",
  WEB,
  async ({ t3, app, screen, browser }) => {
    await t3.project("CopilotLimits");
    await runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const settingsPath = path.join(T3_HOME, "userdata/settings.json");
        const settings = yield* fs
          .readFileString(settingsPath)
          .pipe(Effect.flatMap(decodeSettings));
        const instances = yield* decodeInstances(settings.providerInstances);
        // The real ACP driver probes a local fixture; selecting a model starts no paid agent.
        yield* fs.writeFileString(
          settingsPath,
          yield* encodeSettings({
            ...settings,
            providerInstances: {
              ...instances,
              githubCopilot: {
                driver: "acpRegistry",
                displayName: "GitHub Copilot",
                enabled: true,
                config: {
                  source: "local",
                  commandPath: yield* HostProcess.ExecutablePath,
                  commandArgs: [path.join(APP_DIR, "apps/server/scripts/acp-mock-agent.ts")],
                },
              },
            },
          }),
        );
      }),
    );
    await t3.open();
    await expect(screen.getByRole("button", "Showcase", { exact: true })).toBeVisible();
    await screen.getByRole("button", "Showcase", { exact: true }).tap();
    const copilot = screen.getByRole("button", "GitHub Copilot", { exact: true });
    await expect(copilot).toBeVisible();
    await app.screenshot("copilot-model-picker");
    await expect(
      screen.getByRole("img", "GitHub Copilot: Weekly limit unavailable", { exact: true }),
    ).toBeHidden();
    await copilot.tap();
    await screen.getByRole("option", /^Auto\s*,\s*GitHub Copilot/).tap();
    await expect(screen.getByRole("button", /^Auto,/)).toBeVisible();
    await browser.keyboard.press("Escape");
    await app.screenshot("copilot-composer");
    await expect(
      screen.getByRole("button", "Weekly limit, GitHub Copilot: unavailable", { exact: true }),
    ).toBeHidden();
  },
);
