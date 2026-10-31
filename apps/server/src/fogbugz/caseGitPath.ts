import type * as Path from "effect/Path";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- Metadata paths need a synchronous deterministic digest.
import * as NodeCrypto from "node:crypto";

export const caseGitPath = (
  path: Path.Path,
  baseDir: string,
  connectionId: string,
  personId: number,
  caseId: number,
  threadId: string,
  project?: { workspaceRoot: string; directory: string },
) => {
  if (
    !/^[a-zA-Z0-9_-]+$/.test(connectionId) ||
    !/^[a-zA-Z0-9_:-]+$/.test(threadId) ||
    !Number.isSafeInteger(personId) ||
    personId < 1 ||
    !Number.isSafeInteger(caseId) ||
    caseId < 1
  )
    return null;
  if (project?.directory) {
    if (/[\x00-\x1f]/.test(project.directory)) return null;
    const directory = path.resolve(project.workspaceRoot, project.directory);
    if (directory === path.parse(directory).root) return null;
    if (directory.split(path.sep).some((segment) => segment === ".git" || segment === ".svn"))
      return null;
    return path.join(directory, `FB${caseId}`);
  }
  return path.join(
    baseDir,
    "case-files",
    connectionId,
    String(personId),
    String(caseId),
    encodeURIComponent(threadId),
    "repo",
  );
};

export const caseGitMetadataPath = (
  path: Path.Path,
  baseDir: string,
  cwd: string,
  shared: boolean,
) =>
  shared
    ? path.join(
        baseDir,
        "case-files",
        "shared",
        NodeCrypto.createHash("sha256").update(cwd).digest("hex"),
      )
    : path.dirname(cwd);
