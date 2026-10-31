import {
  FogBugzError,
  type FogBugzCaseGitCheckout,
  type ThreadId,
  type RunId,
  type FogBugzCaseFilesInput,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { ProjectStoreV2 } from "../orchestration-v2/ProjectStore.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { ServerConfig } from "../config.ts";
import { ProcessRunner } from "../processRunner.ts";
import { withWorkspaceLease } from "../workspace/workspaceLease.ts";
import { FogBugzService } from "./FogBugzService.ts";
import { caseGitPath, caseGitMetadataPath } from "./caseGitPath.ts";
import { caseGitInstructions } from "./caseGitInstructions.ts";
import { ProjectionStoreV2 } from "../orchestration-v2/ProjectionStore.ts";
import { mutateCaseFiles } from "./caseFileMutation.ts";

const isFogBugzError = Schema.is(FogBugzError);

export class FogBugzCaseGit extends Context.Service<
  FogBugzCaseGit,
  {
    ensure: (threadId: ThreadId) => Effect.Effect<typeof FogBugzCaseGitCheckout.Type, FogBugzError>;
    prepareTurn: (
      threadId: ThreadId,
      runId: RunId,
    ) => Effect.Effect<{ text: string; cwd: string; canWrite: boolean } | null, FogBugzError>;
    finishTurn: (threadId: ThreadId, runId: RunId) => Effect.Effect<void, FogBugzError>;
    mutateFiles: (input: typeof FogBugzCaseFilesInput.Type) => Effect.Effect<void, FogBugzError>;
  }
>()("t3/fogbugz/FogBugzCaseGit") {}

export const layer = Layer.effect(
  FogBugzCaseGit,
  Effect.gen(function* () {
    const fogbugz = yield* FogBugzService;
    const config = yield* ServerConfig;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const processes = yield* ProcessRunner;
    const inherited = yield* HostProcess.Environment;
    const projections = yield* ProjectionStoreV2;
    const projects = yield* ProjectStoreV2;
    const settings = yield* ServerSettingsService;
    const locations = new Map<RunId, { cwd: string; shared: boolean }>();
    const location = Effect.fn("FogBugzCaseGit.location")(
      function* (
        threadId: ThreadId,
        repository: { connectionId: string; personId: number; caseId: number },
        runId?: RunId,
      ) {
        const pinned = runId ? locations.get(runId) : undefined;
        if (pinned) return pinned;
        const linked = yield* fogbugz.thread(threadId);
        if (!linked) return yield* new FogBugzError({ code: "thread" });
        const project = yield* projects.getShell(linked.projectId);
        if (Option.isNone(project)) return yield* new FogBugzError({ code: "project" });
        const directory = resolveProjectSettings(yield* settings.getSettings, linked.projectId)
          .settings.fogbugzCaseGitDirectory;
        const cwd = caseGitPath(
          path,
          yield* fs.realPath(config.baseDir),
          repository.connectionId,
          repository.personId,
          repository.caseId,
          threadId,
          { workspaceRoot: project.value.workspaceRoot, directory },
        );
        if (!cwd) return yield* new FogBugzError({ code: "case_git" });
        return { cwd, shared: directory !== "" };
      },
      Effect.mapError((error) =>
        isFogBugzError(error) ? error : new FogBugzError({ code: "case_git" }),
      ),
    );
    const isBusy = Effect.fn("FogBugzCaseGit.isBusy")(function* (
      threadId: ThreadId,
      repository: { connectionId: string; personId: number; caseId: number },
      target: { cwd: string; shared: boolean },
      runId?: RunId,
    ) {
      const current = yield* projections.getThreadShell(threadId);
      if (current?.activeRunId != null && current.activeRunId !== runId) return true;
      if (!target.shared) return false;
      for (const [ownerRunId, owned] of locations) {
        if (ownerRunId !== runId && owned.cwd === target.cwd) return true;
      }
      const threadIds = yield* fogbugz.caseThreadIds(repository.caseId);
      if (threadIds.length === 0) return false;
      const snapshot = yield* projections.getShellSnapshot({ threadIds });
      for (const thread of snapshot.threads) {
        if (!thread.activeRunId || thread.activeRunId === runId || thread.id === threadId) continue;
        const linked = yield* fogbugz.thread(thread.id);
        if (!linked) continue;
        const other = yield* location(
          thread.id,
          { ...repository, caseId: linked.caseId },
          thread.activeRunId,
        );
        if (other.cwd === target.cwd) return true;
      }
      return false;
    });
    const ignoreSvnDirectory = Effect.fn("FogBugzCaseGit.ignoreSvnDirectory")(function* (
      cwd: string,
    ) {
      let ancestor = path.dirname(cwd);
      while (!(yield* fs.exists(path.join(ancestor, ".svn")))) {
        const parent = path.dirname(ancestor);
        if (parent === ancestor) return;
        ancestor = parent;
      }
      const svn = Effect.fn("FogBugzCaseGit.svn")(function* (args: ReadonlyArray<string>) {
        const result = yield* processes.run({
          command: "svn",
          args: ["--non-interactive", ...args],
          cwd: ancestor,
        });
        if (result.code !== 0) return yield* new FogBugzError({ code: "case_git_svn" });
        return result.stdout;
      });
      return yield* withWorkspaceLease(
        `svn:${ancestor}`,
        Effect.gen(function* () {
          // Ignore the first unversioned directory; svn:ignore applies to immediate children only.
          let versioned = ancestor;
          const segments = path.relative(ancestor, cwd).split(path.sep);
          for (const segment of segments) {
            const candidate = path.join(versioned, segment);
            const info = yield* processes.run({
              command: "svn",
              args: ["info", "--non-interactive", "--", `${candidate}@`],
              cwd: ancestor,
            });
            if (info.code !== 0) {
              const properties = yield* svn(["proplist", "--", `${versioned}@`]);
              const existing = properties
                .split(/\r?\n/)
                .some((line) => line.trim() === "svn:ignore")
                ? yield* svn(["propget", "--strict", "svn:ignore", "--", `${versioned}@`])
                : "";
              if (!existing.split(/\r?\n/).includes(segment))
                yield* svn([
                  "propset",
                  "svn:ignore",
                  `${existing}${existing && !existing.endsWith("\n") ? "\n" : ""}${segment}\n`,
                  "--",
                  `${versioned}@`,
                ]);
              return;
            }
            versioned = candidate;
          }
          return yield* new FogBugzError({ code: "case_git_svn" });
        }),
      );
    });
    const synchronize = Effect.fn("FogBugzCaseGit.synchronize")(function* (
      threadId: ThreadId,
      runId?: RunId,
      push = false,
    ) {
      const repository = yield* fogbugz.caseGitRepository(threadId);
      const target = yield* location(threadId, repository, runId);
      return yield* withWorkspaceLease(
        `fogbugz:${target.cwd}`,
        Effect.gen(function* () {
          const busy = yield* isBusy(threadId, repository, target, runId);
          if (busy && runId && !push) return yield* new FogBugzError({ code: "case_files_busy" });
          const baseDir = yield* fs.realPath(config.baseDir);
          const cwd = target.cwd;
          const parent = caseGitMetadataPath(path, baseDir, cwd, target.shared);
          for (const folder of new Set([parent, path.dirname(cwd)])) {
            let directory = path.parse(folder).root;
            for (const segment of path.relative(directory, folder).split(path.sep)) {
              directory = path.join(directory, segment);
              if (!(yield* fs.exists(directory))) yield* fs.makeDirectory(directory);
              if ((yield* fs.realPath(directory)) !== directory)
                return yield* new FogBugzError({ code: "case_git" });
            }
          }
          if (target.shared && !busy) yield* ignoreSvnDirectory(cwd);
          // Only this process receives the token. Git never persists it in the remote or its config.
          const env = Object.fromEntries(
            Object.entries(inherited).map(([key, value]) => [
              key,
              key.toUpperCase().startsWith("GIT_") ? undefined : value,
            ]),
          );
          Object.assign(env, {
            GIT_TERMINAL_PROMPT: "0",
            GIT_ASKPASS: "",
            GIT_CONFIG_NOSYSTEM: "1",
            GIT_CONFIG_GLOBAL: path.join(parent, "no-global-config"),
            GIT_CONFIG_COUNT: "4",
            GIT_CONFIG_KEY_0: "credential.helper",
            GIT_CONFIG_VALUE_0: "",
            GIT_CONFIG_KEY_1: "http.followRedirects",
            GIT_CONFIG_VALUE_1: "false",
            GIT_CONFIG_KEY_2: `http.${repository.remoteUrl}.extraHeader`,
            GIT_CONFIG_VALUE_2: `Authorization: Bearer ${repository.token}`,
            GIT_CONFIG_KEY_3: "core.hooksPath",
            GIT_CONFIG_VALUE_3: path.join(parent, "no-hooks"),
          });
          const runGit = Effect.fn("FogBugzCaseGit.runGit")(function* (
            args: ReadonlyArray<string>,
            workingDirectory: string,
          ) {
            const result = yield* processes.run({
              command: "git",
              args,
              cwd: workingDirectory,
              env,
              timeout: "90 seconds",
              maxOutputBytes: 128_000,
            });
            return { code: result.code, output: result.stdout.trim() };
          });
          const git = Effect.fn("FogBugzCaseGit.git")(function* (
            args: ReadonlyArray<string>,
            workingDirectory = cwd,
          ) {
            const result = yield* runGit(args, workingDirectory);
            if (result.code !== 0) return yield* new FogBugzError({ code: "case_git" });
            return result.output;
          });
          const identityPath = path.join(parent, "repository-id");
          const identity = target.shared
            ? `${repository.connectionId}:${repository.personId}:${repository.repositoryId}`
            : repository.repositoryId;
          if (yield* fs.exists(cwd)) {
            if (
              (yield* fs.realPath(cwd)) !== cwd ||
              !(yield* fs.exists(identityPath)) ||
              (yield* fs.readFileString(identityPath)) !== identity
            )
              return yield* new FogBugzError({ code: "case_git" });
            if (
              (yield* git(["rev-parse", "--show-toplevel"], cwd)) !== cwd ||
              (yield* fs.realPath(path.join(cwd, ".git"))) !== path.join(cwd, ".git")
            )
              return yield* new FogBugzError({ code: "case_git" });
            if (!busy) yield* git(["remote", "set-url", "origin", repository.remoteUrl]);
          } else {
            if (busy) return yield* new FogBugzError({ code: "case_git" });
            const staging = yield* fs.makeTempDirectory({
              directory: path.dirname(cwd),
              prefix: ".t3-case-clone-",
            });
            const checkout = path.join(staging, "repo");
            yield* git(["clone", "--quiet", "--", repository.remoteUrl, checkout], parent).pipe(
              Effect.onError(() => fs.remove(staging, { recursive: true }).pipe(Effect.ignore)),
            );
            yield* fs.writeFileString(identityPath, identity);
            yield* fs.rename(checkout, cwd);
            yield* fs.remove(staging, { recursive: true });
          }
          const checkout = {
            caseId: repository.caseId,
            repositoryId: repository.repositoryId,
            cwd,
            canWrite: repository.canWrite,
          };
          if (runId && !push && !busy) locations.set(runId, target);
          if (busy)
            return {
              checkout: {
                ...checkout,
                canWrite: false,
                syncIssue: "The agent is running; synchronization is deferred until its turn ends.",
              },
              limits: repository.limits,
            };
          const issue = Effect.fn("FogBugzCaseGit.update")(function* () {
            if (
              (yield* git(["ls-remote", "--get-url", repository.remoteUrl])) !==
              repository.remoteUrl
            )
              return "Git URL rewriting changes the case repository destination. Synchronization has been stopped.";
            if ((yield* git(["symbolic-ref", "--quiet", "HEAD"])) !== "refs/heads/main")
              return "The case checkout must be on main before it can synchronize.";
            const remote = yield* git(["ls-remote", repository.remoteUrl, "refs/heads/main"]);
            const local = yield* runGit(["rev-parse", "--verify", "HEAD"], cwd);
            const dirty = (yield* git(["status", "--porcelain", "--untracked-files=all"])) !== "";
            if (remote !== "") {
              yield* git([
                "fetch",
                "--no-tags",
                "--no-recurse-submodules",
                repository.remoteUrl,
                "refs/heads/main:refs/remotes/origin/main",
              ]);
              const remoteHead = yield* git(["rev-parse", "refs/remotes/origin/main"]);
              if (local.output !== remoteHead) {
                const ahead =
                  local.code === 0 &&
                  (yield* runGit(
                    ["merge-base", "--is-ancestor", "refs/remotes/origin/main", "HEAD"],
                    cwd,
                  )).code === 0;
                if (!ahead) {
                  if (dirty)
                    return "Remote changes are available, but uncommitted local changes prevent an automatic update.";
                  const fastForward =
                    local.code !== 0 ||
                    (yield* runGit(
                      ["merge-base", "--is-ancestor", "HEAD", "refs/remotes/origin/main"],
                      cwd,
                    )).code === 0;
                  if (fastForward) {
                    yield* git(["merge", "--ff-only", "refs/remotes/origin/main"]);
                  } else {
                    const preview = yield* runGit(
                      ["merge-tree", "--write-tree", "HEAD", "refs/remotes/origin/main"],
                      cwd,
                    );
                    if (preview.code === 1)
                      return "Local and remote commits conflict. The working tree has been preserved.";
                    if (preview.code !== 0) return yield* new FogBugzError({ code: "case_git" });
                    yield* git([
                      "-c",
                      "user.name=T3 Code",
                      "-c",
                      "user.email=t3-code@localhost",
                      "merge",
                      "--no-edit",
                      "--no-ff",
                      "refs/remotes/origin/main",
                    ]);
                  }
                }
              }
            }
            if (push && repository.canWrite) {
              if (dirty)
                return "Uncommitted case artifacts have not been uploaded. Create a local checkpoint commit first.";
              if (local.code !== 0) return undefined;
              const current = yield* projections.getThreadShell(threadId);
              if (current?.activeRunId != null && current.activeRunId !== runId)
                return "A newer turn is running; upload has been deferred.";
              // An explicit URL and refspec prevent repository config from redirecting the case push.
              yield* git([
                "-c",
                "push.followTags=false",
                "push",
                "--porcelain",
                repository.remoteUrl,
                "refs/heads/main:refs/heads/main",
              ]);
            }
            return undefined;
          });
          const currentIssue = yield* issue().pipe(
            Effect.orElseSucceed(
              () =>
                "Case Git synchronization failed. Check the connection, permissions and repository limits; local files and commits are retained.",
            ),
          );
          const issuePath = path.join(parent, "sync-issue");
          if (push) yield* fs.writeFileString(issuePath, currentIssue ?? "");
          const previousIssue = yield* fs
            .exists(issuePath)
            .pipe(
              Effect.flatMap((exists) =>
                exists ? fs.readFileString(issuePath) : Effect.succeed(""),
              ),
            );
          const syncIssue = currentIssue || previousIssue || undefined;
          return {
            checkout: { ...checkout, ...(syncIssue ? { syncIssue } : {}) },
            limits: repository.limits,
          };
        }),
      ).pipe(
        Effect.mapError((error) =>
          isFogBugzError(error) ? error : new FogBugzError({ code: "case_git" }),
        ),
      );
    });
    return FogBugzCaseGit.of({
      mutateFiles: Effect.fn("FogBugzCaseGit.mutateFiles")(function* (input) {
        const { checkout } = yield* synchronize(input.threadId);
        yield* withWorkspaceLease(
          `fogbugz:${checkout.cwd}`,
          Effect.gen(function* () {
            const repository = yield* fogbugz.caseGitRepository(input.threadId);
            if (!repository.canWrite)
              return yield* new FogBugzError({ code: "case_files_readonly" });
            const target = yield* location(input.threadId, repository);
            if (yield* isBusy(input.threadId, repository, target))
              return yield* new FogBugzError({ code: "case_files_busy" });
            if (repository.repositoryId !== checkout.repositoryId || target.cwd !== checkout.cwd)
              return yield* new FogBugzError({ code: "case_files_path" });
            yield* mutateCaseFiles(
              checkout.cwd,
              config.attachmentsDir,
              repository.limits,
              input.action,
            );
          }),
        ).pipe(
          Effect.mapError((error) =>
            isFogBugzError(error) ? error : new FogBugzError({ code: "case_files_io" }),
          ),
        );
      }),
      ensure: Effect.fn("FogBugzCaseGit.ensure")((threadId: ThreadId) =>
        synchronize(threadId).pipe(Effect.map((result) => result.checkout)),
      ),
      prepareTurn: Effect.fn("FogBugzCaseGit.prepareTurn")(function* (threadId, runId) {
        if (!(yield* fogbugz.thread(threadId))) return null;
        const { checkout, limits } = yield* synchronize(threadId, runId);
        return {
          text: caseGitInstructions(checkout, limits),
          cwd: checkout.cwd,
          canWrite: checkout.canWrite,
        };
      }),
      finishTurn: Effect.fn("FogBugzCaseGit.finishTurn")(function* (threadId, runId) {
        if (!(yield* fogbugz.thread(threadId))) {
          locations.delete(runId);
          return;
        }
        const { checkout } = yield* synchronize(threadId, runId, true).pipe(
          Effect.ensuring(Effect.sync(() => locations.delete(runId))),
        );
        if (checkout.syncIssue) yield* Effect.logWarning(checkout.syncIssue, { threadId });
      }),
    });
  }),
);
