import {
  FogBugzConnection,
  FogBugzError,
  FogBugzStatus,
  FogBugzCaseList,
  FogBugzProject,
  FogBugzThreadLink,
  type FogBugzConnectInput,
  type FogBugzCasesInput,
  type FogBugzLinkThreadInput,
  type FogBugzCase,
  type FogBugzCaseContext,
  type FogBugzCaseContextInput,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { FogBugzApi, normalizeFogBugzUrl } from "./FogBugzApi.ts";

export class FogBugzService extends Context.Service<
  FogBugzService,
  {
    status: () => Effect.Effect<typeof FogBugzStatus.Type, FogBugzError>;
    connect: (
      input: typeof FogBugzConnectInput.Type,
    ) => Effect.Effect<FogBugzConnection, FogBugzError>;
    disconnect: () => Effect.Effect<void, FogBugzError>;
    test: () => Effect.Effect<FogBugzConnection, FogBugzError>;
    browserSession: (
      threadId: ThreadId,
    ) => Effect.Effect<{ url: string; baseUrl: string; cookie: string }, FogBugzError>;
    projects: () => Effect.Effect<ReadonlyArray<typeof FogBugzProject.Type>, FogBugzError>;
    linkProject: (input: {
      projectId: ProjectId;
      fogbugzProjectId: number | null;
      fogbugzProjectGroupId?: number | null;
    }) => Effect.Effect<void, FogBugzError>;
    cases: (
      input: typeof FogBugzCasesInput.Type,
    ) => Effect.Effect<typeof FogBugzCaseList.Type, FogBugzError>;
    caseContext: (
      input: typeof FogBugzCaseContextInput.Type,
    ) => Effect.Effect<FogBugzCaseContext, FogBugzError>;
    thread: (
      threadId: ThreadId,
    ) => Effect.Effect<typeof FogBugzThreadLink.Type | null, FogBugzError>;
    linkThread: (input: typeof FogBugzLinkThreadInput.Type) => Effect.Effect<void, FogBugzError>;
    prepareThread: (input: {
      threadId: ThreadId;
      projectId: ProjectId;
      caseId: number;
    }) => Effect.Effect<FogBugzCase, FogBugzError>;
  }
>()("t3/fogbugz/FogBugzService") {}

const storageError = () => new FogBugzError({ code: "storage" });
const isFogBugzError = Schema.is(FogBugzError);
const apiError = (cause: unknown) =>
  isFogBugzError(cause) ? cause : new FogBugzError({ code: "response" });

export const layer = Layer.effect(
  FogBugzService,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const secrets = yield* ServerSecretStore.ServerSecretStore;
    const lock = yield* Semaphore.make(1);
    const crypto = yield* Crypto.Crypto;
    const decodeConnection = Schema.decodeEffect(Schema.fromJsonString(FogBugzConnection));
    const connection = Effect.fn("FogBugz.connection")(function* () {
      const rows = yield* sql<{
        payload: string;
      }>`SELECT payload FROM fogbugz_connection WHERE id = 1`;
      return rows[0] ? yield* decodeConnection(rows[0].payload) : null;
    }, Effect.mapError(storageError));
    const saveConnection = (value: FogBugzConnection) =>
      sql`INSERT INTO fogbugz_connection (id, payload) VALUES (1, ${JSON.stringify(value)}) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload`.pipe(
        Effect.asVoid,
        Effect.mapError(storageError),
      );
    const authenticated = Effect.fn("FogBugz.authenticated")(function* () {
      const current = yield* connection();
      if (!current) return yield* new FogBugzError({ code: "connection_required" });
      if (!current.authenticated) return yield* new FogBugzError({ code: "authentication" });
      const token = yield* secrets.get(`fogbugz-${current.id}`).pipe(Effect.mapError(storageError));
      if (Option.isNone(token)) return yield* new FogBugzError({ code: "authentication" });
      return {
        current,
        api: new FogBugzApi(current.baseUrl),
        token: new TextDecoder().decode(token.value),
      };
    });
    const call = Effect.fn("FogBugz.call")(function* <Value>(
      run: (api: FogBugzApi, token: string, current: FogBugzConnection) => Promise<Value>,
    ) {
      const { current, api, token } = yield* authenticated();
      return yield* Effect.tryPromise({
        try: () => run(api, token, current),
        catch: apiError,
      }).pipe(
        Effect.tapError((error) =>
          error.code === "authentication"
            ? sql`UPDATE fogbugz_connection SET payload = ${JSON.stringify({ ...current, authenticated: false })} WHERE id = 1 AND payload = ${JSON.stringify(current)}`.pipe(
                Effect.asVoid,
                Effect.mapError(storageError),
              )
            : Effect.void,
        ),
      );
    });
    const projectLinks = () =>
      sql<{
        projectId: ProjectId;
        fogbugzProjectId: number | null;
        fogbugzProjectGroupId: number | null;
      }>`SELECT links.project_id AS "projectId", links.fogbugz_project_id AS "fogbugzProjectId", NULL AS "fogbugzProjectGroupId" FROM fogbugz_projects links JOIN projection_projects project ON project.project_id = links.project_id WHERE project.deleted_at IS NULL
      UNION ALL SELECT links.project_id AS "projectId", NULL AS "fogbugzProjectId", links.fogbugz_project_group_id AS "fogbugzProjectGroupId" FROM fogbugz_project_groups links JOIN projection_projects project ON project.project_id = links.project_id WHERE project.deleted_at IS NULL`.pipe(
        Effect.mapError(storageError),
      );
    const resolveProjectLinks = Effect.fn("FogBugz.resolveProjectLinks")(function* (
      links: ReadonlyArray<(typeof FogBugzStatus.Type.projects)[number]>,
    ) {
      const projects = links.some((link) => link.fogbugzProjectGroupId !== null)
        ? yield* call((api, token) => api.projects(token))
        : [];
      return links.flatMap((link) =>
        link.fogbugzProjectId !== null
          ? [{ projectId: link.projectId, fogbugzProjectId: link.fogbugzProjectId }]
          : projects
              .filter((project) =>
                project.groups.some((group) => group.id === link.fogbugzProjectGroupId),
              )
              .map((project) => ({ projectId: link.projectId, fogbugzProjectId: project.id })),
      );
    });
    const threadLinks = Effect.fn("FogBugz.threadLinks")(function* () {
      const current = yield* connection();
      if (!current) return [];
      const rows = yield* sql<{
        threadId: ThreadId;
        projectId: ProjectId;
        caseId: number;
        title: string;
      }>`SELECT links.thread_id AS "threadId", links.project_id AS "projectId", links.case_id AS "caseId", thread.title FROM fogbugz_threads links JOIN orchestration_v2_projection_threads thread ON thread.thread_id = links.thread_id WHERE thread.deleted_at IS NULL`.pipe(
        Effect.mapError(storageError),
      );
      return rows.map((row) => ({
        ...row,
        url: new URL(`default.asp?pg=pgEditBug&command=view&ixBug=${row.caseId}`, current.baseUrl)
          .href,
      }));
    });
    const caseForProject = Effect.fn("FogBugz.caseForProject")(function* (
      projectId: ProjectId,
      caseId: number,
    ) {
      const links = yield* resolveProjectLinks(
        (yield* projectLinks()).filter((item) => item.projectId === projectId),
      );
      if (links.length === 0) return yield* new FogBugzError({ code: "project" });
      const cases = yield* call((api, token) => api.cases(token, String(caseId)));
      const item = cases.find((candidate) => candidate.id === caseId);
      if (!item) return yield* new FogBugzError({ code: "access" });
      if (!links.some((link) => item.projectId === link.fogbugzProjectId))
        return yield* new FogBugzError({ code: "project" });
      return item;
    });
    const writeThreadLink = Effect.fn("FogBugz.writeThreadLink")(function* (input: {
      threadId: ThreadId;
      projectId: ProjectId;
      caseId: number;
    }) {
      const item = yield* caseForProject(input.projectId, input.caseId);
      yield* sql`INSERT INTO fogbugz_threads (thread_id, project_id, case_id, title) VALUES (${input.threadId}, ${input.projectId}, ${item.id}, ${item.title}) ON CONFLICT(thread_id) DO UPDATE SET project_id = excluded.project_id, case_id = excluded.case_id, title = excluded.title`.pipe(
        Effect.mapError(storageError),
      );
      return item;
    });
    const prepareThread = Effect.fn("FogBugz.prepareThread")(function* (input: {
      threadId: ThreadId;
      projectId: ProjectId;
      caseId: number;
    }) {
      return yield* lock.withPermit(
        Effect.gen(function* () {
          const existing =
            yield* sql`SELECT thread_id FROM orchestration_v2_projection_threads WHERE thread_id = ${input.threadId}`.pipe(
              Effect.mapError(storageError),
            );
          const reservation =
            yield* sql`SELECT thread_id FROM fogbugz_threads WHERE thread_id = ${input.threadId} AND project_id = ${input.projectId} AND case_id = ${input.caseId}`.pipe(
              Effect.mapError(storageError),
            );
          if (existing.length && !reservation.length)
            return yield* new FogBugzError({ code: "thread" });
          return yield* writeThreadLink(input);
        }),
      );
    });
    return FogBugzService.of({
      caseContext: Effect.fn("FogBugz.caseContext")(function* (input) {
        const rows = yield* sql<{
          projectId: ProjectId;
        }>`SELECT project_id AS "projectId" FROM orchestration_v2_projection_threads WHERE thread_id = ${input.threadId} AND deleted_at IS NULL`.pipe(
          Effect.mapError(storageError),
        );
        if (!rows[0]) return yield* new FogBugzError({ code: "thread" });
        const item = yield* caseForProject(rows[0].projectId, input.caseId);
        const current = yield* authenticated();
        const events = yield* call((api, token) => api.caseEvents(token, item.id));
        return {
          case: item,
          url: new URL(`default.asp?${item.id}`, current.current.baseUrl).href,
          events,
        };
      }),
      status: Effect.fn("FogBugz.status")(function* () {
        return { connection: yield* connection(), projects: yield* projectLinks() };
      }),
      connect: Effect.fn("FogBugz.connect")(function* (input) {
        return yield* lock.withPermit(
          Effect.gen(function* () {
            const baseUrl = yield* Effect.try({
              try: () => normalizeFogBugzUrl(input.baseUrl),
              catch: apiError,
            });
            const api = new FogBugzApi(baseUrl);
            const token = yield* Effect.tryPromise({
              try: () => api.login(input.username, input.password),
              catch: apiError,
            });
            const person = yield* Effect.tryPromise({
              try: () => api.person(token),
              catch: apiError,
            }).pipe(
              Effect.onError(() =>
                Effect.tryPromise({ try: () => api.logout(token), catch: apiError }).pipe(
                  Effect.ignore,
                ),
              ),
            );
            const previous = yield* connection();
            const sameIdentity = previous?.baseUrl === baseUrl && previous.personId === person.id;
            const next = {
              id: yield* crypto.randomUUIDv4().pipe(Effect.mapError(storageError)),
              baseUrl,
              username: input.username,
              personId: person.id,
              personName: person.name,
              authenticated: true,
            };
            yield* secrets.set(`fogbugz-${next.id}`, new TextEncoder().encode(token)).pipe(
              Effect.mapError(storageError),
              Effect.onError(() => secrets.remove(`fogbugz-${next.id}`).pipe(Effect.ignore)),
            );
            yield* sql
              .withTransaction(
                Effect.gen(function* () {
                  if (!sameIdentity) {
                    yield* sql`DELETE FROM fogbugz_threads`;
                    yield* sql`DELETE FROM fogbugz_projects`;
                    yield* sql`DELETE FROM fogbugz_project_groups`;
                  }
                  yield* saveConnection(next);
                }),
              )
              .pipe(Effect.mapError(storageError));
            if (previous)
              yield* secrets.remove(`fogbugz-${previous.id}`).pipe(Effect.mapError(storageError));
            return next;
          }),
        );
      }),
      disconnect: Effect.fn("FogBugz.disconnect")(function* () {
        return yield* lock.withPermit(
          Effect.gen(function* () {
            const previous = yield* connection();
            yield* sql
              .withTransaction(
                Effect.gen(function* () {
                  yield* sql`DELETE FROM fogbugz_threads`;
                  yield* sql`DELETE FROM fogbugz_projects`;
                  yield* sql`DELETE FROM fogbugz_project_groups`;
                  yield* sql`DELETE FROM fogbugz_connection`;
                }),
              )
              .pipe(Effect.mapError(storageError));
            if (previous)
              yield* secrets.remove(`fogbugz-${previous.id}`).pipe(Effect.mapError(storageError));
          }),
        );
      }),
      test: Effect.fn("FogBugz.test")(function* () {
        return yield* call(async (api, token, current) => {
          await api.person(token);
          return current;
        });
      }),
      projects: Effect.fn("FogBugz.projects")(function* () {
        return yield* call((api, token) => api.projects(token));
      }),
      linkProject: Effect.fn("FogBugz.linkProject")(function* (input) {
        return yield* lock.withPermit(
          Effect.gen(function* () {
            const previous = (yield* projectLinks()).find(
              (item) => item.projectId === input.projectId,
            );
            const groupId = input.fogbugzProjectGroupId ?? null;
            if (input.fogbugzProjectId !== null && groupId !== null)
              return yield* new FogBugzError({ code: "project" });
            if (
              previous &&
              previous.fogbugzProjectId === input.fogbugzProjectId &&
              previous.fogbugzProjectGroupId === groupId
            )
              return;
            if (input.fogbugzProjectId !== null || groupId !== null) {
              const projects = yield* call((api, token) => api.projects(token));
              if (
                !projects.some((project) =>
                  groupId !== null
                    ? project.groups.some((group) => group.id === groupId)
                    : project.id === input.fogbugzProjectId,
                )
              )
                return yield* new FogBugzError({ code: "access" });
              const local =
                yield* sql`SELECT project_id FROM projection_projects WHERE project_id = ${input.projectId} AND deleted_at IS NULL`.pipe(
                  Effect.mapError(storageError),
                );
              if (local.length === 0) return yield* new FogBugzError({ code: "project" });
            }
            yield* sql
              .withTransaction(
                Effect.gen(function* () {
                  yield* sql`DELETE FROM fogbugz_threads WHERE project_id = ${input.projectId}`;
                  yield* sql`DELETE FROM fogbugz_project_groups WHERE project_id = ${input.projectId}`;
                  if (input.fogbugzProjectId === null)
                    yield* sql`DELETE FROM fogbugz_projects WHERE project_id = ${input.projectId}`;
                  else
                    yield* sql`INSERT INTO fogbugz_projects (project_id, fogbugz_project_id) VALUES (${input.projectId}, ${input.fogbugzProjectId}) ON CONFLICT(project_id) DO UPDATE SET fogbugz_project_id = excluded.fogbugz_project_id`;
                  if (groupId !== null)
                    yield* sql`INSERT INTO fogbugz_project_groups (project_id, fogbugz_project_group_id) VALUES (${input.projectId}, ${groupId})`;
                }),
              )
              .pipe(Effect.mapError(storageError));
          }),
        );
      }),
      cases: Effect.fn("FogBugz.cases")(function* (input) {
        const links = yield* resolveProjectLinks(
          (yield* projectLinks()).filter(
            (link) => !input.projectId || link.projectId === input.projectId,
          ),
        );
        if (links.length === 0) {
          yield* authenticated();
          return { cases: [], threads: [], truncated: false, projects: links };
        }
        const current = yield* authenticated();
        const scope = `(${[...new Set(links.map((link) => link.fogbugzProjectId))].map((id) => `project:=${id}`).join(" OR ")})`;
        const query = /^\d+$/.test(input.query.trim())
          ? input.query.trim()
          : [
              scope,
              input.state === "all" ? "" : `status:${input.state}`,
              input.assignedToMe ? "assignedto:me" : "",
              input.query ? `(${input.query})` : "",
              'orderby:"-notified,-lastedited"',
            ]
              .filter(Boolean)
              .join(" ");
        const cases = yield* call((api, token) => api.cases(token, query));
        const visible = cases.filter(
          (item) =>
            links.some((link) => link.fogbugzProjectId === item.projectId) &&
            (input.state === "all" || item.open === (input.state === "open")) &&
            (!input.assignedToMe || item.assignedTo === current.current.personId),
        );
        const threads = (yield* threadLinks()).filter((thread) =>
          visible.some((item) => item.id === thread.caseId),
        );
        visible.sort(
          (left, right) =>
            (right.notifiedAt ?? "").localeCompare(left.notifiedAt ?? "") ||
            (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "") ||
            right.id - left.id,
        );
        return {
          cases: visible.slice(0, 200),
          threads,
          truncated: cases.length > 200,
          projects: links,
        };
      }),
      thread: Effect.fn("FogBugz.thread")(function* (threadId) {
        const linked = (yield* threadLinks()).find((item) => item.threadId === threadId);
        if (!linked) return null;
        const rows = yield* sql<{
          title: string;
        }>`SELECT title FROM fogbugz_threads WHERE thread_id = ${threadId}`.pipe(
          Effect.mapError(storageError),
        );
        return rows[0] ? { ...linked, title: rows[0].title } : null;
      }),
      prepareThread,
      browserSession: Effect.fn("FogBugz.browserSession")(function* (threadId) {
        return yield* lock.withPermit(
          Effect.gen(function* () {
            const linked = (yield* threadLinks()).find((item) => item.threadId === threadId);
            if (!linked) return yield* new FogBugzError({ code: "thread" });
            yield* caseForProject(linked.projectId, linked.caseId);
            return yield* call(async (api, token, current) => ({
              url: linked.url,
              baseUrl: current.baseUrl,
              cookie: await api.browserSession(token, current.personId),
            }));
          }),
        );
      }),
      linkThread: Effect.fn("FogBugz.linkThread")(function* (input) {
        return yield* lock.withPermit(
          Effect.gen(function* () {
            if (input.caseId === null) {
              yield* sql`DELETE FROM fogbugz_threads WHERE thread_id = ${input.threadId}`.pipe(
                Effect.mapError(storageError),
              );
              return;
            }
            const rows = yield* sql<{
              projectId: ProjectId;
            }>`SELECT project_id AS "projectId" FROM orchestration_v2_projection_threads WHERE thread_id = ${input.threadId} AND deleted_at IS NULL`.pipe(
              Effect.mapError(storageError),
            );
            if (!rows[0]) return yield* new FogBugzError({ code: "thread" });
            yield* writeThreadLink({
              ...input,
              caseId: input.caseId,
              projectId: rows[0].projectId,
            });
          }),
        );
      }),
    });
  }),
);
