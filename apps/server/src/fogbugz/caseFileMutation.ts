// @effect-diagnostics nodeBuiltinImport:off
import { FogBugzError, type FogBugzCaseFilesInput } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as NodeFSP from "node:fs/promises";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import {
  parseThreadSegmentFromAttachmentId,
  resolveAttachmentPathById,
} from "../attachmentStore.ts";

type Limits = {
  fileBytes: number;
  groupBytes: number;
  groupFiles: number;
  repositoryBytes: number;
};
const isFogBugzError = Schema.is(FogBugzError);

async function resolveCasePath(cwd: string, relativePath: string) {
  const segments = relativePath.split("/");
  if (
    relativePath.length > 1024 ||
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        /[\\:\x00-\x1f]/.test(segment) ||
        /^\.git(?:$|\.)/i.test(segment) ||
        /[. ]$/.test(segment),
    )
  )
    throw new FogBugzError({ code: "case_files_path" });
  let target = cwd;
  for (const [index, segment] of segments.entries()) {
    target = NodePath.join(target, segment);
    const stat = await NodeFSP.lstat(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT" && index === segments.length - 1) return null;
      throw error;
    });
    if (stat?.isSymbolicLink() || (index < segments.length - 1 && !stat?.isDirectory()))
      throw new FogBugzError({ code: "case_files_path" });
  }
  return target;
}

async function repositorySize(directory: string): Promise<number> {
  let size = 0;
  for (const entry of await NodeFSP.readdir(directory, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const target = NodePath.join(directory, entry.name);
    if (entry.isDirectory()) size += await repositorySize(target);
    else if (entry.isFile()) size += (await NodeFSP.stat(target)).size;
  }
  return size;
}

export const mutateCaseFiles = Effect.fn("FogBugzCaseGit.writeFiles")(
  (
    cwd: string,
    attachmentsDir: string,
    limits: Limits,
    action: typeof FogBugzCaseFilesInput.Type.action,
  ) =>
    Effect.tryPromise({
      try: async () => {
        if ((await NodeFSP.realpath(cwd)) !== cwd)
          throw new FogBugzError({ code: "case_files_path" });
        if (action.type === "delete") {
          const target = await resolveCasePath(cwd, action.path);
          const stat = await NodeFSP.lstat(target);
          // A directory deletion removes its contents, but never follows a symlink outside the checkout.
          if (stat.isDirectory()) await NodeFSP.rm(target, { recursive: true });
          else await NodeFSP.unlink(target);
          return;
        }
        if (action.type === "create-directory") {
          await NodeFSP.mkdir(await resolveCasePath(cwd, action.path));
          return;
        }
        const entries =
          action.type === "upload" ? action.files : [{ path: action.path, attachmentId: null }];
        if (entries.length > limits.groupFiles)
          throw new FogBugzError({ code: "case_files_limit" });
        const destinations = new Set<string>();
        let bytes = 0;
        const copies = [];
        for (const entry of entries) {
          const target = await resolveCasePath(cwd, entry.path);
          if (destinations.has(target)) throw new FogBugzError({ code: "case_files_exists" });
          destinations.add(target);
          const existing = await NodeFSP.lstat(target).catch((error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return null;
            throw error;
          });
          if (existing) throw new FogBugzError({ code: "case_files_exists" });
          let source: string | null = null;
          if (entry.attachmentId !== null) {
            if (parseThreadSegmentFromAttachmentId(entry.attachmentId) !== "pending")
              throw new FogBugzError({ code: "case_files_path" });
            source = resolveAttachmentPathById({
              attachmentsDir,
              attachmentId: entry.attachmentId,
            });
            if (!source) throw new FogBugzError({ code: "case_files_io" });
            const stat = await NodeFSP.lstat(source);
            if (!stat.isFile() || stat.size > limits.fileBytes)
              throw new FogBugzError({ code: "case_files_limit" });
            bytes += stat.size;
          }
          copies.push({ target, source });
        }
        if (
          bytes > limits.groupBytes ||
          (await repositorySize(cwd)) + bytes > limits.repositoryBytes
        )
          throw new FogBugzError({ code: "case_files_limit" });
        const created: string[] = [];
        try {
          for (const { target, source } of copies) {
            if (source) await NodeFSP.copyFile(source, target, NodeFS.constants.COPYFILE_EXCL);
            else await NodeFSP.writeFile(target, "", { flag: "wx" });
            created.push(target);
          }
        } catch (error) {
          for (const target of created) await NodeFSP.unlink(target);
          throw error;
        }
      },
      catch: (error) =>
        isFogBugzError(error)
          ? error
          : new FogBugzError({
              code:
                (error as NodeJS.ErrnoException).code === "EEXIST"
                  ? "case_files_exists"
                  : "case_files_io",
            }),
    }),
  // Keep the checkout lease until filesystem writes and any rollback have finished.
  Effect.uninterruptible,
);
