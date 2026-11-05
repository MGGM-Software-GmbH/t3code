import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as TestConsole from "effect/testing/TestConsole";
import { Command } from "effect/cli";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as PreviewBrowserHost from "../preview/PreviewBrowserHost.ts";
import { browserCommand } from "./browser.ts";

const BROWSER = "/t3/tools/chrome-headless-shell/linux64/154/chrome-headless-shell";
const FONT = "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf";

/**
 * Records every command. `fc-match` is missing until fonts are installed, unless
 * the host starts with a font; the browser fails to load libnss3 when asked to.
 */
const fakeSpawner = (host: { readonly font?: string; readonly missingLibrary?: boolean }) => {
  const commands: Array<ReadonlyArray<string>> = [];
  let font = host.font;
  const spawner = ChildProcessSpawner.make((command) =>
    Effect.gen(function* () {
      if (!ChildProcess.isStandardCommand(command)) return yield* Effect.die("Unexpected pipeline");
      commands.push([command.command, ...command.args]);
      if (command.command === "apt-get" && command.args.includes("fonts-liberation")) font = FONT;
      if (command.command === "fc-match" && font === undefined) {
        return yield* PlatformError.systemError({
          _tag: "NotFound",
          module: "ChildProcess",
          method: "spawn",
        });
      }
      const output =
        command.command === "fc-match"
          ? font!
          : command.command === BROWSER && host.missingLibrary
            ? "error while loading shared libraries: libnss3.so: cannot open shared object file"
            : command.command === "ldd"
              ? "\tlibnss3.so => not found\n"
              : "";
      const bytes = Stream.make(new TextEncoder().encode(output));
      return ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(1),
        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        unref: Effect.succeed(Effect.void),
        stdin: Sink.drain,
        stdout: bytes,
        stderr: Stream.empty,
        all: bytes,
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
      });
    }),
  );
  return { spawner, commands };
};

/** A Linux host with apt and T3's browser installed under `/t3`. */
const runSetup = (host: {
  readonly root: boolean;
  readonly font?: string;
  readonly missingLibrary?: boolean;
}) => {
  const { spawner, commands } = fakeSpawner(host);
  const fs = FileSystem.makeNoop({
    exists: (path) => Effect.succeed(path === "/usr/bin/apt-get" || path === BROWSER),
    readDirectory: (path) =>
      Effect.succeed(path.endsWith("chrome-headless-shell") ? ["linux64"] : ["154"]),
  });
  return Effect.gen(function* () {
    const result = yield* Command.runWith(browserCommand, { version: "0.0.0" })([
      "setup",
      "--base-dir",
      "/t3",
    ]).pipe(Effect.result);
    return { result, commands, output: (yield* TestConsole.logLines).join("\n") };
  }).pipe(
    Effect.provideService(FileSystem.FileSystem, fs),
    Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
    Effect.provideService(HostProcess.Platform, "linux"),
    Effect.provideService(HostProcess.UserId, host.root ? 0 : 1000),
    // Root through sudo from a regular user, so setup reports ready instead of the root warning.
    Effect.provideService(HostProcess.Environment, host.root ? { SUDO_USER: "alice" } : {}),
    Effect.provide(Layer.mergeAll(NodeServices.layer, TestConsole.layer)),
  );
};

const aptGet = (commands: ReadonlyArray<ReadonlyArray<string>>) =>
  commands.filter(([name]) => name === "apt-get");

it.effect("setup without root does not report a host without fonts as ready", () =>
  Effect.gen(function* () {
    const { result, commands, output } = yield* runSetup({ root: false });
    expect(result).toMatchObject({ _tag: "Failure", failure: { _tag: "BrowserSetupStepError" } });
    expect(output).toContain(
      "T3's browser needs fontconfig and system fonts; setup installs them.",
    );
    expect(output).toContain("This needs root. Run:");
    expect(output).not.toContain("ready");
    expect(aptGet(commands)).toEqual([]);
  }),
);

it.effect("setup as root installs missing libraries and fonts after one package refresh", () =>
  Effect.gen(function* () {
    const { result, commands, output } = yield* runSetup({ root: true, missingLibrary: true });
    expect(result._tag).toBe("Success");
    const apt = aptGet(commands);
    expect(apt.filter(([, action]) => action === "update")).toHaveLength(1);
    expect(apt.find((args) => args.includes("libnss3"))).toBeDefined();
    expect(apt).toContainEqual([
      "apt-get",
      "install",
      "-y",
      "--no-install-recommends",
      "fontconfig",
      "fonts-liberation",
    ]);
    expect(output).toContain("Installed the browser's fonts.");
    expect(output).toContain("This host is ready for T3's browser.");
  }),
);

