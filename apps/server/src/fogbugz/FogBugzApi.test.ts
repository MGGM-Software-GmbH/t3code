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
          "<response><projects><project><ixProject>12</ixProject><sProject>OPS</sProject></project></projects></response>",
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          '<response><cases count="1"><case ixBug="42"><ixBug>42</ixBug><sTitle><![CDATA[Fix <title>]]></sTitle><ixProject>12</ixProject><sProject>OPS</sProject><sStatus>Active</sStatus><fOpen>true</fOpen><ixPersonAssignedTo>7</ixPersonAssignedTo></case></cases></response>',
        ),
      );
    const api = new FogBugzApi("https://fogbugz.example/", fetch);
    expect(await api.person("secret")).toEqual({ id: 7, name: "Müller & Sohn" });
    expect(await api.projects("secret")).toEqual([{ id: 12, name: "OPS" }]);
    expect(await api.cases("secret", "assignedto:me")).toEqual([
      {
        id: 42,
        title: "Fix <title>",
        projectId: 12,
        projectName: "OPS",
        status: "Active",
        open: true,
        assignedTo: 7,
      },
    ]);
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
