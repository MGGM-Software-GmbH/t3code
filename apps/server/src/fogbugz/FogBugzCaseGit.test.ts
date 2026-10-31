import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  FogBugzError,
  ThreadId,
  RunId,
  ProjectId,
  DEFAULT_SERVER_SETTINGS as ServerSettingsTestDefaults,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as ServerSettings from "../serverSettings.ts";
import { ProjectStoreV2 } from "../orchestration-v2/ProjectStore.ts";
import * as NodeURL from "node:url";
import * as ServerConfig from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import { FogBugzService } from "./FogBugzService.ts";
import * as CaseGit from "./FogBugzCaseGit.ts";
import { caseGitPath } from "./caseGitPath.ts";
import { ProjectionStoreV2 } from "../orchestration-v2/ProjectionStore.ts";
import { withCaseGitRoot } from "./caseGitInstructions.ts";
import { createPendingAttachmentId } from "../attachmentStore.ts";

const prepare = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-case-git-" });
  const remote = path.join(root, "remote.git");
  const process = yield* ProcessRunner.ProcessRunner;
  const git = (args: ReadonlyArray<string>, cwd = root) =>
    process.run({ command: "git", args, cwd });
  yield* git(["init", "--bare", "--initial-branch=main", remote]);
  const repository = {
    connectionId: "connection-fixture",
    personId: 7,
    caseId: 42,
    repositoryId: "f3e37008-65d3-4cd5-8276-6cfdcc8b8901",
    canWrite: true,
    remoteUrl: NodeURL.pathToFileURL(remote).href,
    token: "case-git-secret-fixture",
    limits: {
      fileBytes: 26214400,
      groupBytes: 104857600,
      groupFiles: 100,
      repositoryBytes: 524288000,
    },
  };
  const activity = { runId: null as RunId | null };
  const project = { id: ProjectId.make("project"), workspaceRoot: path.join(root, "project") };
  yield* fs.makeDirectory(project.workspaceRoot);
  const shared = { directory: "", activeThread: null as ThreadId | null };
  const serviceLayer = CaseGit.layer.pipe(
    Layer.provide(
      Layer.mock(ProjectStoreV2)({ getShell: () => Effect.succeedSome(project as never) }),
    ),
    Layer.provide(
      Layer.mock(ServerSettings.ServerSettingsService)({
        getSettings: Effect.suspend(() =>
          Effect.succeed({
            ...ServerSettingsTestDefaults,
            projectSettingsOverrides: {
              [project.id]: { fogbugzCaseGitDirectory: shared.directory },
            },
          }),
        ),
      }),
    ),
    Layer.provide(
      Layer.mock(FogBugzService)({
        caseThreadIds: () => Effect.succeed(shared.activeThread ? [shared.activeThread] : []),
        caseGitRepository: () => Effect.succeed(repository),
        thread: (threadId) =>
          Effect.succeed({
            threadId,
            projectId: "project" as never,
            caseId: 42,
            title: "Fixture",
            url: "http://example.invalid/default.asp?42",
          }),
      }),
    ),
    Layer.provide(
      Layer.mock(ProjectionStoreV2)({
        getShellSnapshot: () =>
          Effect.succeed({
            threads: shared.activeThread
              ? [{ id: shared.activeThread, activeRunId: RunId.make("other-run") }]
              : [],
          } as never),
        getThreadShell: () =>
          Effect.succeed(
            activity.runId === null ? null : ({ activeRunId: activity.runId } as never),
          ),
      }),
    ),
    Layer.provide(ServerConfig.layerTest(root, root)),
  );
  return { fs, path, root, remote, git, repository, activity, shared, project, serviceLayer };
});

const runtime = ProcessRunner.layer.pipe(Layer.provideMerge(NodeServices.layer));

