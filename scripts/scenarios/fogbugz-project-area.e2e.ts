// @effect-diagnostics-next-line nodeBuiltinImport:off - Serves the external FogBugz fixture to the real T3 server.
import * as NodeHttp from "node:http";
import { expect } from "e2e";

import { test, WEB } from "./t3.ts";

test(
  "A project can select one FogBugz area while a project group includes every area",
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
            "<projects><project><ixProject>12</ixProject><sProject>OPS</sProject></project></projects><projectGroups><membership><ixProject>12</ixProject><ixProjectGroup>3</ixProjectGroup><sProjectGroup>MGGM</sProjectGroup></membership></projectGroups>";
          break;
        case "listAreas":
          content =
            "<areas><area><ixArea>1</ixArea><sArea>General</sArea><ixProject>12</ixProject></area><area><ixArea>2</ixArea><sArea>Support</sArea><ixProject>12</ixProject></area></areas>";
          break;
        case "browserSession":
          content = '<error code="3">Not supported</error>';
          break;
        case "caseGitRepository":
          content = '<error code="27">Not supported</error>';
          break;
        case "listCategories":
          content =
            "<categories><category><ixCategory>1</ixCategory><nIconType>1</nIconType></category></categories>";
          break;
        case "search":
          // Include both areas so the real service must also enforce the selected scope locally.
          content = `<cases>${[1, 2].map((area) => `<case><ixBug>${40 + area}</ixBug><sTitle>${area === 1 ? "General inquiry" : "Support request"}</sTitle><ixProject>12</ixProject><ixArea>${area}</ixArea><sProject>OPS</sProject><sStatus>Active</sStatus><fOpen>true</fOpen><ixPersonAssignedTo>7</ixPersonAssignedTo><sPersonAssignedTo>Scenario User</sPersonAssignedTo><ixPriority>2</ixPriority><sPriority>Normal</sPriority><ixCategory>1</ixCategory><sCategory>Bug</sCategory><dtLastUpdated>2026-11-14T08:00:00Z</dtLastUpdated></case>`).join("")}</cases>`;
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
    const openProjectSettings = async () => {
      await app.open("/settings/projects");
      await screen.getByRole("button", "Project scope: All projects").tap();
      await screen.getByRole("menuitemradio", "fogbugz-area", { exact: true }).tap();
    };

    await t3.project("fogbugz-area");
    let connected = false;
    try {
      await t3.open();
      await expect(screen.getByText("fogbugz-area", { exact: true }).first()).toBeVisible();
      await app.open("/settings/mggm");
      await screen
        .getByRole("textbox", "FogBugz base URL")
        .fill(`http://127.0.0.1:${address.port}/`);
      await screen.getByRole("textbox", "FogBugz account").fill("scenario@example.invalid");
      await screen.getByLabel("FogBugz password").fill("scenario-password");
      await screen.getByRole("button", "Connect", { exact: true }).tap();
      await expect(screen.getByText("Connected as Scenario User.")).toBeVisible();
      connected = true;
      await openProjectSettings();
      await screen.getByRole("combobox", /FogBugz project/).tap();
      await screen.getByRole("option", "OPS", { exact: true }).tap();
      const area = screen.getByRole("combobox", /FogBugz area/);
      await expect(area).toBeVisible();
      await area.tap();
      await screen.getByRole("option", "Support", { exact: true }).tap();
      await app.screenshot("project-area");
      await app.open("/cases");
      await expect(screen.getByText("Support request", { exact: true })).toBeVisible();
      await expect(screen.getByText("General inquiry", { exact: true })).toBeHidden();
      await app.screenshot("area-cases");
      await openProjectSettings();
      await area.tap();
      await screen.getByRole("option", "All areas", { exact: true }).tap();
      await app.open("/cases");
      await expect(screen.getByText("Support request", { exact: true })).toBeVisible();
      await expect(screen.getByText("General inquiry", { exact: true })).toBeVisible();
      await openProjectSettings();
      await area.tap();
      await screen.getByRole("option", "Support", { exact: true }).tap();
      await screen.getByRole("combobox", /FogBugz project/).tap();
      await screen.getByRole("option", "Group: MGGM", { exact: true }).tap();
      await expect(area).toBeHidden();
      await app.screenshot("group-without-area");
      await app.open("/cases");
      await expect(screen.getByText("General inquiry", { exact: true })).toBeVisible();
      await expect(screen.getByText("Support request", { exact: true })).toBeVisible();
    } finally {
      if (connected) {
        await app.open("/settings/mggm");
        await screen.getByRole("button", "Disconnect", { exact: true }).tap();
        await expect(screen.getByRole("button", "Connect", { exact: true })).toBeVisible();
      }
    }
  },
);
