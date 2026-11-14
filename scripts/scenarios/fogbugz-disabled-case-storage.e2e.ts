// @effect-diagnostics-next-line nodeBuiltinImport:off - Serves the external FogBugz fixture to the real T3 server.
import * as NodeHttp from "node:http";
import { expect } from "e2e";

import { test, WEB } from "./t3.ts";

test(
  "A linked FogBugz thread remains usable when its project has no case file storage",
  WEB,
  async ({ t3, app, screen }) => {
    await using api = NodeHttp.createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const parameters = new URLSearchParams(Buffer.concat(chunks).toString());
      let content: string;
      switch (parameters.get("cmd")) {
        case "logon":
          content = "<token>scenario-token</token>";
          break;
        case "viewPerson":
          content = "<person><ixPerson>7</ixPerson><sFullName>Scenario User</sFullName></person>";
          break;
        case "listProjects":
          content =
            "<projects><project><ixProject>12</ixProject><sProject>Storage disabled</sProject></project></projects><projectGroups/>";
          break;
        case "browserSession":
          content = '<error code="10">POST token required</error>';
          break;
        case "listAreas":
          content =
            "<areas><area><ixArea>1</ixArea><sArea>General</sArea><ixProject>12</ixProject></area></areas>";
          break;
        case "caseGitRepository":
          content = '<error code="13">No access to case files</error>';
          break;
        case "listCategories":
          content =
            "<categories><category><ixCategory>1</ixCategory><nIconType>1</nIconType></category></categories>";
          break;
        case "search":
          content =
            "<cases><case><ixBug>42</ixBug><sTitle>Optional storage</sTitle><ixProject>12</ixProject><ixArea>1</ixArea><sProject>Storage disabled</sProject><sStatus>Active</sStatus><fOpen>true</fOpen><ixPersonAssignedTo>7</ixPersonAssignedTo><sPersonAssignedTo>Scenario User</sPersonAssignedTo><ixPriority>2</ixPriority><sPriority>Normal</sPriority><ixCategory>1</ixCategory><sCategory>Bug</sCategory><dtLastUpdated>2026-11-14T08:00:00Z</dtLastUpdated></case></cases>";
          break;
        default:
          response.writeHead(400).end();
          return;
      }
      response.writeHead(200, { "Content-Type": "application/xml" });
      response.end(`<response>${content}</response>`);
    });
    await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
    const address = api.address();
    if (address === null || typeof address === "string") throw new Error("No API fixture port");

    const project = await t3.project("fogbugz-storage");
    await t3.thread({ project, title: "Optional storage", messages: ["Start"] });
    let connected = false;
    try {
      await t3.open();
      await expect(screen.getByText("Optional storage", { exact: true }).first()).toBeVisible();
      await app.open("/settings/mggm");
      await screen
        .getByRole("textbox", "FogBugz base URL")
        .fill(`http://127.0.0.1:${address.port}/`);
      await screen.getByRole("textbox", "FogBugz account").fill("scenario@example.invalid");
      await screen.getByLabel("FogBugz password").fill("scenario-password");
      await screen.getByRole("button", "Connect", { exact: true }).tap();
      await expect(screen.getByText("Connected as Scenario User.")).toBeVisible();
      connected = true;

      await app.open("/settings/projects");
      await screen.getByRole("button", "Project scope: All projects").tap();
      await screen.getByRole("menuitemradio", "fogbugz-storage", { exact: true }).tap();
      await screen.getByRole("combobox", /FogBugz project/).tap();
      await screen.getByRole("option", "Storage disabled", { exact: true }).tap();
      await app.open("/");
      await screen.getByRole("button", /^Optional storage,/).tap();
      await screen.getByRole("button", "Toggle thread details panel", { exact: true }).tap();
      await screen.getByRole("button", "Link FogBugz case", { exact: true }).tap();
      await screen.getByRole("spinbutton", "FogBugz case number").fill("42");
      await screen.getByRole("button", "Link case", { exact: true }).tap();
      await screen.getByRole("button", "FogBugz-Case-Git", { exact: true }).tap();
      await expect(screen.getByRole("button", "Retry", { exact: true })).toBeVisible();
      await app.screenshot("unavailable-storage");
      await expect(
        screen.getByText("Case Git files are unavailable.", { exact: false }),
      ).toBeVisible();
      await expect(screen.getByText("Unable to prepare FogBugz case files")).toBeHidden();

      await screen.getByRole("textbox").fill("Continue without case files");
      await screen.getByRole("textbox").press("Enter");
      await expect(
        screen.getByText("second fixture turn complete", { exact: false }),
      ).toBeVisible();
      await expect(screen.getByRole("button", "Stop generation", { exact: true })).toBeHidden();
      await app.screenshot("ordinary-turn");
    } finally {
      if (connected) {
        await app.open("/settings/mggm");
        await screen.getByRole("button", "Disconnect", { exact: true }).tap();
        await expect(screen.getByRole("button", "Connect", { exact: true })).toBeVisible();
      }
    }
  },
);