describe("per-thread case Git checkout", () => {
  it.live(
    "commits and publishes case changes, rejects stale confirmations, and reverts only uncommitted files",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fixture = yield* prepare;
          yield* Effect.gen(function* () {
            const service = yield* CaseGit.FogBugzCaseGit;
            const threadId = ThreadId.make("manual-git");
            const initial = yield* service.manage({ threadId, action: { type: "status" } });
            const { checkout } = initial;
            fixture.shared.directory = "alternate";
            const otherLocation = yield* service.manage({ threadId, action: { type: "status" } });
            expect(otherLocation.revision).not.toBe(initial.revision);
            expect(
              yield* service
                .manage({ threadId, action: { type: "revert", revision: initial.revision } })
                .pipe(Effect.flip),
            ).toMatchObject({ code: "case_git_changed" });
            fixture.shared.directory = "";
            const file = fixture.path.join(checkout.cwd, "PRP.md");
            yield* fixture.fs.writeFileString(file, "First plan");
            const first = yield* service.manage({ threadId, action: { type: "status" } });
            expect(first.paths).toEqual(["PRP.md"]);
            // Reading status must leave the real Git index unchanged, including on an unborn branch.
            expect(
              (yield* fixture.git(["diff", "--cached", "--name-only"], checkout.cwd)).stdout,
            ).toBe("");
            const committed = yield* service.manage({
              threadId,
              action: { type: "commit", revision: first.revision, message: "Document the case" },
            });
            expect(committed.paths).toEqual([]);
            expect(committed.checkout.syncIssue).toBeUndefined();
            const head = (yield* fixture.git(["rev-parse", "HEAD"], checkout.cwd)).stdout.trim();
            expect((yield* fixture.git(["rev-parse", "main"], fixture.remote)).stdout.trim()).toBe(
              head,
            );
            expect(
              (yield* fixture.git(["log", "-1", "--format=%s"], fixture.remote)).stdout.trim(),
            ).toBe("Document the case");
            yield* fixture.fs.writeFileString(file, "Draft");
            const stale = yield* service.manage({ threadId, action: { type: "status" } });
            yield* fixture.fs.writeFileString(file, "Newer draft");
            for (const action of [
              { type: "revert" as const, revision: stale.revision },
              { type: "commit" as const, revision: stale.revision, message: "Stale plan" },
            ])
              expect(yield* service.manage({ threadId, action }).pipe(Effect.flip)).toMatchObject({
                code: "case_git_changed",
              });
            expect(yield* fixture.fs.readFileString(file)).toBe("Newer draft");
            yield* fixture.fs.writeFileString(fixture.path.join(checkout.cwd, "new.md"), "New");
            yield* fixture.fs.writeFileString(
              fixture.path.join(checkout.cwd, "staged.md"),
              "Staged",
            );
            yield* fixture.git(["add", "staged.md"], checkout.cwd);
            yield* fixture.fs.writeFileString(
              fixture.path.join(checkout.cwd, ".git/info/exclude"),
              "ignored.txt\n",
            );
            yield* fixture.fs.writeFileString(
              fixture.path.join(checkout.cwd, "ignored.txt"),
              "Keep",
            );
            const dirty = yield* service.manage({ threadId, action: { type: "status" } });
            expect(dirty.paths).toEqual(["PRP.md", "new.md", "staged.md"]);
            const reverted = yield* service.manage({
              threadId,
              action: { type: "revert", revision: dirty.revision },
            });
            expect(reverted.paths).toEqual([]);
            expect(yield* fixture.fs.readFileString(file)).toBe("First plan");
            expect(yield* fixture.fs.exists(fixture.path.join(checkout.cwd, "new.md"))).toBe(false);
            expect(yield* fixture.fs.exists(fixture.path.join(checkout.cwd, "staged.md"))).toBe(
              false,
            );
            expect(
              yield* fixture.fs.readFileString(fixture.path.join(checkout.cwd, "ignored.txt")),
            ).toBe("Keep");
            expect((yield* fixture.git(["rev-parse", "HEAD"], checkout.cwd)).stdout.trim()).toBe(
              head,
            );
            yield* fixture.fs.writeFileString(file, "Staged draft");
            yield* fixture.git(["add", "PRP.md"], checkout.cwd);
            yield* fixture.fs.writeFileString(file, "First plan");
            const stagedOnly = yield* service.manage({ threadId, action: { type: "status" } });
            expect(stagedOnly.paths).toEqual(["PRP.md"]);
            yield* service.manage({
              threadId,
              action: { type: "revert", revision: stagedOnly.revision },
            });
            expect((yield* fixture.git(["status", "--porcelain"], checkout.cwd)).stdout).toBe("");
            yield* fixture.fs.writeFileString(file, "Oversized");
            fixture.repository.limits.fileBytes = 3;
            const oversized = yield* service.manage({ threadId, action: { type: "status" } });
            expect(
              yield* service
                .manage({
                  threadId,
                  action: { type: "commit", revision: oversized.revision, message: "Too large" },
                })
                .pipe(Effect.flip),
            ).toMatchObject({ code: "case_files_limit" });
            fixture.repository.canWrite = false;
            expect(
              yield* service
                .manage({ threadId, action: { type: "revert", revision: oversized.revision } })
                .pipe(Effect.flip),
            ).toMatchObject({ code: "case_files_readonly" });
            fixture.repository.canWrite = true;
            fixture.activity.runId = RunId.make("active");
            expect(
              yield* service
                .manage({ threadId, action: { type: "revert", revision: oversized.revision } })
                .pipe(Effect.flip),
            ).toMatchObject({ code: "case_files_busy" });
          }).pipe(Effect.provide(fixture.serviceLayer));
        }),
      ).pipe(Effect.provide(runtime)),
  );
  it.live("reverts an unborn checkout without creating or publishing a commit", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* prepare;
        yield* Effect.gen(function* () {
          const service = yield* CaseGit.FogBugzCaseGit;
          const threadId = ThreadId.make("unborn-revert");
          const checkout = yield* service.ensure(threadId);
          const file = fixture.path.join(checkout.cwd, "draft.md");
          yield* fixture.fs.writeFileString(file, "Draft");
          yield* fixture.git(["add", "."], checkout.cwd);
          const state = yield* service.manage({ threadId, action: { type: "status" } });
          expect(
            (yield* service.manage({
              threadId,
              action: { type: "revert", revision: state.revision },
            })).paths,
          ).toEqual([]);
          expect(yield* fixture.fs.exists(file)).toBe(false);
          expect(
            (yield* fixture.git(["rev-parse", "--verify", "HEAD"], checkout.cwd)).code,
          ).not.toBe(0);
        }).pipe(Effect.provide(fixture.serviceLayer));
      }),
    ).pipe(Effect.provide(runtime)),
  );
  it.live("shares configured case folders, preserves defaults and blocks concurrent writers", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* prepare;
        yield* Effect.gen(function* () {
          const service = yield* CaseGit.FogBugzCaseGit;
          const firstId = ThreadId.make("first");
          const secondId = ThreadId.make("second");
          const original = yield* service.ensure(firstId);
          fixture.shared.directory = "case-artifacts";
          const first = yield* service.ensure(firstId);
          const second = yield* service.ensure(secondId);
          expect(first.cwd).toBe(
            fixture.path.join(fixture.project.workspaceRoot, "case-artifacts", "FB42"),
          );
          expect(second.cwd).toBe(first.cwd);
          fixture.repository.personId = 8;
          expect(yield* service.ensure(secondId).pipe(Effect.flip)).toMatchObject({
            code: "case_git",
          });
          fixture.repository.personId = 7;
          expect(yield* fixture.fs.exists(original.cwd)).toBe(true);
          yield* service.mutateFiles({
            threadId: firstId,
            action: { type: "create-file", path: "shared.md" },
          });
          expect(yield* fixture.fs.exists(fixture.path.join(second.cwd, "shared.md"))).toBe(true);
          fixture.shared.activeThread = firstId;
          expect((yield* service.ensure(secondId)).syncIssue).toContain("agent is running");
          expect((yield* service.ensure(secondId)).canWrite).toBe(false);
          expect(
            yield* service
              .mutateFiles({ threadId: secondId, action: { type: "delete", path: "shared.md" } })
              .pipe(Effect.flip),
          ).toMatchObject({ code: "case_files_busy" });
          expect(
            yield* service.prepareTurn(secondId, RunId.make("second-run")).pipe(Effect.flip),
          ).toMatchObject({ code: "case_files_busy" });
          fixture.shared.activeThread = null;
          const runId = RunId.make("first-run");
          expect((yield* service.prepareTurn(firstId, runId))?.cwd).toBe(first.cwd);
          expect(
            yield* service.prepareTurn(secondId, RunId.make("competing-run")).pipe(Effect.flip),
          ).toMatchObject({ code: "case_files_busy" });
          fixture.shared.directory = "changed-folder";
          yield* service.finishTurn(firstId, runId);
          expect(
            yield* fixture.fs.exists(
              fixture.path.join(fixture.project.workspaceRoot, "changed-folder"),
            ),
          ).toBe(false);
          fixture.shared.directory = fixture.path.join(fixture.root, "outside-project");
          expect((yield* service.ensure(secondId)).cwd).toBe(
            fixture.path.join(fixture.root, "outside-project", "FB42"),
          );
          fixture.repository.caseId = 43;
          expect((yield* service.ensure(secondId)).cwd).toBe(
            fixture.path.join(fixture.root, "outside-project", "FB43"),
          );
          fixture.shared.directory = ".git/cases";
          expect(yield* service.ensure(secondId).pipe(Effect.flip)).toMatchObject({
            code: "case_git",
          });
        }).pipe(Effect.provide(fixture.serviceLayer));
      }),
    ).pipe(Effect.provide(runtime)),
  );

  it.live(
    "creates shared checkouts without changing SVN properties or requiring a valid SVN working copy",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fixture = yield* prepare;
          const runner = yield* ProcessRunner.ProcessRunner;
          const svn = (args: ReadonlyArray<string>) =>
            runner.run({ command: "svn", args, cwd: fixture.root });
          const repository = fixture.path.join(fixture.root, "svn-repository");
          expect(
            (yield* runner.run({
              command: "svnadmin",
              args: ["create", repository],
              cwd: fixture.root,
            })).code,
          ).toBe(0);
          expect(
            (yield* svn([
              "checkout",
              NodeURL.pathToFileURL(repository).href,
              fixture.project.workspaceRoot,
            ])).code,
          ).toBe(0);
          expect(
            (yield* svn([
              "propset",
              "svn:ignore",
              "existing-entry\n",
              fixture.project.workspaceRoot,
            ])).code,
          ).toBe(0);
          fixture.shared.directory = "docs/case-artifacts";
          yield* Effect.gen(function* () {
            const service = yield* CaseGit.FogBugzCaseGit;
            yield* service.ensure(ThreadId.make("first"));
            yield* service.ensure(ThreadId.make("second"));
          }).pipe(Effect.provide(fixture.serviceLayer));
          expect(
            (yield* svn(["propget", "--strict", "svn:ignore", fixture.project.workspaceRoot]))
              .stdout,
          ).toBe("existing-entry\n");
          const status = yield* svn(["status", "--no-ignore", fixture.project.workspaceRoot]);
          expect(status.stdout).toContain("M");
          expect(status.stdout).toMatch(/\?\s+.*docs/);
          expect(
            (yield* svn([
              "info",
              "--show-item",
              "revision",
              fixture.project.workspaceRoot,
            ])).stdout.trim(),
          ).toBe("0");
          fixture.shared.directory = fixture.path.join(fixture.root, "broken-svn");
          yield* fixture.fs.makeDirectory(fixture.path.join(fixture.shared.directory, ".svn"), {
            recursive: true,
          });
          yield* Effect.gen(function* () {
            const service = yield* CaseGit.FogBugzCaseGit;
            expect((yield* service.ensure(ThreadId.make("broken"))).cwd).toBe(
              fixture.path.join(fixture.shared.directory, "FB42"),
            );
          }).pipe(Effect.provide(fixture.serviceLayer));
          expect(
            yield* fixture.fs.exists(fixture.path.join(fixture.shared.directory, "FB42")),
          ).toBe(true);
        }),
      ).pipe(Effect.provide(runtime)),
  );

  it.live("creates, uploads and deletes only inside an idle writable case checkout", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* prepare;
        const { fs, path, repository, activity } = fixture;
        yield* Effect.gen(function* () {
          const service = yield* CaseGit.FogBugzCaseGit;
          const config = yield* ServerConfig.ServerConfig.pipe(
            Effect.provide(ServerConfig.layerTest(fixture.root, fixture.root)),
          );
          const threadId = ThreadId.make("file-actions");
          const checkout = yield* service.ensure(threadId);
          const mutate = (action: Parameters<typeof service.mutateFiles>[0]["action"]) =>
            service.mutateFiles({ threadId, action });
          const reject = (action: Parameters<typeof mutate>[0], code: string) =>
            mutate(action).pipe(
              Effect.flip,
              Effect.map((error) => expect(error.code).toBe(code)),
            );
          yield* mutate({ type: "create-directory", path: "design" });
          yield* mutate({ type: "create-file", path: "design/PRP.md" });
          expect(yield* fs.readFileString(path.join(checkout.cwd, "design/PRP.md"))).toBe("");
          yield* reject({ type: "create-file", path: "design/PRP.md" }, "case_files_exists");
          for (const invalid of [
            "../escape.md",
            "/absolute",
            ".git/config",
            "design/../../escape",
            "design\\escape",
            "design/x:y",
            "design/.",
          ]) {
            yield* reject({ type: "create-file", path: invalid }, "case_files_path");
          }
          yield* fs.symlink(fixture.root, path.join(checkout.cwd, "outside"));
          yield* reject({ type: "create-file", path: "outside/escape.md" }, "case_files_path");
          yield* reject({ type: "delete", path: "outside" }, "case_files_path");
          yield* fs.makeDirectory(config.attachmentsDir, { recursive: true });
          const attachmentId = createPendingAttachmentId("bin");
          yield* fs.writeFileString(
            path.join(config.attachmentsDir, `${attachmentId}.bin`),
            "uploaded bytes",
          );
          const upload = {
            type: "upload" as const,
            files: [{ path: "design/prototype.html", attachmentId }],
          };
          repository.limits.fileBytes = 2;
          yield* reject(upload, "case_files_limit");
          repository.limits.fileBytes = 100;
          repository.limits.groupBytes = 2;
          yield* reject(upload, "case_files_limit");
          repository.limits.groupBytes = 100;
          repository.limits.repositoryBytes = 2;
          yield* reject(upload, "case_files_limit");
          repository.limits.repositoryBytes = 100;
          repository.limits.groupFiles = 0;
          yield* reject(upload, "case_files_limit");
          repository.limits.groupFiles = 100;
          yield* reject(
            {
              type: "upload",
              files: [
                { path: "design/not-created.html", attachmentId },
                { path: "design/PRP.md", attachmentId },
              ],
            },
            "case_files_exists",
          );
          expect(yield* fs.exists(path.join(checkout.cwd, "design/not-created.html"))).toBe(false);
          yield* mutate({
            type: "upload",
            files: [{ path: "design/empty.txt", attachmentId: null }],
          });
          expect(yield* fs.readFileString(path.join(checkout.cwd, "design/empty.txt"))).toBe("");
          yield* mutate(upload);
          expect(yield* fs.readFileString(path.join(checkout.cwd, "design/prototype.html"))).toBe(
            "uploaded bytes",
          );
          yield* reject(upload, "case_files_exists");
          repository.canWrite = false;
          yield* reject({ type: "delete", path: "design" }, "case_files_readonly");
          repository.canWrite = true;
          activity.runId = RunId.make("active");
          yield* reject({ type: "delete", path: "design" }, "case_files_busy");
          activity.runId = null;
          yield* mutate({ type: "delete", path: "design/PRP.md" });
          expect(yield* fs.exists(path.join(checkout.cwd, "design/PRP.md"))).toBe(false);
          yield* fs.writeFileString(path.join(fixture.root, "keep.txt"), "outside checkout");
          yield* fs.symlink(fixture.root, path.join(checkout.cwd, "design/link"));
          yield* mutate({ type: "delete", path: "design" });
          expect(yield* fs.exists(path.join(checkout.cwd, "design"))).toBe(false);
          expect(yield* fs.readFileString(path.join(fixture.root, "keep.txt"))).toBe(
            "outside checkout",
          );
          expect((yield* fixture.git(["ls-remote", fixture.remote])).stdout).toBe("");
        }).pipe(Effect.provide(fixture.serviceLayer));
      }),
    ).pipe(Effect.provide(runtime)),
  );
  it.live(
    "synchronizes committed artifacts without overwriting dirty files or merging conflicts",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fixture = yield* prepare;
          const { fs, path, git, repository, activity } = fixture;
          yield* Effect.gen(function* () {
            const service = yield* CaseGit.FogBugzCaseGit;
            const thread = ThreadId.make("fogbugz:auto:42:1");
            const run = RunId.make("run-1");
            const first = yield* service.ensure(thread);
            const commit = Effect.fn("fixture.commit")(function* (
              cwd: string,
              file: string,
              content: string,
            ) {
              yield* fs.writeFileString(path.join(cwd, file), content);
              expect((yield* git(["add", "--", file], cwd)).code).toBe(0);
              expect(
                (yield* git(
                  [
                    "-c",
                    "user.name=Fixture",
                    "-c",
                    "user.email=fixture@example.invalid",
                    "commit",
                    "-m",
                    "Artifact checkpoint",
                  ],
                  cwd,
                )).code,
              ).toBe(0);
            });
            yield* commit(first.cwd, "PRP.md", "# Initial\n");
            repository.canWrite = false;
            yield* service.finishTurn(thread, run);
            expect((yield* git(["ls-remote", fixture.remote])).stdout).toBe("");
            repository.canWrite = true;
            const unrelated = path.join(fixture.root, "unrelated.git");
            yield* git(["init", "--bare", unrelated]);
            yield* git(["config", "remote.origin.pushurl", unrelated], first.cwd);
            yield* service.finishTurn(thread, run);
            expect((yield* git(["ls-remote", unrelated])).stdout).toBe("");
            expect((yield* git(["rev-parse", "main"], fixture.remote)).stdout).toBe(
              (yield* git(["rev-parse", "HEAD"], first.cwd)).stdout,
            );
            const second = yield* service.ensure(ThreadId.make("other-thread"));
            yield* commit(second.cwd, "INITIAL.md", "# Remote\n");
            expect((yield* git(["push", "origin", "main"], second.cwd)).code).toBe(0);
            activity.runId = run;
            expect((yield* service.ensure(thread)).syncIssue).toContain("agent is running");
            expect(yield* fs.exists(path.join(first.cwd, "INITIAL.md"))).toBe(false);
            repository.limits.fileBytes = 1024;
            const context = yield* service.prepareTurn(thread, run);
            expect(context?.text).toContain(first.cwd);
            expect(context?.text).toContain("Maximum file size: 1024 bytes");
            expect(context?.text).toContain("Redirect every instruction to write in docs/prp/");
            expect(
              withCaseGitRoot(
                { runtimeMode: "approval-required", interactionMode: "default", cwd: "/project" },
                first.cwd,
              ).sandboxPolicy,
            ).toBeUndefined();
            expect(
              withCaseGitRoot(
                {
                  runtimeMode: "auto",
                  interactionMode: "default",
                  cwd: "/project",
                  sandboxPolicy: { type: "readOnly" },
                },
                first.cwd,
              ).sandboxPolicy,
            ).toEqual({ type: "readOnly" });
            expect(
              withCaseGitRoot(
                {
                  runtimeMode: "auto",
                  interactionMode: "default",
                  cwd: "/project",
                  sandboxPolicy: {
                    type: "workspaceWrite",
                    writableRoots: ["/existing"],
                    networkAccess: false,
                  },
                },
                first.cwd,
              ).sandboxPolicy,
            ).toEqual({
              type: "workspaceWrite",
              writableRoots: ["/existing", first.cwd],
              networkAccess: false,
            });
            expect(yield* fs.readFileString(path.join(first.cwd, "INITIAL.md"))).toBe("# Remote\n");
            activity.runId = null;
            yield* commit(first.cwd, "local.md", "Local\n");
            yield* commit(second.cwd, "remote.md", "Remote\n");
            yield* git(["push", "origin", "main"], second.cwd);
            expect((yield* service.ensure(thread)).syncIssue).toBeUndefined();
            expect(
              (yield* git(["rev-list", "--parents", "-n", "1", "HEAD"], first.cwd)).stdout
                .trim()
                .split(" "),
            ).toHaveLength(3);
            yield* service.finishTurn(thread, run);
            yield* service.ensure(ThreadId.make("other-thread"));
            yield* fs.writeFileString(path.join(first.cwd, "PRP.md"), "Uncommitted\n");
            yield* commit(second.cwd, "PRP.md", "Remote edit\n");
            yield* git(["push", "origin", "main"], second.cwd);
            expect((yield* service.ensure(thread)).syncIssue).toContain(
              "uncommitted local changes",
            );
            expect(yield* fs.readFileString(path.join(first.cwd, "PRP.md"))).toBe("Uncommitted\n");
            yield* commit(first.cwd, "PRP.md", "Conflicting local edit\n");
            const before = (yield* git(["rev-parse", "HEAD"], first.cwd)).stdout;
            expect((yield* service.ensure(thread)).syncIssue).toContain("commits conflict");
            expect((yield* git(["rev-parse", "HEAD"], first.cwd)).stdout).toBe(before);
            expect((yield* git(["status", "--porcelain"], first.cwd)).stdout).toBe("");
            expect(yield* fs.exists(path.join(first.cwd, ".git/MERGE_HEAD"))).toBe(false);
            yield* service.finishTurn(thread, run);
            expect((yield* service.prepareTurn(thread, run))?.text).toContain(
              "Ask the user whether to merge",
            );
            expect((yield* git(["rev-parse", "main"], fixture.remote)).stdout).not.toBe(before);
          }).pipe(Effect.provide(fixture.serviceLayer));
        }),
      ).pipe(Effect.provide(runtime)),
  );

  it.live(
    "clones empty repositories once per thread, preserves local work and reopens existing files",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fixture = yield* prepare;
          const { fs, path, git, root, repository } = fixture;
          yield* Effect.gen(function* () {
            const service = yield* CaseGit.FogBugzCaseGit;
            const threadId = ThreadId.make("first-thread");
            const previousGitDirectory = process.env.GIT_DIR;
            process.env.GIT_DIR = path.join(root, "unrelated.git");
            const [first, repeated] = yield* Effect.all(
              [service.ensure(threadId), service.ensure(threadId)],
              { concurrency: "unbounded" },
            ).pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  if (previousGitDirectory === undefined) delete process.env.GIT_DIR;
                  else process.env.GIT_DIR = previousGitDirectory;
                }),
              ),
            );
            expect(first).toEqual(repeated);
            expect(first.cwd).toBe(
              path.join(root, "case-files/connection-fixture/7/42/first-thread/repo"),
            );
            const config = yield* fs.readFileString(path.join(first.cwd, ".git/config"));
            expect(config).not.toContain(repository.token);
            expect((yield* git(["rev-list", "--all"], first.cwd)).stdout).toBe("");
            yield* fs.writeFileString(path.join(first.cwd, "PRP.md"), "# Local draft\n");
            expect((yield* service.ensure(threadId)).cwd).toBe(first.cwd);
            expect(yield* fs.readFileString(path.join(first.cwd, "PRP.md"))).toBe(
              "# Local draft\n",
            );
            yield* git(["add", "PRP.md"], first.cwd);
            yield* git(
              [
                "-c",
                "user.name=Fixture",
                "-c",
                "user.email=fixture@example.invalid",
                "commit",
                "-m",
                "Existing file",
              ],
              first.cwd,
            );
            yield* git(["push", "origin", "main"], first.cwd);
            const second = yield* service.ensure(ThreadId.make("second-thread"));
            expect(second.cwd).not.toBe(first.cwd);
            expect(yield* fs.readFileString(path.join(second.cwd, "PRP.md"))).toBe(
              "# Local draft\n",
            );
            yield* fs.writeFileString(path.join(first.cwd, "PRP.md"), "Uncommitted changes");
            expect(yield* fs.readFileString(path.join(second.cwd, "PRP.md"))).toBe(
              "# Local draft\n",
            );
          }).pipe(Effect.provide(fixture.serviceLayer));
        }),
      ).pipe(Effect.provide(runtime)),
  );

  it.live(
    "rejects changed repository identities and existing directories without overwriting them",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fixture = yield* prepare;
          yield* Effect.gen(function* () {
            const service = yield* CaseGit.FogBugzCaseGit;
            const first = yield* service.ensure(ThreadId.make("thread"));
            yield* fixture.fs.writeFileString(fixture.path.join(first.cwd, "draft.txt"), "Keep me");
            fixture.repository.repositoryId = "b92a60a0-28ec-4a2d-808a-48b640470961";
            expect(yield* service.ensure(ThreadId.make("thread")).pipe(Effect.flip)).toMatchObject({
              code: "case_git",
            });
            expect(
              yield* fixture.fs.readFileString(fixture.path.join(first.cwd, "draft.txt")),
            ).toBe("Keep me");
            expect(
              caseGitPath(fixture.path, fixture.root, "../outside", 7, 42, "thread"),
            ).toBeNull();
            expect(caseGitPath(fixture.path, fixture.root, "connection", 7, 42, "..")).toBeNull();
          }).pipe(Effect.provide(fixture.serviceLayer));
        }),
      ).pipe(Effect.provide(runtime)),
  );

  it.live("reports missing access and clone failures without publishing a partial checkout", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* prepare;
        const denied = CaseGit.layer.pipe(
          Layer.provide(Layer.mock(ProjectStoreV2)({})),
          Layer.provide(ServerSettings.ServerSettingsService.layerTest()),
          Layer.provide(
            Layer.mock(ProjectionStoreV2)({ getThreadShell: () => Effect.succeed(null) }),
          ),
          Layer.provide(
            Layer.mock(FogBugzService)({
              caseGitRepository: () => Effect.fail(new FogBugzError({ code: "access" })),
            }),
          ),
          Layer.provide(ServerConfig.layerTest(fixture.root, fixture.root)),
        );
        expect(
          yield* Effect.flatMap(CaseGit.FogBugzCaseGit, (service) =>
            service.ensure(ThreadId.make("denied")),
          ).pipe(Effect.flip, Effect.provide(denied)),
        ).toMatchObject({ code: "access" });
        fixture.repository.remoteUrl = NodeURL.pathToFileURL(
          fixture.path.join(fixture.root, "missing.git"),
        ).href;
        yield* Effect.gen(function* () {
          const service = yield* CaseGit.FogBugzCaseGit;
          expect(yield* service.ensure(ThreadId.make("failed")).pipe(Effect.flip)).toMatchObject({
            code: "case_git",
          });
          const cwd = caseGitPath(
            fixture.path,
            fixture.root,
            "connection-fixture",
            7,
            42,
            "failed",
          )!;
          expect(yield* fixture.fs.exists(cwd)).toBe(false);
          expect(yield* fixture.fs.readDirectory(fixture.path.dirname(cwd))).toEqual([]);
        }).pipe(Effect.provide(fixture.serviceLayer));
      }),
    ).pipe(Effect.provide(runtime)),
  );
});
