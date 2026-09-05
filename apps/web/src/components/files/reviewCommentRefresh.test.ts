import { EnvironmentId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  query: {},
  optimistic: {},
  get: vi.fn(),
  refresh: vi.fn(),
  execute: vi.fn(),
  readFile: vi.fn(),
}));
vi.mock("~/rpc/atomRegistry", () => ({
  appAtomRegistry: { get: mocks.get, refresh: mocks.refresh },
}));
vi.mock("~/state/projects", () => ({
  projectEnvironment: { readFile: mocks.readFile, optimisticFile: () => mocks.optimistic },
}));
vi.mock("@t3tools/client-runtime/state/runtime", () => ({ executeAtomQuery: mocks.execute }));
vi.mock("~/state/queries", () => ({ useProjectPathSearch: vi.fn() }));

import { readProjectFileForReview } from "./projectFilesQueryState";

const environmentId = EnvironmentId.make("review-refresh-environment");
const before = {
  contents: "head\ntarget",
  relativePath: "file.ts",
  truncated: false,
  byteLength: 11,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.readFile.mockReturnValue(mocks.query);
  mocks.get.mockImplementation((atom) =>
    atom === mocks.optimistic ? null : AsyncResult.success(before),
  );
  mocks.execute.mockResolvedValue(
    AsyncResult.success({ ...before, contents: "inserted\nhead\ntarget" }),
  );
});

describe("authoritative review file reads", () => {
  it("refreshes the scoped query and retains the previous version for line mapping", async () => {
    expect(await readProjectFileForReview(environmentId, "/workspace", "file.ts")).toEqual({
      previousContents: before.contents,
      contents: "inserted\nhead\ntarget",
    });
    expect(mocks.readFile).toHaveBeenCalledWith({
      environmentId,
      input: { cwd: "/workspace", relativePath: "file.ts" },
    });
    expect(mocks.refresh).toHaveBeenCalledWith(mocks.query);
    expect(mocks.execute).toHaveBeenCalledOnce();
  });

  it("rejects pending local writes without refreshing over them", async () => {
    mocks.get.mockReturnValue({ data: before });
    await expect(readProjectFileForReview(environmentId, "/workspace", "file.ts")).rejects.toThrow(
      "finish saving",
    );
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it.each(["failure", "truncated"])("rejects an unusable read: %s", async (result) => {
    mocks.execute.mockResolvedValue(
      result === "failure"
        ? AsyncResult.failure(Cause.die(new Error("Offline")))
        : AsyncResult.success({ ...before, truncated: true }),
    );
    await expect(readProjectFileForReview(environmentId, "/workspace", "file.ts")).rejects.toThrow(
      result === "failure" ? "Could not refresh" : "truncated",
    );
  });
});
