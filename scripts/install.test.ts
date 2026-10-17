// @effect-diagnostics nodeBuiltinImport:off - Drives the real shell installer through a PTY and a gated HTTP fixture.
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeHttp from "node:http";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

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
