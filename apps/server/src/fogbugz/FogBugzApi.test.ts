import { describe, expect, it, vi } from "vite-plus/test";
import { FogBugzApi, normalizeFogBugzUrl } from "./FogBugzApi.ts";

describe("FogBugz API", () => {
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
      .mockResolvedValueOnce(
        new Response(
          '<response><cases count="1"><case ixBug="42"><ixBug>42</ixBug><sTitle><![CDATA[Fix <title>]]></sTitle><ixProject>12</ixProject><sProject>OPS</sProject><sStatus>Active</sStatus><fOpen>true</fOpen><ixPersonAssignedTo>7</ixPersonAssignedTo><sPersonAssignedTo>Test Person</sPersonAssignedTo><sPriority>Normal</sPriority><ixCategory>1</ixCategory><sCategory>Bug</sCategory><dtCaseNotified>2026-10-29T08:00:00Z</dtCaseNotified><dtLastUpdated></dtLastUpdated></case></cases></response>',
        ),
      );
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
        categoryId: 1,
        categoryName: "Bug",
        categoryIconType: 1,
        notifiedAt: "2026-10-29T08:00:00.000Z",
        updatedAt: null,
      },
    ]);
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
    "https://name:password@example.test/",
    "https://example.test/?token=secret",
    "file:///tmp/test",
    "https://example.test/#secret",
  ])("rejects unsafe connection URL %s", (url) => {
    expect(() => normalizeFogBugzUrl(url)).toThrow();
  });

  it("accepts HTTPS subpaths and isolated localhost HTTP", () => {
    expect(normalizeFogBugzUrl("https://example.test/fogbugz")).toBe(
      "https://example.test/fogbugz/",
    );
    expect(normalizeFogBugzUrl("http://127.0.0.1:18080")).toBe("http://127.0.0.1:18080/");
  });
});
