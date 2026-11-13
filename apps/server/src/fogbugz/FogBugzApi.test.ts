import { describe, expect, it, vi } from "vite-plus/test";
import { FogBugzApi, normalizeFogBugzUrl } from "./FogBugzApi.ts";

describe("FogBugz API", () => {
  it("detects optional extensions without creating a browser session or case repository", async () => {
    let modern = false;
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, request) => {
      const parameters = new URLSearchParams(String(request?.body));
      switch (parameters.get("cmd")) {
        case "listProjects":
          return new Response(
            `<response><projects><project><ixProject>12</ixProject><sProject>OPS</sProject></project></projects>${modern ? "<projectGroups/>" : ""}</response>`,
          );
        case "browserSession":
          expect(parameters.has("token")).toBe(false);
          return new Response(
            `<response><error code="${modern ? 10 : 3}">Private message</error></response>`,
          );
        case "caseGitRepository":
          expect(parameters.get("ixBug")).toBe("0");
          return new Response(
            `<response><error code="${modern ? 13 : 27}">Private message</error></response>`,
          );
        default:
          throw new Error("Unexpected API command");
      }
    });
    const api = new FogBugzApi("https://fogbugz.example/", fetch);
    expect(await api.capabilities("private-token")).toEqual({
      projectGroups: false,
      browserSession: false,
      caseGit: false,
    });
    expect(await api.projects("private-token")).toEqual([{ id: 12, name: "OPS", groups: [] }]);
    await expect(api.projects("private-token", true)).rejects.toMatchObject({
      code: "project_groups_unsupported",
    });
    modern = true;
    expect(await api.capabilities("private-token")).toEqual({
      projectGroups: true,
      browserSession: true,
      caseGit: true,
    });
    fetch.mockResolvedValue(
      new Response('<response><error code="3">Expired secret</error></response>'),
    );
    await expect(api.capabilities("private-token")).rejects.toMatchObject({
      code: "authentication",
    });
    fetch.mockResolvedValue(new Response("Unavailable", { status: 503 }));
    await expect(api.capabilities("private-token")).rejects.toMatchObject({ code: "network" });
  });

  it("distinguishes resolved and closed cases using the status catalog and preserves assignment events", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, request) => {
      const parameters = new URLSearchParams(String(request?.body));
      if (parameters.get("cmd") === "listStatuses")
        return new Response(
          "<response><statuses><status><ixStatus>9</ixStatus></status></statuses></response>",
        );
      if (parameters.get("cols") === "ixBug,events")
        return new Response(
          "<response><cases><case><ixBug>42</ixBug><events><event><ixBugEvent>1</ixBugEvent><sVerb>Opened</sVerb><ixPersonAssignedTo>0</ixPersonAssignedTo><dt>2026-10-30T12:00:00Z</dt></event><event><ixBugEvent>2</ixBugEvent><sVerb>Assigned</sVerb><ixPersonAssignedTo>7</ixPersonAssignedTo><dt>2026-10-30T12:01:00Z</dt></event></events></case></cases></response>",
        );
      return new Response(
        "<response><cases><case><ixBug>42</ixBug><ixProject>12</ixProject><ixStatus>9</ixStatus><fOpen>true</fOpen><ixPersonAssignedTo>7</ixPersonAssignedTo><ixBugEventLatest>2</ixBugEventLatest><dtOpened>2026-10-30T12:00:00Z</dtOpened></case><case><ixBug>43</ixBug><ixProject>12</ixProject><ixStatus>9</ixStatus><fOpen>false</fOpen><ixPersonAssignedTo>7</ixPersonAssignedTo><ixBugEventLatest>3</ixBugEventLatest><dtOpened>2026-10-30T12:00:00Z</dtOpened></case></cases></response>",
      );
    });
    const api = new FogBugzApi("https://fogbugz.example/", fetch);
    const states = await api.caseStates("private-token", "project:=12 assignedto:me");
    expect(states).toMatchObject([
      { id: 42, resolved: true, open: true },
      { id: 43, resolved: true, open: false },
    ]);
    expect(await api.assignmentEvents("private-token", 42)).toEqual([
      { id: 1, verb: "Opened", assignedTo: 0, createdAt: "2026-10-30T12:00:00.000Z" },
      { id: 2, verb: "Assigned", assignedTo: 7, createdAt: "2026-10-30T12:01:00.000Z" },
    ]);
    fetch.mockImplementation(async () => new Response("<response><statuses/></response>"));
    await expect(api.caseStates("private-token", "project:=12")).rejects.toMatchObject({
      code: "response",
    });
    fetch.mockImplementation(
      async (_url, request) =>
        new Response(
          new URLSearchParams(String(request?.body)).get("cmd") === "listStatuses"
            ? "<response><statuses/></response>"
            : "<response><cases><case><ixBug>42</ixBug><ixProject>12</ixProject><ixStatus>1</ixStatus><fOpen>unknown</fOpen></case></cases></response>",
        ),
    );
    await expect(api.caseStates("private-token", "project:=12")).rejects.toMatchObject({
      code: "response",
    });
  });
  it("loads visible case history as text with a POST and rejects a different case", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(
          "<response><cases><case><ixBug>42</ixBug><events><event><ixBugEvent>501</ixBugEvent><sPerson>Test &amp; User</sPerson><dt>2026-10-29T08:00:00Z</dt><s><![CDATA[Requirements <with markup>\nSecond line]]></s></event></events></case></cases></response>",
        ),
      );
    const api = new FogBugzApi("https://fogbugz.example/", fetch);
    expect(await api.caseEvents("private-token", 42)).toEqual([
      {
        id: 501,
        author: "Test & User",
        createdAt: "2026-10-29T08:00:00.000Z",
        text: "Requirements <with markup>\nSecond line",
      },
    ]);
    expect(fetch.mock.calls[0]?.[1]?.method).toBe("POST");
    const body = new URLSearchParams(String(fetch.mock.calls[0]?.[1]?.body));
    expect(Object.fromEntries(body)).toMatchObject({
      q: "42",
      cols: "ixBug,events",
      eventsOrder: "asc",
      eventsLimit: "0",
    });
    expect(String(fetch.mock.calls[0]?.[0])).not.toContain("private-token");
    fetch.mockResolvedValue(
      new Response("<response><cases><case><ixBug>43</ixBug><events/></case></cases></response>"),
    );
    await expect(api.caseEvents("private-token", 42)).rejects.toMatchObject({ code: "access" });
    fetch.mockResolvedValue(
      new Response("<response><cases><case><ixBug>42</ixBug><events/></case></cases></response>"),
    );
    expect(await api.caseEvents("private-token", 42)).toEqual([]);
  });
  it("sends credentials and tokens only in POST bodies and refuses redirects", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response("<response><token><![CDATA[private-token]]></token></response>"),
      );
    const api = new FogBugzApi("https://fogbugz.example/instance/", fetch);
    expect(await api.login("someone@example.test", "private-password")).toBe("private-token");
    const [url, request] = fetch.mock.calls[0]!;
    expect(String(url)).toBe("https://fogbugz.example/instance/api.asp");
    expect(request?.method).toBe("POST");
    expect(request?.redirect).toBe("error");
    expect(String(request?.body)).toContain("password=private-password");
    expect(String(url)).not.toContain("private");
  });

  it("decodes the XML fields, entities and CDATA emitted by our FogBugz", async () => {
    const caseResponse =
      '<response><cases count="1"><case ixBug="42"><ixBug>42</ixBug><sTitle><![CDATA[Fix <title>]]></sTitle><ixProject>12</ixProject><sProject>OPS</sProject><sStatus>Active</sStatus><fOpen>true</fOpen><ixPersonAssignedTo>7</ixPersonAssignedTo><sPersonAssignedTo>Test Person</sPersonAssignedTo><ixPriority>2</ixPriority><sPriority>Normal</sPriority><ixCategory>1</ixCategory><sCategory>Bug</sCategory><dtCaseNotified>2026-10-29T08:00:00Z</dtCaseNotified><dtLastUpdated></dtLastUpdated></case></cases></response>';
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(
          "<response><person><ixPerson>7</ixPerson><sFullName>Müller &amp; Sohn</sFullName></person></response>",
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          "<response><projects><project><ixProject>12</ixProject><sProject>OPS</sProject></project></projects><projectGroups><membership><ixProject>12</ixProject><ixProjectGroup>3</ixProjectGroup><sProjectGroup>MGGM</sProjectGroup></membership></projectGroups></response>",
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          "<response><categories><category><ixCategory>1</ixCategory><nIconType>1</nIconType></category></categories></response>",
        ),
      )
      .mockResolvedValueOnce(new Response(caseResponse));
    const api = new FogBugzApi("https://fogbugz.example/", fetch);
    expect(await api.person("secret")).toEqual({ id: 7, name: "Müller & Sohn" });
    expect(await api.projects("secret")).toEqual([
      { id: 12, name: "OPS", groups: [{ id: 3, name: "MGGM" }] },
    ]);
    expect(await api.cases("secret", "assignedto:me")).toEqual([
      {
        id: 42,
        title: "Fix <title>",
        projectId: 12,
        projectName: "OPS",
        status: "Active",
        open: true,
        assignedTo: 7,
        assignedToName: "Test Person",
        priority: "Normal",
        priorityId: 2,
        categoryId: 1,
        categoryName: "Bug",
        categoryIconType: 1,
        notifiedAt: "2026-10-29T08:00:00.000Z",
        updatedAt: null,
      },
    ]);
    fetch
      .mockResolvedValueOnce(
        new Response(
          "<response><categories><category><ixCategory>1</ixCategory><nIconType>1</nIconType></category></categories></response>",
        ),
      )
      .mockResolvedValueOnce(
        new Response(caseResponse.replace(/<dtCaseNotified>.*?<\/dtCaseNotified>/, "")),
      );
    expect((await api.cases("secret", "assignedto:me"))[0]?.notifiedAt).toBeNull();
  });

  it("requests a case repository by POST and rejects malformed repository identities", async () => {
    const repositoryId = "3c6f10e1-bc67-4f16-9145-4419476f6fd1";
    const limits = {
      fileBytes: 26214400,
      groupBytes: 104857600,
      groupFiles: 100,
      repositoryBytes: 524288000,
    };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(
          `<response><caseGit><![CDATA[${JSON.stringify({ repositoryId, canWrite: true, limits })}]]></caseGit></response>`,
        ),
      );
    const api = new FogBugzApi("https://fogbugz.example/subpath/", fetch);
    expect(await api.caseGitRepository("private-token", 42)).toEqual({
      repositoryId,
      canWrite: true,
      limits,
    });
    expect(String(fetch.mock.calls[0]?.[0])).toBe("https://fogbugz.example/subpath/api.asp");
    expect(fetch.mock.calls[0]?.[1]?.method).toBe("POST");
    expect(new URLSearchParams(String(fetch.mock.calls[0]?.[1]?.body)).get("ixBug")).toBe("42");
    for (const body of [
      "{}",
      "not-json",
      '{"repositoryId":"../outside","canWrite":true}',
      JSON.stringify({ repositoryId, canWrite: true }),
      JSON.stringify({ repositoryId, canWrite: true, limits: { ...limits, fileBytes: 0 } }),
      JSON.stringify({ repositoryId, canWrite: true, limits: { ...limits, groupFiles: -1 } }),
    ]) {
      fetch.mockResolvedValue(
        new Response(`<response><caseGit><![CDATA[${body}]]></caseGit></response>`),
      );
      await expect(api.caseGitRepository("private-token", 42)).rejects.toMatchObject({
        code: "response",
      });
    }
  });

  it("exchanges a token by POST for a separate browser cookie bound to the configured person", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(
      async () =>
        new Response("<response><session><ixPerson>7</ixPerson></session></response>", {
          headers: { "Set-Cookie": "fbToken=browser-session; Path=/; HttpOnly" },
        }),
    );
    const api = new FogBugzApi("https://fogbugz.example/", fetch);
    expect(await api.browserSession("private-api-token", 7)).toBe("browser-session");
    expect(String(fetch.mock.calls[0]?.[0])).toBe("https://fogbugz.example/api.asp");
    expect(fetch.mock.calls[0]?.[1]?.method).toBe("POST");
    expect(String(fetch.mock.calls[0]?.[1]?.body)).toContain("token=private-api-token");
    await expect(api.browserSession("private-api-token", 8)).rejects.toMatchObject({
      code: "authentication",
    });
    fetch.mockResolvedValue(
      new Response("<response><session><ixPerson>7</ixPerson></session></response>"),
    );
    await expect(api.browserSession("private-api-token", 7)).rejects.toMatchObject({
      code: "authentication",
    });
  });

  it.each([
    ['<response><error code="3">secret remote error</error></response>', "authentication"],
    ['<response><error code="13">secret remote error</error></response>', "access"],
    ["<html>login</html>", "response"],
    ['<!DOCTYPE response [<!ENTITY test SYSTEM "file:///etc/passwd">]><response/>', "response"],
    ["<response><cases>", "response"],
  ])("rejects API and malformed responses without exposing their contents", async (xml, code) => {
    const api = new FogBugzApi(
      "https://fogbugz.example/",
      vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(xml)),
    );
    await expect(api.cases("secret", "42")).rejects.toMatchObject({ code });
  });

  it.each([
    "http://example.test/",
    "http://8.8.8.8/",
    "http://172.32.0.1/",
    "http://192.169.2.159/",
    "http://192.168.2.159.example.test/",
    "http://[2606:4700:4700::1111]/",
    "https://name:password@example.test/",
    "https://example.test/?token=secret",
    "file:///tmp/test",
    "https://example.test/#secret",
  ])("rejects unsafe connection URL %s", (url) => {
    expect(() => normalizeFogBugzUrl(url)).toThrow();
  });

  it("accepts HTTPS subpaths and HTTP on localhost or private IP addresses", () => {
    expect(normalizeFogBugzUrl("https://example.test/fogbugz")).toBe(
      "https://example.test/fogbugz/",
    );
    expect(normalizeFogBugzUrl("http://127.0.0.1:18080")).toBe("http://127.0.0.1:18080/");
    for (const host of ["192.168.2.159", "10.0.0.1", "172.16.0.1", "172.31.255.254", "[fd00::1]"]) {
      expect(normalizeFogBugzUrl(`http://${host}:18080/fogbugz`)).toBe(
        `http://${host}:18080/fogbugz/`,
      );
    }
  });
});
