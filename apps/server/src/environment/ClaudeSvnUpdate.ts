import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schedule from "effect/Schedule";
import * as ProcessRunner from "../processRunner.ts";
import { ServerSettingsService } from "../serverSettings.ts";

const checkoutPath = Effect.gen(function* () {
  const path = yield* Path.Path;
  return path.join(yield* HostProcess.HomeDirectory, ".claude");
});

export const checkoutProbe = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  return fs.stat(path.join(yield* checkoutPath, ".svn")).pipe(
    Effect.map((entry) => entry.type === "Directory"),
    Effect.orElseSucceed(() => false),
  );
});

export const update = Effect.fn("ClaudeSvnUpdate.update")(function* () {
  const settings = yield* ServerSettingsService;
  if (!(yield* settings.getSettings).mggmAutoSvnUpdate) return;
  const probe = yield* checkoutProbe;
  if (!(yield* probe)) return;
  const cwd = yield* checkoutPath;
  const runner = yield* ProcessRunner.ProcessRunner;
  const args = ["update", "--non-interactive", "."];
  // The Linux post-login hook locks this same directory during workplace maintenance.
  const linux = (yield* HostProcess.Platform) === "linux";
  const result = yield* runner.run({
    command: linux ? "flock" : "svn",
    args: linux ? ["--timeout", "300", ".", "svn", ...args] : args,
    cwd,
    timeout: "15 minutes",
    outputMode: "truncate",
    maxOutputBytes: 1024,
  });
  if (result.code !== 0)
    return yield* Effect.logError("Scheduled SVN update of ~/.claude failed", {
      exitCode: result.code,
    });
  yield* Effect.logInfo("Scheduled SVN update of ~/.claude succeeded");
});

export const schedule = Schedule.cron("0 6,13 * * *");
export const layer = Layer.effectDiscard(
  update().pipe(Effect.catchCause(Effect.logError), Effect.schedule(schedule), Effect.forkScoped),
);
