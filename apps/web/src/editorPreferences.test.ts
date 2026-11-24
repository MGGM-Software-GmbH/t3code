import {
  AuthOrchestrationOperateScope,
  EnvironmentAuthorizationError,
  ExternalLauncherEditorExitError,
  ExternalLauncherEditorTimeoutError,
  EnvironmentId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { assert, beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  allowed: new Set<string>(),
  run: vi.fn(),
  toast: vi.fn(() => "progress"),
  close: vi.fn(),
  getPreference: vi.fn(),
  setPreference: vi.fn(),
}));

vi.mock("./components/ui/toast", () => ({
  toastManager: { add: state.toast, close: state.close },
  stackedThreadToast: (options: unknown) => options,
}));
vi.mock("./state/shell", () => ({ shellEnvironment: { openInEditor: "openInEditor" } }));
vi.mock("./state/use-atom-command", () => ({ useAtomCommand: () => state.run }));
vi.mock("./state/session", () => ({
  readEnvironmentScope: (environmentId: string, scope: string) =>
    scope === AuthOrchestrationOperateScope && state.allowed.has(environmentId),
}));
vi.mock("./hooks/useLocalStorage", () => ({
  getLocalStorageItem: state.getPreference,
  setLocalStorageItem: state.setPreference,
  useLocalStorage: vi.fn(),
}));

import { useOpenInPreferredEditor } from "./editorPreferences";
import { editorFailure } from "./useOpenEditorWithFeedback";

const primary = EnvironmentId.make("primary");
const secondary = EnvironmentId.make("secondary");

beforeEach(() => {
  state.allowed.clear();
  state.run.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  state.getPreference.mockReset().mockReturnValue(null);
  state.setPreference.mockReset();
});

it("shares progress across editor gestures and clears it on completion or interruption", async () => {
  state.allowed.add(secondary);
  state.toast.mockClear();
  state.close.mockClear();
  vi.useFakeTimers();
  try {
    const open = useOpenInPreferredEditor(secondary, ["vscode-insiders"]);
    await open("/fast");
    expect(state.toast).not.toHaveBeenCalled();
    const delayed = Promise.withResolvers<ReturnType<typeof AsyncResult.failure<void, never>>>();
    state.run.mockReturnValueOnce(delayed.promise);
    const first = open("/slow");
    await vi.advanceTimersByTimeAsync(999);
    expect(state.toast).not.toHaveBeenCalled();
    const duplicate = await open("/slow");
    assert(duplicate._tag === "Failure");
    expect(Cause.hasInterruptsOnly(duplicate.cause)).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(state.toast).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ title: "Waiting for VS Code Insiders…" }),
    );
    await open("/different");
    expect(state.run).toHaveBeenCalledTimes(3);
    delayed.resolve(AsyncResult.failure(Cause.interrupt()));
    await first;
    expect(state.close).toHaveBeenCalledExactlyOnceWith("progress");
    await open("/slow");
    expect(state.run).toHaveBeenCalledTimes(4);
  } finally {
    vi.useRealTimers();
  }
});

it("distinguishes an unavailable editor, other CLI exits and missing acknowledgements", () => {
  const editor = "vscode-insiders";
  expect(editorFailure(new ExternalLauncherEditorExitError({ editor, exitCode: 69 }))).toContain(
    "VS Code Insiders is unavailable",
  );
  expect(editorFailure(new ExternalLauncherEditorExitError({ editor, exitCode: 2 }))).toContain(
    "VS Code Insiders returned exit code 2",
  );
  expect(editorFailure(new ExternalLauncherEditorTimeoutError({ editor }))).toContain(
    "VS Code Insiders did not respond",
  );
});

it("does not use another environment's grant or change preferences when denied", async () => {
  state.allowed.add(primary);
  const open = useOpenInPreferredEditor(secondary, ["vscode"]);
  const result = await open("/work/readme.md");
  assert(result._tag === "Failure");
  const error = Cause.squash(result.cause);
  expect(error).toBeInstanceOf(EnvironmentAuthorizationError);
  expect(error).toMatchObject({ requiredScope: AuthOrchestrationOperateScope });
  expect(state.run).not.toHaveBeenCalled();
  expect(state.getPreference).not.toHaveBeenCalled();
  expect(state.setPreference).not.toHaveBeenCalled();
});

it("checks revocation and regrant when a retained editor callback is invoked", async () => {
  state.allowed.add(secondary);
  const open = useOpenInPreferredEditor(secondary, ["vscode"]);
  state.allowed.delete(secondary);
  expect((await open("/work/readme.md:5"))._tag).toBe("Failure");
  expect(state.run).not.toHaveBeenCalled();

  state.allowed.add(secondary);
  expect(await open("/work/readme.md:5")).toMatchObject({ _tag: "Success", value: "vscode" });
  expect(state.run).toHaveBeenCalledExactlyOnceWith({
    environmentId: secondary,
    input: { cwd: "/work/readme.md:5", editor: "vscode" },
  });
  expect(state.setPreference).toHaveBeenCalledTimes(1);
});

it.each(["read", "write"] as const)(
  "opens an available editor when its preference %s fails",
  async (operation) => {
    state.allowed.add(secondary);
    const preference = operation === "read" ? state.getPreference : state.setPreference;
    preference.mockImplementationOnce(() => {
      throw new Error("Preference storage unavailable");
    });
    using _warnings = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const open = useOpenInPreferredEditor(secondary, ["vscode"]);
    await expect(open("/work/readme.md:5")).resolves.toMatchObject({
      _tag: "Success",
      value: "vscode",
    });
    expect(state.run).toHaveBeenCalledExactlyOnceWith({
      environmentId: secondary,
      input: { cwd: "/work/readme.md:5", editor: "vscode" },
    });
  },
);

it.each([
  ["file:///work/read%20me.md", "/work/read me.md", {}],
  [
    "file://foreign/share/read%20me.md:12#L5",
    String.raw`\\foreign\share\read me.md:12`,
    { line: 5 },
  ],
  ["file:///work/report.txt:12", "/work/report.txt:12", {}],
  ["file:///work/report.txt:12#L5C3", "/work/report.txt:12", { line: 5, column: 3 }],
])(
  "sends a plain exact path for %s to compatible and older servers",
  async (uri, cwd, position) => {
    state.allowed.add(secondary);
    const open = useOpenInPreferredEditor(secondary, ["vscode"]);
    await open(uri);
    expect(state.run).toHaveBeenCalledExactlyOnceWith({
      environmentId: secondary,
      input: { cwd, position, editor: "vscode" },
    });
  },
);
