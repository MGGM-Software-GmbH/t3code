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
const caseXml = (id: number, project: number, assigned = 7) =>
  `<case ixBug="${id}"><ixBug>${id}</ixBug><sTitle>Case ${id}</sTitle><ixProject>${project}</ixProject><sProject>Project ${project}</sProject><sStatus>Active</sStatus><fOpen>true</fOpen><ixPersonAssignedTo>${assigned}</ixPersonAssignedTo></case>`;

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
      command === "logon"
        ? "<token>private-token</token>"
        : command === "viewPerson"
          ? "<person><ixPerson>7</ixPerson><sFullName>Test Person</sFullName></person>"
          : command === "listProjects"
            ? "<projects><project><ixProject>12</ixProject><sProject>Project 12</sProject></project></projects>"
            : command === "search"
              ? `<cases>${params.get("q") === "42" ? caseXml(42, 12) : caseXml(42, 12) + caseXml(43, 99) + caseXml(44, 12, 8)}</cases>`
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
        }).pipe(Effect.provide(test.service));
        yield* Effect.gen(function* () {
          const restored = yield* FogBugzService;
          expect((yield* restored.thread(threadId))?.url).toBe(
            "https://fogbugz.example/default.asp?pg=pgEditBug&command=view&ixBug=42",
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
