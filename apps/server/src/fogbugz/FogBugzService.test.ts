import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { ProjectId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/sql/SqlClient";
import { vi } from "vite-plus/test";
import * as Sqlite from "../persistence/Sqlite.ts";
import { ServerSecretStore } from "../auth/ServerSecretStore.ts";
import { FogBugzService, layer } from "./FogBugzService.ts";
import { createThread } from "./FogBugzThreads.ts";
import { ThreadManagementService } from "../orchestration-v2/ThreadManagementService.ts";
import { CommandId, ProviderInstanceId } from "@t3tools/contracts";

const projectId = ProjectId.make("project-fogbugz");
const threadId = ThreadId.make("thread-fogbugz");
const credentials = {
  baseUrl: "https://fogbugz.example/",
  username: "test@example.test",
  password: "private-password",
};
const caseXml = (
  id: number,
  project: number,
  assigned = 7,
  notified = "",
  updated = "2026-01-01T00:00:00Z",
) =>
  `<case ixBug="${id}"><ixBug>${id}</ixBug><sTitle>Case ${id}</sTitle><ixProject>${project}</ixProject><sProject>Project ${project}</sProject><sStatus>1 ToDo</sStatus><fOpen>true</fOpen><ixPersonAssignedTo>${assigned}</ixPersonAssignedTo><sPersonAssignedTo>Person ${assigned}</sPersonAssignedTo><ixPriority>2</ixPriority><sPriority>Normal</sPriority><ixCategory>1</ixCategory><sCategory>Bug</sCategory><dtCaseNotified>${notified}</dtCaseNotified><dtLastUpdated>${updated}</dtLastUpdated></case>`;

function fixture() {
  const secrets = new Map<string, Uint8Array>();
  const secretLayer = Layer.mock(ServerSecretStore)({
    get: (name) => Effect.succeed(Option.fromNullishOr(secrets.get(name))),
    set: (name, value) =>
      Effect.sync(() => {
        secrets.set(name, value);
      }),
    remove: (name) =>
      Effect.sync(() => {
        secrets.delete(name);
      }),
  });
  const requests: URLSearchParams[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
    const params = new URLSearchParams(String(init?.body));
    requests.push(params);
    const command = params.get("cmd");
    const content =
      command === "browserSession"
        ? '<error code="10">POST token required</error>'
        : command === "caseGitRepository" && params.get("ixBug") === "0"
          ? '<error code="13">No access to case files</error>'
          : command === "caseGitRepository"
            ? '<caseGit><![CDATA[{"repositoryId":"f3e37008-65d3-4cd5-8276-6cfdcc8b8901","canWrite":true,"limits":{"fileBytes":26214400,"groupBytes":104857600,"groupFiles":100,"repositoryBytes":524288000}}]]></caseGit>'
            : command === "logon"
              ? "<token>private-token</token>"
              : command === "viewPerson"
                ? "<person><ixPerson>7</ixPerson><sFullName>Test Person</sFullName></person>"
                : command === "listProjects"
                  ? "<projects><project><ixProject>12</ixProject><sProject>Project 12</sProject></project></projects><projectGroups><membership><ixProject>12</ixProject><ixProjectGroup>3</ixProjectGroup><sProjectGroup>MGGM</sProjectGroup></membership></projectGroups>"
                  : command === "listCategories"
                    ? "<categories><category><ixCategory>1</ixCategory><nIconType>1</nIconType></category></categories>"
                    : command === "search"
                      ? params.get("cols") === "ixBug,events"
                        ? "<cases><case><ixBug>42</ixBug><events><event><ixBugEvent>501</ixBugEvent><sPerson>Test Person</sPerson><dt>2026-10-29T10:00:00Z</dt><s>Required behavior</s></event></events></case></cases>"
                        : `<cases>${params.get("q") === "42" ? caseXml(42, 12) : caseXml(42, 12) + caseXml(43, 99) + caseXml(44, 12, 8)}</cases>`
                      : "";
    return new Response(`<response>${content}</response>`);
  });
  const dependencies = Layer.merge(Sqlite.layerMemory, secretLayer).pipe(
    Layer.provideMerge(NodeServices.layer),
  );
  return {
    secrets,
    requests,
    fetch,
    dependencies,
    service: layer.pipe(Layer.provide(dependencies)),
  };
}

