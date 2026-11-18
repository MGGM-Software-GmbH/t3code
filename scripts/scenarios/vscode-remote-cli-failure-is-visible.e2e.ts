/// <reference lib="dom" />
// Die DOM-Typen gelten für die im Browser geprüften Meldungsgrenzen.
import { expect } from "e2e";

import { test, WEB } from "./t3.ts";

test(
  "Eine fehlende VS-Code-Verbindung wird beim Öffnen des Editors angezeigt",
  WEB,
  async ({ t3, app, screen, browser }) => {
    const projekt = await t3.project("Editorprüfung");
    const thread = await t3.thread({ project: projekt, title: "Editor öffnen", messages: [] });
    await t3.open(thread);

    await screen.getByRole("button", "Toggle thread details panel").tap();
    await screen.getByRole("button", "Choose editor").tap();
    await screen.getByRole("menuitem", "VS Code", { exact: true }).tap();
    await screen.getByRole("button", "Open in VS Code", { exact: true }).tap();
    await expect(
      screen.getByText(
        "VS Code konnte nicht geöffnet werden (Fehlercode 69). Bitte die Verbindung zu einem geöffneten VS-Code-Fenster prüfen.",
      ),
    ).toBeVisible();
    await expect
      .poll(() =>
        browser.evaluate(() => {
          const meldung = document.querySelector('[data-slot="toast-description"]');
          const grenzen = meldung?.getBoundingClientRect();
          return grenzen !== undefined && grenzen.right <= window.innerWidth;
        }),
      )
      .toBe(true);
    await app.screenshot("vscode-verbindungsfehler");
  },
);
