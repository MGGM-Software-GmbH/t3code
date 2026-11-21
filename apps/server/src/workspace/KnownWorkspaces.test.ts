import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { DEFAULT_SERVER_SETTINGS, ProjectId } from "@t3tools/contracts";
import * as SqlClient from "effect/sql/SqlClient";
import * as ServerConfig from "../config.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import { caseGitPath, caseGitMetadataPath } from "../fogbugz/caseGitPath.ts";
import * as KnownWorkspaces from "./KnownWorkspaces.ts";

it.live(
  "authorizes only the current linked case checkout and rejects symlinks and account changes",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-case-roots-" });
        const root = caseGitPath(path, baseDir, "connection", 7, 42, "thread")!;
        yield* fs.makeDirectory(root, { recursive: true });
        yield* fs.writeFileString(path.join(path.dirname(root), "repository-id"), "fixture-id");
        const workspaceRoot = path.join(baseDir, "project");
        const sharedDirectory = path.join(baseDir, "shared");
        const shared = path.join(sharedDirectory, "FB42");
        yield* fs.makeDirectory(shared, { recursive: true });
        yield* fs.makeDirectory(workspaceRoot);
        const metadata = caseGitMetadataPath(path, baseDir, shared, true);
        yield* fs.makeDirectory(metadata, { recursive: true });
        yield* fs.writeFileString(path.join(metadata, "repository-id"), "connection:7:fixture-id");
        const configured = { directory: "" };
        yield* Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`INSERT INTO orchestration_v2_projection_threads (thread_id, project_id, title, default_provider, runtime_mode, interaction_mode, created_at, updated_at, payload_json) VALUES ('thread', 'project', 'Case', 'codex', 'full-access', 'default', '2026-01-01', '2026-01-01', '{}')`;
          yield* sql`INSERT INTO fogbugz_connection (id, payload) VALUES (1, '{"id":"connection","personId":7,"authenticated":true}')`;
          yield* sql`INSERT INTO fogbugz_threads (thread_id, project_id, case_id, title) VALUES ('thread', 'project', 42, 'Case')`;
          const known = yield* KnownWorkspaces.KnownWorkspaces;
          expect(yield* known.contains(root)).toBe(true);
          expect(yield* known.contains(path.dirname(root))).toBe(false);
          expect(yield* known.contains(path.join(baseDir, "userdata"))).toBe(false);
          configured.directory = sharedDirectory;
          expect(yield* known.contains(shared)).toBe(true);
          expect(yield* known.contains(sharedDirectory)).toBe(false);
          expect(yield* known.contains(root)).toBe(false);
          yield* sql`UPDATE fogbugz_connection SET payload = '{"id":"connection","personId":8,"authenticated":true}'`;
          expect(yield* known.contains(shared)).toBe(false);
          expect(yield* known.contains(root)).toBe(false);
          yield* sql`UPDATE fogbugz_connection SET payload = '{"id":"connection","personId":7,"authenticated":true}'`;
          yield* sql`DELETE FROM fogbugz_threads`;
          expect(yield* known.contains(shared)).toBe(false);
          expect(yield* known.contains(root)).toBe(false);
          configured.directory = "";
          yield* sql`INSERT INTO fogbugz_threads (thread_id, project_id, case_id, title) VALUES ('thread', 'project', 42, 'Case')`;
          yield* fs.rename(root, path.join(baseDir, "outside"));
          yield* fs.symlink(path.join(baseDir, "outside"), root);
          expect(yield* known.contains(path.join(baseDir, "outside"))).toBe(false);
        }).pipe(
          Effect.provide(
            KnownWorkspaces.layer.pipe(
              Layer.provide(
                Layer.mock(ProjectStore.ProjectStoreV2)({
                  listShells: () =>
                    Effect.succeed([{ id: ProjectId.make("project"), workspaceRoot } as never]),
                }),
              ),
              Layer.provide(
                Layer.mock(ServerSettings.ServerSettingsService)({
                  getSettings: Effect.suspend(() =>
                    Effect.succeed({
                      ...DEFAULT_SERVER_SETTINGS,
                      projectSettingsOverrides: {
                        [ProjectId.make("project")]: {
                          fogbugzCaseGitDirectory: configured.directory,
                        },
                      },
                    }),
                  ),
                }),
              ),
              Layer.provide(Layer.mock(GitVcsDriver.GitVcsDriver)({})),
              Layer.provide(ServerConfig.layerTest(baseDir, baseDir)),
              Layer.provideMerge(Sqlite.layerMemory),
            ),
          ),
        );
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
);
