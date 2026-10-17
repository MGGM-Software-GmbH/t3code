// @effect-diagnostics nodeBuiltinImport:off - Drives the real shell installer through a PTY and a gated HTTP fixture.
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeHttp from "node:http";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

// Exercise the curl-pipe-sh entry point without touching the user's T3 home.
describe.skipIf(HostProcess.Platform.defaultValue() !== "linux")("fork installer", () => {
  it.each(["install", "checksum-mismatch", "nightly", "preview"] as const)(
    "resolves the latest stable fork release (%s)",
    async (scenario) => {
      const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-fork-install-"));
      const versions = ["1.2.3-mggm.1", "1.2.3-mggm.2"];
      let selectedVersion = versions[0]!;
      const archives = new Map<string, Buffer>();
      const requests: string[] = [];
      const fixtureBin = NodePath.join(root, "fixture-bin");
      await NodeFSP.mkdir(fixtureBin);
      const realCurl = NodeChildProcess.execFileSync("sh", ["-c", "command -v curl"], {
        encoding: "utf8",
      }).trim();
      await NodeFSP.writeFile(
        NodePath.join(fixtureBin, "curl"),
        `#!/bin/sh
case "$4" in
  https://api.github.com/repos/MGGM-Software-GmbH/t3code/releases/latest)
    exec "$T3CODE_TEST_CURL" -sSL -w '%{http_code}' "$T3CODE_TEST_INDEX_URL" -o "$6"
    ;;
  https://api.github.com/*) echo 'Unexpected release repository or endpoint' >&2; exit 1 ;;
esac
exec "$T3CODE_TEST_CURL" "$@"
`,
        { mode: 0o755 },
      );
      for (const version of versions) {
        const stem = `t3-${version}-linux-${HostProcess.Architecture.defaultValue()}`;
        await NodeFSP.mkdir(NodePath.join(root, stem));
        await NodeFSP.writeFile(
          NodePath.join(root, stem, "t3"),
          `#!/bin/sh
if [ "$1" = --version ]; then echo 't3 v${version}'; exit 0; fi
[ "$1" = browser ] && [ "$2" = setup ]
`,
          { mode: 0o755 },
        );
        const archivePath = NodePath.join(root, `${stem}.tar.gz`);
        NodeChildProcess.execFileSync("tar", ["-czf", archivePath, "-C", root, stem]);
        archives.set(`${stem}.tar.gz`, await NodeFSP.readFile(archivePath));
      }
      const server = NodeHttp.createServer((request, response) => {
        requests.push(request.url ?? "");
        if (request.url === "/index") {
          const version =
            scenario === "nightly" || scenario === "preview"
              ? `1.2.3-${scenario}.20261017.1`
              : selectedVersion;
          response.end(JSON.stringify({ tag_name: `v${version}` }, null, 2));
          return;
        }
        const stem = `t3-${selectedVersion}-linux-${HostProcess.Architecture.defaultValue()}`;
        const archiveName = `${stem}.tar.gz`;
        const archive = archives.get(archiveName)!;
        if (request.url === `/v${selectedVersion}/SHA256SUMS`) {
          const checksum =
            scenario === "checksum-mismatch"
              ? "0".repeat(64)
              : NodeCrypto.createHash("sha256").update(archive).digest("hex");
          response.end(`${checksum}  ${archiveName}\n`);
        } else if (request.url === `/v${selectedVersion}/${archiveName}`) {
          response.end(archive);
        } else {
          response.writeHead(404).end();
        }
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Expected a TCP listener");
      const releaseBase = `http://127.0.0.1:${address.port}`;
      const home = NodePath.join(root, "home");
      const binDir = NodePath.join(root, "bin");
      const runInstaller = () =>
        new Promise<{ success: boolean; output: string }>((resolve) => {
          NodeChildProcess.execFile(
            "sh",
            ["-c", 'cat "$T3CODE_TEST_INSTALLER" | sh'],
            {
              timeout: 20_000,
              env: {
                ...process.env,
                PATH: `${fixtureBin}${NodePath.delimiter}${process.env.PATH}`,
                T3CODE_TEST_CURL: realCurl,
                T3CODE_TEST_INDEX_URL: `${releaseBase}/index`,
                T3CODE_TEST_INSTALLER: NodePath.resolve(import.meta.dirname, "install.sh"),
                T3CODE_HOME: home,
                T3CODE_INSTALL_BIN_DIR: binDir,
                T3CODE_RELEASE_BASE_URL: releaseBase,
                T3CODE_CHANNEL: "stable",
                T3CODE_VERSION: "",
              },
            },
            (error, stdout, stderr) => resolve({ success: !error, output: stdout + stderr }),
          );
        });
      try {
        const result = await runInstaller();
        if (scenario === "install") {
          expect(result).toMatchObject({ success: true });
          expect(result.output).toContain(`Installed T3 Code ${selectedVersion}`);
          expect(
            NodeChildProcess.execFileSync(NodePath.join(binDir, "t3"), ["--version"], {
              encoding: "utf8",
            }).trim(),
          ).toBe(`t3 v${selectedVersion}`);
          selectedVersion = versions[1]!;
          const updated = await runInstaller();
          expect(updated).toMatchObject({ success: true });
          expect(updated.output).toContain(`Installed T3 Code ${selectedVersion}`);
          expect(
            NodeChildProcess.execFileSync(NodePath.join(binDir, "t3"), ["--version"], {
              encoding: "utf8",
            }).trim(),
          ).toBe(`t3 v${selectedVersion}`);
          expect(requests.filter((request) => request === "/index")).toHaveLength(2);
        } else {
          expect(result.success).toBe(false);
          expect(result.output).not.toContain("Installed T3 Code");
          expect(result.output).toContain(
            scenario === "checksum-mismatch"
              ? "checksum mismatch"
              : "could not find a stable release",
          );
          expect(await NodeFSP.readdir(root)).not.toContain("bin");
          if (scenario === "nightly" || scenario === "preview") {
            expect(requests).toEqual(["/index"]);
          }
        }
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await NodeFSP.rm(root, { recursive: true });
      }
    },
  );
});

// util-linux's script gives the real installer a terminal without a browser or extra packages.
describe.skipIf(HostProcess.Platform.defaultValue() !== "linux")("installer terminal", () => {
  it.each([
    { fail: false, setup: "ready", root: false },
    { fail: true, setup: "ready", root: false },
    { fail: false, setup: "needs-root", root: false },
    { fail: false, setup: "needs-root", root: true },
    { fail: false, setup: "sudo-denied", root: false },
    { fail: false, setup: "parser-failed", root: false },
    { fail: false, setup: "parser-failed", root: true },
  ])("sets up the browser host during installation (%j)", async ({ fail, setup, root: isRoot }) => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-install-progress-"));
    const version = "1.2.3";
    const stem = `t3-${version}-linux-${HostProcess.Architecture.defaultValue()}`;
    const archiveName = `${stem}.tar.gz`;
    let resumeDownload: (() => void) | undefined;
    let sawPartialProgress = false;
    let output = "";
    let requests = 0;
    await NodeFSP.mkdir(NodePath.join(root, stem));
    const calls = NodePath.join(root, "setup-calls");
    const fixtureBin = NodePath.join(root, "fixture-bin");
    await NodeFSP.mkdir(fixtureBin);
    await NodeFSP.writeFile(
      NodePath.join(fixtureBin, "id"),
      `#!/bin/sh\necho ${isRoot ? 0 : 1000}\n`,
      { mode: 0o755 },
    );
    await NodeFSP.writeFile(
      NodePath.join(fixtureBin, "sudo"),
      `#!/bin/sh
printf 'sudo\\n' >> "$T3CODE_TEST_CALLS"
if [ "$T3CODE_TEST_SETUP" = sudo-denied ]; then exit 1; fi
[ "$1" = -n ] || exit 9
shift
[ "$1" = -- ] || exit 9
shift
T3CODE_TEST_ROOT=1 exec "$@"
`,
      { mode: 0o755 },
    );
    await NodeFSP.writeFile(
      NodePath.join(root, stem, "t3"),
      `#!/bin/sh
if [ "$1" = --version ]; then echo 't3 v1.2.3'; exit 0; fi
printf '%s|%s|%s|%s|%s\\n' "$1" "$2" "$3" "$4" "$T3CODE_TEST_ROOT" >> "$T3CODE_TEST_CALLS"
[ "$1" = browser ] && [ "$2" = setup ] && [ "$3" = --base-dir ] || exit 9
[ "$T3CODE_TEST_SETUP" != parser-failed ] || exit 2
[ "$T3CODE_TEST_SETUP" = ready ] || [ "$T3CODE_TEST_ROOT" = 1 ]
`,
      {
        mode: 0o755,
      },
    );
    await NodeFSP.writeFile(
      NodePath.join(root, stem, "payload"),
      NodeCrypto.randomBytes(64 * 1024),
    );
    NodeChildProcess.execFileSync("tar", [
      "-czf",
      NodePath.join(root, archiveName),
      "-C",
      root,
      stem,
    ]);
    const archive = await NodeFSP.readFile(NodePath.join(root, archiveName));
    const checksum = NodeCrypto.createHash("sha256").update(archive).digest("hex");
    const server = NodeHttp.createServer((request, response) => {
      requests += 1;
      if (request.url?.endsWith("/SHA256SUMS")) {
        response.end(`${checksum}  ${archiveName}\n`);
      } else if (fail) {
        response.writeHead(500).end();
      } else {
        response.writeHead(200, { "Content-Length": archive.length });
        resumeDownload = () => response.end(archive.subarray(Math.floor(archive.length / 2)));
        response.write(archive.subarray(0, Math.floor(archive.length / 2)));
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected a TCP listener");
    const installer = NodePath.resolve(import.meta.dirname, "install.sh").replaceAll("'", "'\\''");
    const fixtureEnvironment = {
      ...process.env,
      PATH: `${fixtureBin}${NodePath.delimiter}${process.env.PATH}`,
      T3CODE_TEST_CALLS: calls,
      T3CODE_TEST_SETUP: setup,
      T3CODE_TEST_ROOT: isRoot ? "1" : "0",
      TERM: "xterm",
      NO_COLOR: "1",
      T3CODE_VERSION: version,
      T3CODE_HOME: NodePath.join(root, "home"),
      T3CODE_INSTALL_BIN_DIR: NodePath.join(root, "bin"),
      T3CODE_RELEASE_BASE_URL: `http://127.0.0.1:${address.port}`,
    };
    const child = NodeChildProcess.spawn("script", ["-qec", `sh '${installer}'`, "/dev/null"], {
      env: fixtureEnvironment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const collect = (chunk: Buffer) => {
      output += chunk.toString();
      if (!sawPartialProgress && /\b[1-9]\d?%/.test(output)) {
        sawPartialProgress = true;
        resumeDownload?.();
      }
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    try {
      const code = await new Promise<number | null>((resolve, reject) => {
        child.on("error", reject);
        child.on("close", resolve);
      });
      const versions = NodePath.join(root, "home/runtime/versions");
      if (fail) {
        expect(code).not.toBe(0);
        expect(output).toContain("500");
        expect(output).not.toContain("100%");
        expect(output).not.toContain("Installed T3 Code");
        expect(await NodeFSP.readdir(versions)).toEqual([]);
      } else if (setup === "sudo-denied" || setup === "parser-failed") {
        expect(code).not.toBe(0);
        expect(output).toContain("browser host setup failed");
        expect(output).not.toContain("Installed T3 Code");
      } else {
        expect(code).toBe(0);
        expect(sawPartialProgress).toBe(true);
        expect(output).toContain("100%");
        expect(output).toContain("0.1 / 0.1 MB");
        expect(output).toContain("Installed T3 Code 1.2.3");
        expect(
          await NodeFSP.readFile(NodePath.join(versions, version, ".install-complete"), "utf8"),
        ).toBe("1.2.3\n");
        expect(
          NodeChildProcess.execFileSync(NodePath.join(root, "bin/t3"), ["--version"], {
            encoding: "utf8",
          }).trim(),
        ).toBe("t3 v1.2.3");
        expect(await NodeFSP.readdir(versions)).toEqual([version]);
      }
      if (!fail) {
        const commands = (await NodeFSP.readFile(calls, "utf8")).trim().split("\n");
        expect(commands[0]).toBe(
          `browser|setup|--base-dir|${NodePath.join(root, "home")}|${isRoot ? 1 : 0}`,
        );
        if (setup !== "ready" && !isRoot) {
          expect(commands[1]).toBe("sudo");
          if (setup !== "sudo-denied") {
            expect(commands[2]).toBe(`browser|setup|--base-dir|${NodePath.join(root, "home")}|1`);
          }
        } else {
          expect(commands).toHaveLength(1);
        }
        if (setup === "ready") {
          const previousRequests = requests;
          const repeated = await new Promise<string>((resolve, reject) => {
            NodeChildProcess.execFile(
              "sh",
              [NodePath.resolve(import.meta.dirname, "install.sh")],
              {
                env: fixtureEnvironment,
              },
              (error, stdout, stderr) => (error ? reject(error) : resolve(stdout + stderr)),
            );
          });
          expect(repeated).toContain("already downloaded");
          expect(requests).toBe(previousRequests);
          expect((await NodeFSP.readFile(calls, "utf8")).trim().split("\n")).toHaveLength(2);
        }
      }
    } finally {
      if (child.exitCode === null) child.kill();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await NodeFSP.rm(root, { recursive: true, force: true });
    }
  });
});
