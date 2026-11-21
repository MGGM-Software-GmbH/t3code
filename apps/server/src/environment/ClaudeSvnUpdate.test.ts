import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as TestClock from "effect/testing/TestClock";
import { ProcessRunner, type ProcessRunInput } from "../processRunner.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ClaudeSvnUpdate from "./ClaudeSvnUpdate.ts";

const beforeMorningUpdate = Date.parse("2026-11-18T05:59:00");

it.layer(NodeServices.layer)("Claude SVN update", (it) => {
  it.effect("schedules the first and subsequent updates at 06:00 and 13:00 local time", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(beforeMorningUpdate);
      let calls = 0;
      yield* Effect.sync(() => ++calls).pipe(
        Effect.schedule(ClaudeSvnUpdate.schedule),
        Effect.forkScoped,
      );
      yield* TestClock.adjust("59 seconds");
      expect(calls).toBe(0);
      yield* TestClock.adjust("1 second");
      expect(calls).toBe(1);
      yield* TestClock.adjust("7 hours");
      expect(calls).toBe(2);
      yield* TestClock.adjust("17 hours");
      expect(calls).toBe(3);
    }),
  );
  it.effect("checks the checkout and the current switch again before every update", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const home = yield* fs.makeTempDirectoryScoped();
      const directory = home + "/.claude";
      const calls: ProcessRunInput[] = [];
      const runner = ProcessRunner.of({
        run: (input) =>
          Effect.sync(() => {
            calls.push(input);
            return {
              code: ChildProcessSpawner.ExitCode(0),
              timedOut: false,
              stdout: "",
              stderr: "",
              stdoutInvalidUtf8: false,
              stderrInvalidUtf8: false,
              stdoutTruncated: false,
              stderrTruncated: false,
            };
          }),
      });
      yield* fs.makeDirectory(directory);
      yield* Effect.gen(function* () {
        yield* ClaudeSvnUpdate.update();
        expect(calls).toHaveLength(0);
        yield* fs.writeFileString(directory + "/.svn", "");
        yield* ClaudeSvnUpdate.update();
        expect(calls).toHaveLength(0);
        yield* fs.remove(directory + "/.svn");
        yield* fs.makeDirectory(directory + "/.svn");
        yield* ClaudeSvnUpdate.update();
        expect(calls).toHaveLength(1);
        expect(calls[0]?.cwd).toBe(directory);
        expect(calls[0]?.args.slice(-3)).toEqual(["update", "--non-interactive", "."]);
        const settings = yield* ServerSettings.ServerSettingsService;
        yield* settings.updateSettings({ mggmAutoSvnUpdate: false });
        yield* ClaudeSvnUpdate.update();
        expect(calls).toHaveLength(1);
        yield* settings.updateSettings({ mggmAutoSvnUpdate: true });
        yield* ClaudeSvnUpdate.update();
        expect(calls).toHaveLength(2);
      }).pipe(
        Effect.provide(ServerSettings.layerTest()),
        Effect.provideService(ProcessRunner, runner),
        Effect.provideService(HostProcess.HomeDirectory, home),
      );
    }),
  );
});
