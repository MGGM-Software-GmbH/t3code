import * as NodeAssert from "node:assert/strict";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeChildProcess from "node:child_process";

// This release-only adapter preserves the installed server and all other client chunks.
const [sourceArgument, destinationArgument] = process.argv.slice(2);
NodeAssert.ok(
  sourceArgument && destinationArgument,
  "Usage: node scripts/patch-mermaid-0.0.42.mjs <original-client> <new-client>",
);
const source = NodePath.resolve(sourceArgument);
const destination = NodePath.resolve(destinationArgument);
NodeAssert.notEqual(source, destination);
const chunkName = "ChatMarkdown-eZYDpsbN.js";
const original = await NodeFSP.readFile(NodePath.join(source, "assets", chunkName), "utf8");
const sha256 = (value) => NodeCrypto.createHash("sha256").update(value).digest("hex");
NodeAssert.equal(
  sha256(original),
  "f51b70ca7092043b8c5d8406102741dc7c7c0a00f3ba0263d106257d2d13356e",
  "Unexpected Markdown renderer: inspect the release before patching",
);
const before =
  "children:(0,B.jsx)(Gw,{className:o.className,code:o.code,themeName:i,isStreaming:a})";
NodeAssert.equal(original.split(before).length, 2, "Expected exactly one code renderer");
const patched =
  'import{MermaidDiagram as LocalMermaidDiagram}from"./mermaid-local/MermaidDiagram.js";\n' +
  original.replace(
    before,
    "children:s===`mermaid`&&!a?(0,B.jsx)(LocalMermaidDiagram,{code:o.code,theme:r}):(0,B.jsx)(Gw,{className:o.className,code:o.code,themeName:i,isStreaming:a})",
  );

// mkdir is intentionally exclusive: never overwrite an existing release or test artifact.
await NodeFSP.mkdir(destination);
for (const entry of await NodeFSP.readdir(source)) {
  await NodeFSP.cp(NodePath.join(source, entry), NodePath.join(destination, entry), {
    recursive: true,
    force: false,
    errorOnExist: true,
  });
}
const scratch = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-mermaid-build-"));
const shim = NodePath.join(scratch, "react.ts");
await NodeFSP.writeFile(
  shim,
  `import { r as loadReact } from "../Icon-Bs5kt4yk.js";
const React = loadReact();
export const { createElement, useEffect, useRef, useState } = React;
`,
);
const build = NodeChildProcess.spawnSync(
  NodePath.resolve("node_modules/.bin/esbuild"),
  [
    "apps/web/src/components/MermaidDiagram.tsx",
    "--bundle",
    "--splitting",
    "--format=esm",
    "--platform=browser",
    "--target=es2024",
    "--minify",
    "--jsx=transform",
    "--jsx-factory=React.createElement",
    '--tsconfig-raw={"compilerOptions":{"jsx":"react","jsxFactory":"React.createElement"}}',
    `--alias:react=${shim}`,
    "--external:../Icon-Bs5kt4yk.js",
    `--outdir=${NodePath.join(destination, "assets/mermaid-local")}`,
    "--log-level=warning",
  ],
  { stdio: "inherit" },
);
NodeAssert.equal(build.status, 0, "Mermaid bundle failed");
await NodeFSP.writeFile(NodePath.join(destination, "assets", chunkName), patched);
await NodeFSP.writeFile(
  NodePath.join(scratch, "manifest.json"),
  JSON.stringify(
    { source, destination, originalHash: sha256(original), patchedHash: sha256(patched) },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    destination,
    originalHash: sha256(original),
    patchedHash: sha256(patched),
    manifest: NodePath.join(scratch, "manifest.json"),
  }),
);
