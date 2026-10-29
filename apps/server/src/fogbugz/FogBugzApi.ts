import { FogBugzCase, FogBugzError, FogBugzId, FogBugzProject } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import { SaxesParser } from "saxes";

type XmlNode = {
  name: string;
  text: string;
  children: XmlNode[];
  attributes: Record<string, string>;
};
const decodeId = Schema.decodeSync(FogBugzId);
const decodeProject = Schema.decodeSync(FogBugzProject);
const decodeCase = Schema.decodeSync(FogBugzCase);
const isFogBugzError = Schema.is(FogBugzError);

function parseXml(xml: string): XmlNode {
  const document: XmlNode = { name: "document", text: "", children: [], attributes: {} };
  const stack = [document];
  const parser = new SaxesParser();
  parser.on("doctype", () => {
    throw new FogBugzError({ code: "response" });
  });
  parser.on("opentag", (tag) => {
    const node = { name: tag.name, text: "", children: [], attributes: tag.attributes };
    stack[stack.length - 1]!.children.push(node);
    stack.push(node);
  });
  const text = (value: string) => {
    stack[stack.length - 1]!.text += value;
  };
  parser.on("text", text);
  parser.on("cdata", text);
  parser.on("closetag", () => {
    stack.pop();
  });
  parser.write(xml).close();
  const root = document.children[0];
  if (document.children.length !== 1 || root?.name !== "response")
    throw new FogBugzError({ code: "response" });
  const error = root.children.find((node) => node.name === "error");
  if (error)
    throw new FogBugzError({
      code: ["1", "2", "3"].includes(error.attributes.code ?? "") ? "authentication" : "access",
    });
  return root;
}

function child(node: XmlNode, name: string): XmlNode {
  const found = node.children.find((value) => value.name === name);
  if (!found) throw new FogBugzError({ code: "response" });
  return found;
}
const value = (node: XmlNode, name: string) => child(node, name).text;
const id = (text: string) => decodeId(Number(text));

export function normalizeFogBugzUrl(input: string): string {
  try {
    const url = new URL(input);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error();
    return url.href.replace(/\/*$/, "/");
  } catch {
    throw new FogBugzError({ code: "url" });
  }
}

export class FogBugzApi {
  readonly baseUrl: string;
  readonly fetch: typeof globalThis.fetch;
  constructor(baseUrl: string, fetch: typeof globalThis.fetch = globalThis.fetch) {
    this.baseUrl = baseUrl;
    this.fetch = fetch;
  }

  private async request(
    parameters: Record<string, string>,
    receiveHeaders?: (headers: Headers) => void,
  ): Promise<XmlNode> {
    let response: Response;
    try {
      response = await this.fetch(new URL("api.asp", this.baseUrl), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(parameters),
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new FogBugzError({ code: "network" });
    }
    if (response.status === 401 || response.status === 403)
      throw new FogBugzError({ code: "authentication" });
    if (!response.ok) throw new FogBugzError({ code: "network" });
    receiveHeaders?.(response.headers);
    try {
      // Bound untrusted responses before parsing or retaining case text.
      const reader = response.body?.getReader();
      if (!reader) throw new FogBugzError({ code: "response" });
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > 4_000_000) {
          await reader.cancel();
          throw new FogBugzError({ code: "response" });
        }
        chunks.push(chunk.value);
      }
      return parseXml(Buffer.concat(chunks).toString("utf8"));
    } catch (error) {
      if (isFogBugzError(error)) throw error;
      throw new FogBugzError({ code: "response" });
    }
  }

  async login(username: string, password: string) {
    const response = await this.request({ cmd: "logon", email: username, password });
    const token = value(response, "token");
    if (!token) throw new FogBugzError({ code: "authentication" });
    return token;
  }

  async logout(token: string) {
    await this.request({ cmd: "logoff", token });
  }

  async browserSession(token: string, personId: number) {
    let sessionCookie: string | undefined;
    const response = await this.request({ cmd: "browserSession", token }, (headers) => {
      sessionCookie = headers
        .getSetCookie()
        .find((cookie) => cookie.startsWith("fbToken="))
        ?.split(";", 1)[0]
        ?.slice("fbToken=".length);
    });
    if (id(value(child(response, "session"), "ixPerson")) !== personId || !sessionCookie)
      throw new FogBugzError({ code: "authentication" });
    return sessionCookie;
  }

  async person(token: string) {
    const person = child(await this.request({ cmd: "viewPerson", token }), "person");
    return { id: id(value(person, "ixPerson")), name: value(person, "sFullName") };
  }

  async projects(token: string) {
    const response = await this.request({ cmd: "listProjects", token, includeProjectGroups: "1" });
    const projects = child(response, "projects");
    const memberships = child(response, "projectGroups").children;
    return projects.children
      .filter((node) => node.name === "project")
      .map((project) =>
        decodeProject({
          id: id(value(project, "ixProject")),
          name: value(project, "sProject"),
          groups: memberships
            .filter((item) => id(value(item, "ixProject")) === id(value(project, "ixProject")))
            .map((item) => ({
              id: id(value(item, "ixProjectGroup")),
              name: value(item, "sProjectGroup"),
            })),
        }),
      );
  }

  async cases(token: string, query: string) {
    const categories = child(await this.request({ cmd: "listCategories", token }), "categories");
    const cases = child(
      await this.request({
        cmd: "search",
        token,
        q: query,
        max: "201",
        includeReadNotifications: "1",
        cols: "ixBug,sTitle,ixProject,sProject,sStatus,fOpen,ixPersonAssignedTo,sPersonAssignedTo,sPriority,ixCategory,sCategory,dtCaseNotified,dtLastUpdated",
      }),
      "cases",
    );
    return cases.children
      .filter((node) => node.name === "case")
      .map((item) =>
        decodeCase({
          id: id(value(item, "ixBug")),
          title: value(item, "sTitle"),
          projectId: id(value(item, "ixProject")),
          projectName: value(item, "sProject"),
          status: value(item, "sStatus"),
          open: value(item, "fOpen").toLowerCase() === "true" || value(item, "fOpen") === "1",
          assignedTo: Number(value(item, "ixPersonAssignedTo")),
          assignedToName: value(item, "sPersonAssignedTo"),
          priority: value(item, "sPriority"),
          categoryId: id(value(item, "ixCategory")),
          categoryName: value(item, "sCategory"),
          categoryIconType: Number(
            value(childCategory(categories, value(item, "ixCategory")), "nIconType"),
          ),
          notifiedAt: timestamp(value(item, "dtCaseNotified")),
          updatedAt: timestamp(value(item, "dtLastUpdated")),
        }),
      );
  }
}

function childCategory(categories: XmlNode, categoryId: string): XmlNode {
  const category = categories.children.find((item) => value(item, "ixCategory") === categoryId);
  if (!category) throw new FogBugzError({ code: "response" });
  return category;
}

function timestamp(value: string): string | null {
  if (!value) return null;
  const date = DateTime.make(value);
  if (Option.isNone(date)) throw new FogBugzError({ code: "response" });
  return DateTime.formatIso(date.value);
}