const seed = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`INSERT INTO projection_projects (project_id, title, workspace_root, scripts_json, created_at, updated_at) VALUES (${projectId}, 'Test project', '/tmp/fogbugz-test', '[]', '2026-01-01', '2026-01-01')`;
  yield* sql`INSERT INTO orchestration_v2_projection_threads (thread_id, project_id, title, default_provider, runtime_mode, interaction_mode, created_at, updated_at, payload_json) VALUES (${threadId}, ${projectId}, 'Existing thread', 'codex', 'full-access', 'default', '2026-01-01', '2026-01-01', '{}')`;
});

describe("FogBugz integration persistence and access", () => {
  it.effect(
    "keeps links and sign-in when optional extensions disappear and rechecks after an update",
    () => {
      const test = fixture();
      let legacy = false;
      return Effect.gen(function* () {
        using _fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
          const parameters = new URLSearchParams(String(init?.body));
          if (legacy && parameters.get("cmd") === "listProjects")
            return new Response(
              "<response><projects><project><ixProject>12</ixProject><sProject>Project 12</sProject></project></projects></response>",
            );
          if (legacy && parameters.get("cmd") === "browserSession")
            return new Response('<response><error code="3">Not logged on</error></response>');
          if (legacy && parameters.get("cmd") === "caseGitRepository")
            return new Response('<response><error code="27">Unknown command</error></response>');
          return test.fetch(url, init);
        });
        yield* seed;
        const service = yield* FogBugzService;
        yield* service.connect(credentials);
        yield* service.linkProject({ projectId, fogbugzProjectId: null, fogbugzProjectGroupId: 3 });
        yield* service.linkThread({ threadId, caseId: 42 });
        legacy = true;
        expect(
          (yield* service.cases({ query: "", state: "open", assignedToMe: true }).pipe(Effect.flip))
            .code,
        ).toBe("project_groups_unsupported");
        expect((yield* service.status()).connection?.capabilities?.projectGroups).toBe(false);
        const checked = yield* service.test();
        expect(checked.authenticated).toBe(true);
        expect(checked.capabilities).toEqual({
          projectGroups: false,
          browserSession: false,
          caseGit: false,
        });
        expect((yield* service.status()).projects).toEqual([
          { projectId, fogbugzProjectId: null, fogbugzProjectGroupId: 3 },
        ]);
        expect(
          (yield* service.cases({ query: "", state: "open", assignedToMe: true }).pipe(Effect.flip))
            .code,
        ).toBe("project_groups_unsupported");
        expect((yield* service.thread(threadId))?.caseId).toBe(42);
        const sql = yield* SqlClient.SqlClient;
        const directProject = ProjectId.make("direct-project");
        yield* sql`INSERT INTO projection_projects (project_id, title, workspace_root, scripts_json, created_at, updated_at) VALUES (${directProject}, 'Direct project', '/tmp/direct-project', '[]', '2026-01-01', '2026-01-01')`;
        yield* service.linkProject({ projectId: directProject, fogbugzProjectId: 12 });
        const partial = yield* service.cases({ query: "", state: "open", assignedToMe: true });
        expect(partial.cases.map((item) => item.id)).toEqual([42]);
        expect(partial.projects).toEqual([{ projectId: directProject, fogbugzProjectId: 12 }]);
        legacy = false;
        expect((yield* service.test()).capabilities).toEqual({
          projectGroups: true,
          browserSession: true,
          caseGit: true,
        });
        expect(
          (yield* service.cases({ query: "", state: "open", assignedToMe: true })).cases,
        ).toHaveLength(1);
      }).pipe(Effect.provide(test.service.pipe(Layer.provideMerge(test.dependencies))));
    },
  );
  it.effect(
    "requires a persisted accessible thread link before preparing a case repository",
    () => {
      const test = fixture();
      return Effect.gen(function* () {
        using _fetch = vi.spyOn(globalThis, "fetch").mockImplementation(test.fetch);
        yield* seed;
        const service = yield* FogBugzService;
        yield* service.connect(credentials);
        yield* service.linkProject({ projectId, fogbugzProjectId: 12 });
        expect((yield* service.caseGitRepository(threadId).pipe(Effect.flip)).code).toBe("thread");
        expect(test.requests.some((request) => request.get("cmd") === "caseGitRepository")).toBe(
          false,
        );
        yield* service.linkThread({ threadId, caseId: 42 });
        const repository = yield* service.caseGitRepository(threadId);
        expect(repository).toMatchObject({
          caseId: 42,
          personId: 7,
          remoteUrl: "https://fogbugz.example/case-git/42.git",
          token: "private-token",
        });
        const request = test.requests.find((item) => item.get("cmd") === "caseGitRepository")!;
        expect(request.get("token")).toBe("private-token");
        expect(request.get("ixBug")).toBe("42");
        yield* service.linkThread({ threadId, caseId: null });
        expect((yield* service.caseGitRepository(threadId).pipe(Effect.flip)).code).toBe("thread");
      }).pipe(Effect.provide(test.service.pipe(Layer.provideMerge(test.dependencies))));
    },
  );
  it.effect("pages automation candidates without truncating at 200 cases", () => {
    const test = fixture();
    const queries: string[] = [];
    return Effect.gen(function* () {
      using _fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
        const parameters = new URLSearchParams(String(init?.body));
        if (parameters.get("cmd") === "listStatuses")
          return new Response(
            "<response><statuses><status><ixStatus>9</ixStatus></status></statuses></response>",
          );
        if (parameters.get("cols")?.includes("ixBugEventLatest")) {
          const query = parameters.get("q")!;
          queries.push(query);
          const ids = query.includes("case:1..300")
            ? [300]
            : Array.from({ length: 201 }, (_, index) => 500 - index);
          return new Response(
            `<response><cases>${ids.map((id) => `<case><ixBug>${id}</ixBug><ixProject>12</ixProject><ixStatus>1</ixStatus><fOpen>true</fOpen><ixPersonAssignedTo>7</ixPersonAssignedTo><ixBugEventLatest>${id}</ixBugEventLatest><dtOpened>2026-10-30T12:00:00Z</dtOpened></case>`).join("")}</cases></response>`,
          );
        }
        return test.fetch(url, init);
      });
      yield* seed;
      const service = yield* FogBugzService;
      yield* service.connect(credentials);
      yield* service.linkProject({ projectId, fogbugzProjectId: 12 });
      const snapshot = yield* service.automationSnapshot(projectId);
      expect(snapshot.cases).toHaveLength(201);
      expect(new Set(snapshot.cases.map((item) => item.id)).size).toBe(201);
      expect(queries).toEqual([
        "(project:=12) assignedto:me case:1..2147483647",
        "(project:=12) assignedto:me case:1..300",
      ]);
    }).pipe(Effect.provide(test.service.pipe(Layer.provideMerge(test.dependencies))));
  });
  it.effect("batches linked case metadata and excludes a moved or inaccessible case", () => {
    const test = fixture();
    return Effect.gen(function* () {
      using fetch = vi.spyOn(globalThis, "fetch").mockImplementation(test.fetch);
      yield* seed;
      const service = yield* FogBugzService;
      expect(yield* service.threadCases()).toEqual([]);
      yield* service.connect(credentials);
      yield* service.linkProject({ projectId, fogbugzProjectId: 12 });
      yield* service.linkThread({ threadId, caseId: 42 });
      expect(yield* service.threadCases()).toMatchObject([
        {
          threadId,
          case: { id: 42, projectName: "Project 12", priorityId: 2, categoryIconType: 1 },
        },
      ]);
      const requestCount = test.requests.length;
      expect(yield* service.caseThreadIds(42)).toEqual([threadId]);
      expect(yield* service.caseThreadIds(43)).toEqual([]);
      expect(test.requests).toHaveLength(requestCount);
      expect(test.requests.at(-1)?.get("q")).toBe("(case:42)");
      fetch.mockImplementation(async (_url, init) => {
        const parameters = new URLSearchParams(String(init?.body));
        return parameters.get("cmd") === "search"
          ? new Response(`<response><cases>${caseXml(42, 99)}</cases></response>`)
          : test.fetch(_url, init);
      });
      expect(yield* service.threadCases()).toEqual([]);
      fetch.mockResolvedValueOnce(
        new Response('<response><error code="3">Expired</error></response>'),
      );
      expect((yield* Effect.flip(service.threadCases())).code).toBe("authentication");
      const sql = yield* SqlClient.SqlClient;
      yield* sql`UPDATE orchestration_v2_projection_threads SET deleted_at = '2026-10-31T00:00:00Z' WHERE thread_id = ${threadId}`;
      expect(yield* service.caseThreadIds(42)).toEqual([]);
    }).pipe(Effect.provide(test.service.pipe(Layer.provideMerge(test.dependencies))));
  });
  it.effect(
    "loads context only for a case in the thread's linked project without changing its association",
    () => {
      const test = fixture();
      return Effect.gen(function* () {
        using _fetch = vi.spyOn(globalThis, "fetch").mockImplementation(test.fetch);
        yield* seed;
        const service = yield* FogBugzService;
        yield* service.connect(credentials);
        yield* service.linkProject({ projectId, fogbugzProjectId: null, fogbugzProjectGroupId: 3 });
        const context = yield* service.caseContext({ threadId, caseId: 42 });
        expect(context.case.id).toBe(42);
        expect(context.url).toBe("https://fogbugz.example/default.asp?42");
        expect(context.events).toEqual([
          {
            id: 501,
            author: "Test Person",
            createdAt: "2026-10-29T10:00:00.000Z",
            text: "Required behavior",
          },
        ]);
        expect(yield* service.thread(threadId)).toBeNull();
        const eventRequests = () =>
          test.requests.filter((request) => request.get("cols") === "ixBug,events").length;
        expect(eventRequests()).toBe(1);
        expect((yield* Effect.flip(service.caseContext({ threadId, caseId: 43 }))).code).toBe(
          "project",
        );
        expect(
          (yield* Effect.flip(
            service.caseContext({ threadId: ThreadId.make("missing"), caseId: 42 }),
          )).code,
        ).toBe("thread");
        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE orchestration_v2_projection_threads SET deleted_at = '2026-10-29' WHERE thread_id = ${threadId}`;
        expect((yield* Effect.flip(service.caseContext({ threadId, caseId: 42 }))).code).toBe(
          "thread",
        );
        expect(eventRequests()).toBe(1);
        expect(yield* service.caseContext({ projectId, caseId: 42 })).toEqual(context);
        expect((yield* Effect.flip(service.caseContext({ projectId, caseId: 43 }))).code).toBe(
          "project",
        );
        expect(
          (yield* Effect.flip(
            service.caseContext({ projectId: ProjectId.make("missing"), caseId: 42 }),
          )).code,
        ).toBe("project");
        yield* sql`UPDATE projection_projects SET deleted_at = '2026-10-29' WHERE project_id = ${projectId}`;
        expect((yield* Effect.flip(service.caseContext({ projectId, caseId: 42 }))).code).toBe(
          "project",
        );
        expect(eventRequests()).toBe(2);
      }).pipe(Effect.provide(test.service.pipe(Layer.provideMerge(test.dependencies))));
    },
  );
  it.effect(
    "resolves readable group members and sorts by notification or modification date",
    () => {
      const test = fixture();
      return Effect.gen(function* () {
        using _fetch = vi.spyOn(globalThis, "fetch").mockImplementation(test.fetch);
        yield* seed;
        const service = yield* FogBugzService;
        yield* service.connect(credentials);
        yield* service.linkProject({ projectId, fogbugzProjectId: null, fogbugzProjectGroupId: 3 });
        expect((yield* service.status()).projects).toEqual([
          { projectId, fogbugzProjectId: null, fogbugzProjectGroupId: 3 },
        ]);
        expect(
          (yield* Effect.flip(
            service.linkProject({ projectId, fogbugzProjectId: 12, fogbugzProjectGroupId: 3 }),
          )).code,
        ).toBe("project");
        expect(
          (yield* Effect.flip(
            service.linkProject({ projectId, fogbugzProjectId: null, fogbugzProjectGroupId: 99 }),
          )).code,
        ).toBe("access");
        const originalFetch = test.fetch.getMockImplementation()!;
        test.fetch.mockImplementation(async (url, init) => {
          const params = new URLSearchParams(String(init?.body));
          if (params.get("cmd") === "listProjects")
            return new Response(
              "<response><projects><project><ixProject>12</ixProject><sProject>Project 12</sProject></project><project><ixProject>13</ixProject><sProject>New project</sProject></project></projects><projectGroups><membership><ixProject>13</ixProject><ixProjectGroup>3</ixProjectGroup><sProjectGroup>MGGM</sProjectGroup></membership></projectGroups></response>",
            );
          if (params.get("cmd") === "search")
            return new Response(
              `<response><cases>${caseXml(40, 13, 7, "", "2026-10-28T00:00:00Z")}${caseXml(41, 13, 7, "2026-10-20T00:00:00Z", "2026-10-28T00:00:00Z")}${caseXml(42, 13, 7, "2026-10-21T00:00:00Z", "2026-10-20T00:00:00Z")}${caseXml(43, 13, 7, "2026-10-21T00:00:00Z", "2026-10-22T00:00:00Z")}${caseXml(44, 12)}</cases></response>`,
            );
          return originalFetch(url, init);
        });
        const result = yield* service.cases({ query: "", state: "open", assignedToMe: true });
        expect(result.projects).toEqual([{ projectId, fogbugzProjectId: 13 }]);
        expect(result.cases.map((item) => item.id)).toEqual([40, 43, 42, 41]);
        yield* service.linkThread({ threadId, caseId: 43 });
        yield* service.linkProject({ projectId, fogbugzProjectId: null, fogbugzProjectGroupId: 3 });
        expect((yield* service.thread(threadId))?.caseId).toBe(43);
        yield* service.linkProject({ projectId, fogbugzProjectId: null });
        expect((yield* service.status()).projects).toEqual([]);
        expect(yield* service.thread(threadId)).toBeNull();
      }).pipe(Effect.provide(test.service.pipe(Layer.provideMerge(test.dependencies))));
    },
  );
  it.effect(
    "keeps tokens out of metadata, filters projects and assignees, and persists links across service reconstruction",
    () => {
      const test = fixture();
      return Effect.gen(function* () {
        using _fetch = vi.spyOn(globalThis, "fetch").mockImplementation(test.fetch);
        yield* seed;
        yield* Effect.gen(function* () {
          const service = yield* FogBugzService;
          yield* service.connect(credentials);
          yield* service.linkProject({ projectId, fogbugzProjectId: 12 });
          yield* service.linkThread({ threadId, caseId: 42 });
          yield* service.linkProject({ projectId, fogbugzProjectId: 12 });
          expect((yield* service.thread(threadId))?.caseId).toBe(42);
          expect(
            (yield* Effect.result(service.prepareThread({ threadId, projectId, caseId: 44 })))._tag,
          ).toBe("Failure");
          expect((yield* service.thread(threadId))?.caseId).toBe(42);
          const result = yield* service.cases({ query: "", state: "open", assignedToMe: true });
          expect(result.cases.map((item) => item.id)).toEqual([42]);
          expect(result.threads.map((item) => item.threadId)).toEqual([threadId]);
          expect(result.threads[0]?.title).toBe("Existing thread");
          expect(test.requests.at(-1)?.get("q")).toContain("project:=12");
          expect(test.secrets.size).toBe(1);
          expect(JSON.stringify(yield* service.status())).not.toContain("private-");
          yield* service.linkProject({
            projectId,
            fogbugzProjectId: null,
            fogbugzProjectGroupId: 3,
          });
          yield* service.linkThread({ threadId, caseId: 42 });
          const sql = yield* SqlClient.SqlClient;
          yield* sql`INSERT INTO fogbugz_automation (project_id, payload) VALUES (${projectId}, '{"cursor":42}')`;
          const previous = (yield* service.status()).connection!;
          const updated = yield* service.connect({
            ...credentials,
            baseUrl: "http://192.168.2.159:18080",
            password: "",
          });
          expect(updated.id).toBe(previous.id);
          expect(updated.baseUrl).toBe("http://192.168.2.159:18080/");
          expect(test.requests.filter((request) => request.get("cmd") === "logon")).toHaveLength(1);
          expect((yield* service.status()).projects).toEqual([
            { projectId, fogbugzProjectId: null, fogbugzProjectGroupId: 3 },
          ]);
          expect(yield* sql`SELECT payload FROM fogbugz_automation`).toEqual([
            { payload: '{"cursor":42}' },
          ]);
          expect((yield* service.thread(threadId))?.caseId).toBe(42);
          yield* service.connect({ ...credentials, baseUrl: updated.baseUrl });
          expect((yield* service.thread(threadId))?.caseId).toBe(42);
          expect((yield* service.status()).projects[0]?.fogbugzProjectGroupId).toBe(3);
          expect(yield* sql`SELECT payload FROM fogbugz_automation`).toEqual([
            { payload: '{"cursor":42}' },
          ]);
        }).pipe(Effect.provide(test.service));
        yield* Effect.gen(function* () {
          const restored = yield* FogBugzService;
          expect((yield* restored.thread(threadId))?.url).toBe(
            "http://192.168.2.159:18080/default.asp?pg=pgEditBug&command=view&ixBug=42",
          );
          yield* restored.linkThread({ threadId, caseId: null });
          expect(yield* restored.thread(threadId)).toBeNull();
          yield* restored.disconnect();
          expect(yield* restored.status()).toEqual({ connection: null, projects: [] });
          expect(test.secrets.size).toBe(0);
          const sql = yield* SqlClient.SqlClient;
          expect(
            (yield* sql`SELECT thread_id FROM orchestration_v2_projection_threads`).length,
          ).toBe(1);
        }).pipe(Effect.provide(layer.pipe(Layer.provide(test.dependencies))));
      }).pipe(Effect.provide(test.dependencies.pipe(Layer.provide(NodeServices.layer))));
    },
  );

  it.effect(
    "preserves the connection and links when a new address rejects the saved identity",
    () => {
      const test = fixture();
      return Effect.gen(function* () {
        using fetch = vi.spyOn(globalThis, "fetch").mockImplementation(test.fetch);
        yield* seed;
        const service = yield* FogBugzService;
        expect((yield* Effect.flip(service.connect({ ...credentials, password: "" }))).code).toBe(
          "authentication",
        );
        expect(test.requests).toHaveLength(0);
        yield* service.connect(credentials);
        yield* service.linkProject({ projectId, fogbugzProjectId: 12 });
        yield* service.linkThread({ threadId, caseId: 42 });
        const previous = yield* service.status();
        for (const [response, code] of [
          [new Response('<response><error code="3">Expired</error></response>'), "authentication"],
          [
            new Response(
              "<response><person><ixPerson>8</ixPerson><sFullName>Other Person</sFullName></person></response>",
            ),
            "authentication",
          ],
          [new Response("Unavailable", { status: 503 }), "network"],
        ] as const) {
          fetch.mockResolvedValueOnce(response);
          expect(
            (yield* Effect.flip(
              service.connect({ ...credentials, baseUrl: "https://other.example/", password: "" }),
            )).code,
          ).toBe(code);
          expect(yield* service.status()).toEqual(previous);
          expect((yield* service.thread(threadId))?.caseId).toBe(42);
          expect(test.secrets.size).toBe(1);
        }
      }).pipe(Effect.provide(test.service.pipe(Layer.provideMerge(test.dependencies))));
    },
  );

  it.effect(
    "rejects inaccessible projects and foreign cases without changing the existing association",
    () => {
      const test = fixture();
      return Effect.gen(function* () {
        using _fetch = vi.spyOn(globalThis, "fetch").mockImplementation(test.fetch);
        yield* seed;
        const service = yield* FogBugzService;
        yield* service.connect(credentials);
        expect(
          (yield* Effect.flip(service.linkProject({ projectId, fogbugzProjectId: 99 }))).code,
        ).toBe("access");
        yield* service.linkProject({ projectId, fogbugzProjectId: 12 });
        yield* service.linkThread({ threadId, caseId: 42 });
        expect((yield* Effect.flip(service.linkThread({ threadId, caseId: 43 }))).code).toBe(
          "project",
        );
        expect((yield* service.thread(threadId))?.caseId).toBe(42);
      }).pipe(
        Effect.provide(
          test.service.pipe(
            Layer.provideMerge(test.dependencies),
            Layer.provide(NodeServices.layer),
          ),
        ),
      );
    },
  );

  it.effect(
    "stops further API calls after authentication is rejected and allows an explicit reconnect",
    () => {
      const test = fixture();
      return Effect.gen(function* () {
        using fetch = vi.spyOn(globalThis, "fetch").mockImplementation(test.fetch);
        const service = yield* FogBugzService;
        yield* service.connect(credentials);
        fetch.mockResolvedValueOnce(
          new Response('<response><error code="3">Private rejection</error></response>'),
        );
        expect((yield* Effect.flip(service.projects())).code).toBe("authentication");
        const count = fetch.mock.calls.length;
        expect((yield* Effect.flip(service.projects())).code).toBe("authentication");
        expect(fetch.mock.calls).toHaveLength(count);
        yield* service.connect(credentials);
        expect((yield* service.status()).connection?.authenticated).toBe(true);
      }).pipe(Effect.provide(test.service.pipe(Layer.provide(NodeServices.layer))));
    },
  );

  it.effect("creates a linked thread without sending a provider turn", () => {
    const test = fixture();
    const commands: unknown[] = [];
    const threads = Layer.mock(ThreadManagementService)({
      dispatch: (command) =>
        Effect.sync(() => {
          commands.push(command);
          return {} as never;
        }),
    });
    return Effect.gen(function* () {
      using _fetch = vi.spyOn(globalThis, "fetch").mockImplementation(test.fetch);
      yield* seed;
      const service = yield* FogBugzService;
      yield* service.connect(credentials);
      yield* service.linkProject({ projectId, fogbugzProjectId: 12 });
      const createdId = ThreadId.make("new-fogbugz-thread");
      const input = {
        commandId: CommandId.make("create-fogbugz-thread"),
        threadId: createdId,
        projectId,
        caseId: 42,
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "test-model",
        },
      };
      expect(yield* createThread(input)).toBe(createdId);
      expect(commands).toEqual([
        expect.objectContaining({
          type: "thread.create",
          threadId: createdId,
          title: "#42 Case 42",
        }),
      ]);
      expect(commands[0]).not.toHaveProperty("initialMessage");
      const sql = yield* SqlClient.SqlClient;
      expect(
        (yield* sql`SELECT case_id FROM fogbugz_threads WHERE thread_id = ${createdId}`)[0]
          ?.case_id,
      ).toBe(42);
    }).pipe(
      Effect.provide(
        Layer.merge(test.service, threads).pipe(
          Layer.provideMerge(test.dependencies),
          Layer.provide(NodeServices.layer),
        ),
      ),
    );
  });
});