/** Exercise the real setup command without changing the test machine's host policy. */
const sandboxHost = (options: {
  restricted?: boolean;
  profile?: string;
  root?: boolean;
  parserExit?: number;
  missingLibrary?: boolean;
  platform?: NodeJS.Platform;
}) => {
  const files = new Map<string, string>();
  if (options.missingLibrary) {
    files.set("/test/t3-home/tools/chrome-headless-shell/linux64/154/chrome-headless-shell", "");
  }
  if (options.profile !== undefined) {
    files.set(PreviewBrowserHost.APPARMOR_PROFILE_PATH, options.profile);
  }
  const commands: Array<ReadonlyArray<string>> = [];
  const writes: Array<string> = [];
  const fs = FileSystem.makeNoop({
    exists: (path) => Effect.succeed(files.has(path)),
    readFileString: () => Effect.succeed(options.restricted ? "1\n" : "0\n"),
    readDirectory: (path) =>
      Effect.succeed(
        options.missingLibrary ? [path.endsWith("chrome-headless-shell") ? "linux64" : "154"] : [],
      ),
    writeFileString: (path, content) =>
      Effect.sync(() => {
        writes.push(path);
        files.set(path, content);
      }),
  });
  const spawner = ChildProcessSpawner.make((command) =>
    Effect.sync(() => {
      const process = command as unknown as { command: string; args: ReadonlyArray<string> };
      // Font availability is independent of sandbox policy in these cases.
      if (process.command !== "fc-match") commands.push([process.command, ...process.args]);
      return ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(1),
        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(options.parserExit ?? 0)),
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        unref: Effect.succeed(Effect.void),
        stdin: Sink.drain,
        stdout:
          process.command === "fc-match"
            ? Stream.make(new TextEncoder().encode(FONT))
            : Stream.empty,
        stderr: Stream.empty,
        all: options.missingLibrary
          ? Stream.make(
              new TextEncoder().encode(
                process.command === "ldd"
                  ? "\tlibnss3.so => not found\n"
                  : "chrome-headless-shell: error while loading shared libraries: libnss3.so: cannot open shared object file",
              ),
            )
          : Stream.empty,
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
      });
    }),
  );
  const run = Command.runWith(browserCommand, { version: "0.0.0" })([
    "setup",
    "--base-dir",
    "/test/t3-home",
  ]).pipe(
    Effect.provideService(FileSystem.FileSystem, fs),
    Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
    Effect.provideService(HostProcess.Platform, options.platform ?? "linux"),
    Effect.provideService(HostProcess.UserId, options.root ? 0 : 1000),
    Effect.provideService(HostProcess.IsExecutable, true),
    Effect.provideService(HostProcess.ExecutablePath, "/test/t3"),
    Effect.provideService(HostProcess.Arguments, ["/test/t3"]),
    Effect.provideService(HostProcess.Environment, { PATH: "" }),
    Effect.provide(Layer.mergeAll(NodeServices.layer, TestConsole.layer)),
  );
  return { run, files, commands, writes };
};

describe("browser setup", () => {
  it.effect("leaves unrestricted hosts unchanged", () =>
    Effect.gen(function* () {
      const machine = sandboxHost({});
      yield* machine.run;
      expect(machine.commands).toEqual([]);
      expect(machine.writes).toEqual([]);
    }),
  );

  it.effect("reports an unsuccessful setup when root is required", () =>
    Effect.gen(function* () {
      const machine = sandboxHost({ restricted: true });
      const error = yield* machine.run.pipe(Effect.flip);
      expect(error).toMatchObject({ _tag: "PreviewBrowserSandboxError" });
      expect(machine.commands).toEqual([]);
      expect(machine.writes).toEqual([]);
    }),
  );

  it.effect("reports an unsuccessful setup when installing libraries needs root", () =>
    Effect.gen(function* () {
      const machine = sandboxHost({ missingLibrary: true });
      expect(yield* machine.run.pipe(Effect.flip)).toMatchObject({
        _tag: "PreviewBrowserLibrariesError",
        libraries: ["libnss3.so"],
      });
      expect(machine.commands.map((command) => command[0])).toEqual([
        "/test/t3-home/tools/chrome-headless-shell/linux64/154/chrome-headless-shell",
        "ldd",
      ]);
      expect(machine.writes).toEqual([]);
    }),
  );

  it.effect("installs and loads the profile as root", () =>
    Effect.gen(function* () {
      const machine = sandboxHost({ restricted: true, root: true });
      yield* machine.run;
      expect(machine.files.get(PreviewBrowserHost.APPARMOR_PROFILE_PATH)).toBe(
        PreviewBrowserHost.APPARMOR_PROFILE,
      );
      expect(machine.commands).toEqual([
        ["apparmor_parser", "-r", PreviewBrowserHost.APPARMOR_PROFILE_PATH],
      ]);
    }),
  );

  it.effect("reloads an existing profile without overwriting local policy", () =>
    Effect.gen(function* () {
      const machine = sandboxHost({ restricted: true, root: true, profile: "site policy" });
      yield* machine.run;
      expect(machine.writes).toEqual([]);
      expect(machine.files.get(PreviewBrowserHost.APPARMOR_PROFILE_PATH)).toBe("site policy");
      expect(machine.commands).toEqual([
        ["apparmor_parser", "-r", PreviewBrowserHost.APPARMOR_PROFILE_PATH],
      ]);
    }),
  );

  it.effect("does not treat a failed profile load as successful setup", () =>
    Effect.gen(function* () {
      const machine = sandboxHost({
        restricted: true,
        root: true,
        profile: "site policy",
        parserExit: 1,
      });
      expect(yield* machine.run.pipe(Effect.flip)).toMatchObject({ _tag: "BrowserSetupStepError" });
      expect(machine.writes).toEqual([]);
    }),
  );

  it.effect("does not require root for an installed profile", () =>
    Effect.gen(function* () {
      const machine = sandboxHost({ restricted: true, profile: "site policy" });
      yield* machine.run;
      expect(machine.commands).toEqual([]);
      expect(machine.writes).toEqual([]);
    }),
  );

  it.effect("does not configure non-Linux hosts", () =>
    Effect.gen(function* () {
      const machine = sandboxHost({ platform: "darwin", restricted: true, root: true });
      yield* machine.run;
      expect(machine.commands).toEqual([]);
      expect(machine.writes).toEqual([]);
    }),
  );
});
