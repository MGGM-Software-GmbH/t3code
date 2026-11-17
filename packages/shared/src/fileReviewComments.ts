import type { ReviewCommentContextRecord } from "@t3tools/contracts";
import { diffArrays } from "diff";

/** File source metadata shared by inline review and provider dispatch. */
export type FileReviewComment = Omit<
  ReviewCommentContextRecord,
  | "version"
  | "contextId"
  | "label"
  | "kind"
  | "pullRequest"
  | "fenceLanguage"
  | "sourceAnchor"
  | "sourceStatus"
> & {
  readonly id: string;
  readonly fenceLanguage?: string | undefined;
  readonly sourceAnchor?: { readonly before: string; readonly after: string } | undefined;
  readonly sourceStatus?: "current" | "removed" | "unresolved" | undefined;
};

export function buildFileReviewComment(input: {
  id: string;
  filePath: string;
  startLine: number;
  endLine: number;
  text: string;
  contents: string;
}) {
  const startLine = Math.max(1, Math.min(input.startLine, input.endLine));
  const endLine = Math.max(startLine, Math.max(input.startLine, input.endLine));
  const lines = input.contents.replace(/\r(?=\n|$)/g, "").split("\n");
  const selectedLines = lines.slice(startLine - 1, endLine);
  const before = lines.slice(Math.max(0, startLine - 4), startLine - 1);
  const after = lines.slice(endLine, endLine + 3);
  return {
    id: input.id,
    sectionId: `file:${input.filePath}`,
    sectionTitle: "File (current lines)",
    filePath: input.filePath,
    startIndex: startLine - 1,
    endIndex: endLine - 1,
    rangeLabel: startLine === endLine ? `L${startLine}` : `L${startLine} to L${endLine}`,
    text: input.text.trim(),
    diff: selectedLines.join("\n"),
    fenceLanguage: inferReviewCommentFenceLanguage(input.filePath),
    sourceStatus: "current" as const,
    sourceAnchor: {
      before: before.length > 0 ? `${before.join("\n")}\n` : "",
      after: after.length > 0 ? `\n${after.join("\n")}` : "",
    },
  };
}

/** Without the previous file, require the stored context to identify the same occurrence. */
export function restoreFileReviewCommentRange(
  contents: string,
  comment: FileReviewComment,
): { startLine: number; endLine: number } | null {
  if (comment.sourceStatus === "removed" || !comment.sourceAnchor) return null;
  const lines = contents.replace(/\r(?=\n|$)/g, "").split("\n");
  const before = (comment.sourceAnchor?.before ?? "").replace(/\r(?=\n|$)/g, "");
  const snippet = comment.diff.replace(/\r(?=\n|$)/g, "");
  const selected = snippet.split("\n");
  const anchor = `${before}${snippet}${comment.sourceAnchor?.after ?? ""}`
    .replace(/\r(?=\n|$)/g, "")
    .split("\n");
  let match: number | undefined;
  for (let index = 0; index <= lines.length - anchor.length; index += 1) {
    if (!anchor.every((line, offset) => lines[index + offset] === line)) continue;
    if (match !== undefined) return null;
    match = index + before.split("\n").length;
  }
  return match === undefined ? null : { startLine: match, endLine: match + selected.length - 1 };
}

/** Trim shared boundaries before checking whether an edit search is necessary. */
function fileLineChanges(previous: string[], current: string[]) {
  let start = 0;
  while (start < previous.length && start < current.length && previous[start] === current[start])
    start += 1;
  let previousEnd = previous.length;
  let currentEnd = current.length;
  while (
    previousEnd > start &&
    currentEnd > start &&
    previous[previousEnd - 1] === current[currentEnd - 1]
  ) {
    previousEnd -= 1;
    currentEnd -= 1;
  }
  const removed = previous.slice(start, previousEnd);
  const added = current.slice(start, currentEnd);
  const lineSet = new Set(added);
  // Disjoint blocks have no common subsequence, including rewrites with a shared header or EOF.
  const changes = removed.some((line) => lineSet.has(line))
    ? diffArrays(removed, added)
    : [
        { removed: true, added: false, count: removed.length },
        { removed: false, added: true, count: added.length },
      ];
  return [
    { removed: false, added: false, count: start },
    ...changes,
    { removed: false, added: false, count: previous.length - previousEnd },
  ];
}

