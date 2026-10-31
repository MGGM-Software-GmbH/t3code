import type * as Path from "effect/Path";

export const caseGitPath = (
  path: Path.Path,
  baseDir: string,
  connectionId: string,
  personId: number,
  caseId: number,
  threadId: string,
) => {
  if (
    ![connectionId, threadId].every((value) => /^[a-zA-Z0-9_-]+$/.test(value)) ||
    !Number.isSafeInteger(personId) ||
    personId < 1 ||
    !Number.isSafeInteger(caseId) ||
    caseId < 1
  )
    return null;
  return path.join(
    baseDir,
    "case-files",
    connectionId,
    String(personId),
    String(caseId),
    threadId,
    "repo",
  );
};
