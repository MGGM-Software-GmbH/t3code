/// <reference lib="dom" />
// Check the toast's position once its entry transition brings it inside the viewport.
import { expect } from "e2e";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import { T3_HOME } from "../e2e.config.ts";
import { runPromise, test, WEB } from "./t3.ts";

test(
  "Opening VS Code shows progress and explains a missing connection in the user's language",
  WEB,
  async ({ t3, app, screen, browser }) => {
    const toastFits = () =>
      browser.evaluate(() => {
        const title = document.querySelector('[data-slot="toast-title"]');
        const rect = title?.closest("[data-position]")?.getBoundingClientRect();
        return !!rect && rect.left >= 0 && rect.right <= window.innerWidth && rect.top >= 0;
      });
    const project = await t3.project("Editor");
    const thread = await t3.thread({ project, title: "Editor", messages: [] });
    await t3.open("/settings/general");
    await screen.getByLabel("Language", { exact: true }).tap();
    await screen.getByText("Deutsch", { exact: true }).tap();
    await screen.getByLabel("Sprache", { exact: true }).waitFor();

    await t3.open(thread);
    await screen.getByRole("button", "Thread-Detailpanel umschalten").tap();
    await screen.getByRole("button", "Editor wählen").tap();
    await screen.getByRole("menuitem", "VS Code", { exact: true }).tap();
    const gate = `${T3_HOME}/bin/code.wait`;
    await runPromise(Effect.flatMap(FileSystem.FileSystem, (fs) => fs.writeFileString(gate, "")));
    const progress = screen.getByText("Warten auf VS Code…", { exact: true });
    try {
      await screen.getByRole("button", "In VS Code öffnen", { exact: true }).tap();
      await expect(progress).toBeVisible();
      await expect.poll(toastFits).toBe(true);
      await app.screenshot("waiting-for-vscode");
    } finally {
      await runPromise(
        Effect.flatMap(FileSystem.FileSystem, (fs) => fs.remove(gate, { force: true })),
      );
    }
    await expect(
      screen.getByText(
        "VS Code ist nicht verfügbar (Code 69). Öffne ein Fenster mit Verbindung zu dieser Umgebung und versuche es erneut.",
      ),
    ).toBeVisible();
    await expect(progress).not.toBeVisible();
    await expect.poll(toastFits).toBe(true);
    await app.screenshot("vscode-unavailable");
    await browser.setViewport({ width: 390, height: 844 });
    await expect.poll(toastFits).toBe(true);
    await app.screenshot("vscode-unavailable-narrow");
  },
);