/** Track comments through file changes, updating their code context and coordinates together. */
export function remapFileReviewComments<Comment extends FileReviewComment>(
  previousContents: string | null,
  contents: string,
  comments: ReadonlyArray<Comment>,
): Comment[] {
  if (comments.length === 0) return [];
  const lines = contents.length === 0 ? [] : contents.replace(/\r(?=\n|$)/g, "").split("\n");
  const previousLines = previousContents?.replace(/\r(?=\n|$)/g, "").split("\n");
  const mapping = new Map<number, number>();
  const replacements: { oldStart: number; oldEnd: number; newStart: number; newEnd: number }[] = [];
  if (previousLines && previousContents !== contents) {
    let oldIndex = 0;
    let newIndex = 0;
    let removedStart = 0;
    let addedStart = 0;
    const flushReplacement = () => {
      if (oldIndex > removedStart && newIndex > addedStart) {
        replacements.push({
          oldStart: removedStart,
          oldEnd: oldIndex - 1,
          newStart: addedStart,
          newEnd: newIndex - 1,
        });
      }
    };
    for (const change of fileLineChanges(previousLines, lines)) {
      if (change.removed) oldIndex += change.count;
      else if (change.added) newIndex += change.count;
      else {
        flushReplacement();
        for (let offset = 0; offset < change.count; offset += 1)
          mapping.set(oldIndex + offset, newIndex + offset);
        oldIndex += change.count;
        newIndex += change.count;
        removedStart = oldIndex;
        addedStart = newIndex;
      }
    }
    flushReplacement();
  }
  return comments.map((comment) => {
    if (comment.sourceStatus === "removed") return comment;
    let range: { startLine: number; endLine: number } | null;
    // Map indices through the diff only when they still identify the previous file contents.
    const previousSelection = previousLines
      ?.slice(comment.startIndex, comment.endIndex + 1)
      .join("\n");
    if (
      previousContents !== null &&
      previousContents !== contents &&
      comment.sourceStatus !== "unresolved" &&
      previousSelection === comment.diff.replace(/\r(?=\n|$)/g, "")
    ) {
      const mapped: number[] = [];
      let ambiguous = false;
      for (const replacement of replacements) {
        if (replacement.oldEnd < comment.startIndex || replacement.oldStart > comment.endIndex)
          continue;
        // A partial replacement cannot distinguish an edited line from a deleted neighbor.
        if (replacement.oldStart < comment.startIndex || replacement.oldEnd > comment.endIndex) {
          ambiguous = true;
          break;
        }
        mapped.push(replacement.newStart, replacement.newEnd);
      }
      for (let index = comment.startIndex; index <= comment.endIndex; index += 1) {
        const line = mapping.get(index);
        if (line !== undefined) mapped.push(line);
      }
      if (!ambiguous && mapped.length === 0) {
        return {
          ...comment,
          sourceStatus: "removed" as const,
          sectionTitle: "Source removed (last known lines)",
        };
      }
      range = ambiguous
        ? null
        : { startLine: Math.min(...mapped) + 1, endLine: Math.max(...mapped) + 1 };
    } else if (
      comment.sourceStatus !== "unresolved" &&
      previousContents === contents &&
      previousSelection === comment.diff
    ) {
      range = { startLine: comment.startIndex + 1, endLine: comment.endIndex + 1 };
    } else {
      range = restoreFileReviewCommentRange(contents, comment);
    }
    if (!range) {
      return comment.sourceStatus === "unresolved"
        ? comment
        : {
            ...comment,
            sourceStatus: "unresolved" as const,
            sectionTitle: "Source location unresolved (last known lines)",
          };
    }
    const updated = {
      ...comment,
      ...buildFileReviewComment({
        id: comment.id,
        filePath: comment.filePath,
        text: comment.text,
        contents,
        ...range,
      }),
    };
    return JSON.stringify(updated) === JSON.stringify(comment) ? comment : updated;
  });
}

/** Refresh file comments once per file before formatting a prompt, including closed previews. */
export async function refreshFileReviewComments<Comment extends FileReviewComment>(
  comments: ReadonlyArray<Comment>,
  readFile: (filePath: string) => Promise<{ previousContents: string | null; contents: string }>,
): Promise<Comment[]> {
  const paths = [
    ...new Set(
      comments
        .filter((comment) => comment.sectionId === `file:${comment.filePath}`)
        .map((comment) => comment.filePath),
    ),
  ];
  const updated = new Map<string, Comment>();
  await Promise.all(
    paths.map(async (filePath) => {
      const { previousContents, contents } = await readFile(filePath);
      for (const comment of remapFileReviewComments(
        previousContents,
        contents,
        comments.filter((entry) => entry.sectionId === `file:${filePath}`),
      )) {
        updated.set(comment.id, comment);
      }
    }),
  );
  return comments.map((comment) => updated.get(comment.id) ?? comment);
}

export function inferReviewCommentFenceLanguage(filePath: string): string {
  const normalizedPath = filePath.replaceAll("\\", "/");
  const fileName = normalizedPath.slice(normalizedPath.lastIndexOf("/") + 1).toLowerCase();
  const extensionIndex = fileName.lastIndexOf(".");
  if (extensionIndex > 0 && extensionIndex < fileName.length - 1) {
    return fileName.slice(extensionIndex + 1);
  }
  if (fileName.startsWith(".") && fileName.length > 1) {
    return fileName.slice(1);
  }
  return "text";
}
