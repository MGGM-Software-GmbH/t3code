import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  beginSend: vi.fn(),
  markDispatching: vi.fn(),
  finishSend: vi.fn(),
  failSend: vi.fn(),
  readFile: vi.fn(),
  run: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("../../queuedMessageStore", () => ({
  useQueuedMessageStore: { getState: () => mocks },
  latestCompletedToolActivityId: () => null,
}));
vi.mock("../../rpc/atomRegistry", () => ({
  appAtomRegistry: {
    get: () =>
      new Map([["env", { environment: { capabilities: { inlineMessageContext: true } } }]]),
  },
}));
vi.mock("../../state/server", () => ({ environmentServerConfigsAtom: {} }));
vi.mock("../../state/entities", () => ({
  readThread: () => undefined,
  readThreadShell: () => ({
    projectId: "project",
    worktreePath: "/worktree",
    runtimeMode: "full-access",
    interactionMode: "default",
  }),
  readProject: () => ({ workspaceRoot: "/project" }),
}));
vi.mock("../../state/threads", () => ({
  threadEnvironment: { startTurn: "start", updateMetadata: "metadata" },
}));
vi.mock("@t3tools/client-runtime/state/runtime", () => ({
  runAtomCommand: (...args: unknown[]) => mocks.run(...args),
  squashAtomCommandFailure: () => new Error("Send failed"),
}));
vi.mock("../files/projectFilesQueryState", () => ({
  readProjectFileForReview: (...args: unknown[]) => mocks.readFile(...args),
}));
vi.mock("../ChatView.logic", () => ({
  deriveComposerSendState: () => ({ sendableTerminalContexts: [], hasSendableContent: true }),
  resolveThreadMetadataUpdateForNextTurn: () => null,
  createLocalDispatchSnapshot: () => ({}),
  readFileAsDataUrl: vi.fn(),
  revokeBlobPreviewUrl: vi.fn(),
}));
vi.mock("../../lib/attachmentUploadQueue", () => ({
  awaitAttachmentUploads: vi.fn(),
  getUploadedAttachments: vi.fn(),
  releaseDraftAttachments: vi.fn(),
  startAttachmentUpload: vi.fn(),
}));
vi.mock("../ui/toast", () => ({
  toastManager: { add: (...args: unknown[]) => mocks.toast(...args) },
}));

import { buildFileReviewComment } from "../../reviewCommentContext";
import { sendQueuedMessage } from "./sendQueuedMessage";

const threadRef = { environmentId: EnvironmentId.make("env"), threadId: ThreadId.make("thread") };
const contents = "header\ntarget\nfooter";
const comment = buildFileReviewComment({
  id: "queued-review",
  filePath: "a.ts",
  startLine: 2,
  endLine: 2,
  contents,
  text: "Review this",
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.beginSend.mockReturnValue({
    id: "message",
    prompt: "Review",
    images: [],
    files: [],
    terminalContexts: [],
    previewAnnotations: [],
    reviewComments: [comment],
    sendSettings: {
      runtimeMode: "full-access",
      interactionMode: "default",
      modelSelection: { provider: "codex", model: "test" },
    },
  });
  mocks.markDispatching.mockReturnValue(true);
  mocks.failSend.mockReturnValue(true);
  mocks.run.mockResolvedValue({ _tag: "Success", value: undefined });
  mocks.readFile.mockResolvedValue({
    previousContents: contents,
    contents: `inserted\n${contents}`,
  });
});

describe("queued review snapshots", () => {
  it("reads the thread worktree at dispatch and sends current coordinates", async () => {
    await sendQueuedMessage(threadRef, "message");
    expect(mocks.readFile).toHaveBeenCalledWith("env", "/worktree", "a.ts");
    const request = mocks.run.mock.calls.find((call) => call[1] === "start")?.[2];
    expect(request.input.message.context.records[0]).toMatchObject({
      rangeLabel: "L3",
      sourceStatus: "current",
      diff: "target",
    });
    expect(mocks.finishSend).toHaveBeenCalledOnce();
  });

  it("preserves a deleted source snapshot without claiming current coordinates", async () => {
    mocks.readFile.mockResolvedValue({ previousContents: contents, contents: "header\nfooter" });
    await sendQueuedMessage(threadRef, "message");
    const request = mocks.run.mock.calls.find((call) => call[1] === "start")?.[2];
    expect(request.input.message.context.records[0]).toMatchObject({
      sourceStatus: "removed",
      diff: "target",
    });
  });

  it("keeps a failed read queued and does not dispatch stale context", async () => {
    mocks.readFile.mockRejectedValue(new Error("Offline"));
    await sendQueuedMessage(threadRef, "message");
    expect(mocks.markDispatching).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.failSend).toHaveBeenCalledOnce();
    expect(mocks.finishSend).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ description: "Offline" }));
  });

  it("honors cancellation while the authoritative read is pending", async () => {
    let release!: () => void;
    let entered!: () => void;
    const reading = new Promise<void>((resolve) => {
      entered = resolve;
    });
    mocks.readFile.mockImplementation(() => {
      entered();
      return new Promise((resolve) => {
        release = () => resolve({ previousContents: contents, contents });
      });
    });
    const sending = sendQueuedMessage(threadRef, "message");
    await reading;
    mocks.markDispatching.mockReturnValue(false);
    release();
    await sending;
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.finishSend).not.toHaveBeenCalled();
  });
});
