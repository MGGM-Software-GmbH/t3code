import { FogBugzError, type FogBugzCaseGitCheckout, type ThreadId } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { ServerConfig } from "../config.ts";
import { ProcessRunner } from "../processRunner.ts";
import { withWorkspaceLease } from "../workspace/workspaceLease.ts";
import { FogBugzService } from "./FogBugzService.ts";
import { caseGitPath } from "./caseGitPath.ts";

const isFogBugzError = Schema.is(FogBugzError);

export class FogBugzCaseGit extends Context.Service<
  FogBugzCaseGit,
  {
    ensure: (threadId: ThreadId) => Effect.Effect<typeof FogBugzCaseGitCheckout.Type, FogBugzError>;
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
    return FogBugzCaseGit.of({
      ensure: Effect.fn("FogBugzCaseGit.ensure")(function* (threadId) {
        return yield* withWorkspaceLease(
          `fogbugz:${threadId}`,
          Effect.gen(function* () {
            const repository = yield* fogbugz.caseGitRepository(threadId);
            const baseDir = yield* fs.realPath(config.baseDir);
            const cwd = caseGitPath(
              path,
              baseDir,
              repository.connectionId,
              repository.personId,
              repository.caseId,
              threadId,
            );
            if (!cwd) return yield* new FogBugzError({ code: "case_git" });
            const parent = path.dirname(cwd);
            let directory = baseDir;
            for (const segment of path.relative(baseDir, parent).split(path.sep)) {
              directory = path.join(directory, segment);
              if (!(yield* fs.exists(directory)))
                yield* fs.makeDirectory(directory, { recursive: true });
              if ((yield* fs.realPath(directory)) !== directory)
                return yield* new FogBugzError({ code: "case_git" });
            }
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
            const git = Effect.fn("FogBugzCaseGit.git")(function* (
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
              if (result.code !== 0) return yield* new FogBugzError({ code: "case_git" });
              return result.stdout.trim();
            });
            const identityPath = path.join(parent, "repository-id");
            if (yield* fs.exists(cwd)) {
              if (
                (yield* fs.realPath(cwd)) !== cwd ||
                !(yield* fs.exists(identityPath)) ||
                (yield* fs.readFileString(identityPath)) !== repository.repositoryId
              )
                return yield* new FogBugzError({ code: "case_git" });
              if (
                (yield* git(["rev-parse", "--show-toplevel"], cwd)) !== cwd ||
                (yield* fs.realPath(path.join(cwd, ".git"))) !== path.join(cwd, ".git")
              )
                return yield* new FogBugzError({ code: "case_git" });
              // Validate access without fetching or overwriting uncommitted work in an existing checkout.
              yield* git(["ls-remote", repository.remoteUrl], cwd);
              yield* git(["remote", "set-url", "origin", repository.remoteUrl], cwd);
            } else {
              const staging = yield* fs.makeTempDirectory({ directory: parent, prefix: "clone-" });
              const checkout = path.join(staging, "repo");
              yield* git(["clone", "--quiet", "--", repository.remoteUrl, checkout], parent).pipe(
                Effect.onError(() => fs.remove(staging, { recursive: true }).pipe(Effect.ignore)),
              );
              yield* fs.writeFileString(identityPath, repository.repositoryId);
              yield* fs.rename(checkout, cwd);
              yield* fs.remove(staging, { recursive: true });
            }
            return {
              caseId: repository.caseId,
              repositoryId: repository.repositoryId,
              cwd,
              canWrite: repository.canWrite,
            };
          }),
        ).pipe(
          Effect.mapError((error) =>
            isFogBugzError(error) ? error : new FogBugzError({ code: "case_git" }),
          ),
        );
      }),
    });
  }),
);
