// @vitest-environment jsdom
import { RegistryContext } from "@effect/atom-react";
import {
  EnvironmentId,
  PdSecretsLoginInput,
  PdSecretsError,
  PdSecretsRespondInput,
  type PdSecretsStatus,
} from "@t3tools/contracts";
import { Atom, AtomRegistry, AsyncResult } from "effect/reactivity";
import * as Redacted from "effect/Redacted";
import * as Cause from "effect/Cause";
import { act, type ButtonHTMLAttributes, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const actions = vi.hoisted(() => ({
  login: vi.fn(),
  respond: vi.fn(),
  cancel: vi.fn(),
  toast: vi.fn(),
  statuses: new Map<string, string>(),
  failures: new Set<string>(),
  statusCalls: vi.fn(),
}));
vi.mock("../../state/presentation", async () => {
  const { Atom } = await import("effect/reactivity");
  return { environmentPresentations: { presentationsAtom: Atom.make(new Map()) } };
});
vi.mock("../../state/server", async () => {
  const { Atom, AsyncResult } = await import("effect/reactivity");
  const Cause = await import("effect/Cause");
  const status = Atom.family((id: string) =>
    Atom.make(() => {
      actions.statusCalls(id);
      if (actions.failures.has(id))
        return AsyncResult.failure(Cause.fail(new Error("Unsupported pd-secrets RPC")));
      return AsyncResult.success({
        state: (actions.statuses.get(id) ?? "not-installed") as PdSecretsStatus["state"],
      });
    }),
  );
  const allowed = Atom.family((_id: string) => Atom.make(true));
  return {
    serverEnvironment: {
      pdSecretsStatus: ({ environmentId }: { environmentId: string }) => status(environmentId),
      loginPdSecrets: { run: actions.login, permissionAtom: allowed },
      respondPdSecrets: { run: actions.respond },
      cancelPdSecrets: { run: actions.cancel },
    },
  };
});
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (command: { run: unknown }) => command.run,
}));
vi.mock("../ui/toast", () => ({ toastManager: { add: actions.toast } }));
vi.mock("../ui/sidebar", () => ({
  SidebarMenuItem: ({ children }: { children: ReactNode }) => <li>{children}</li>,
  SidebarMenuButton: ({
    size: _size,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { size: string }) => <button {...props} />,
}));

import { environmentPresentations } from "../../state/presentation";
import { serverEnvironment } from "../../state/server";
import { PdSecretsControl, PdSecretsProvider } from "./PdSecretsControl";

const wsl = EnvironmentId.make("wsl");
const dgx = EnvironmentId.make("dgx");
let root: Root;
let container: HTMLDivElement;
let registry: AtomRegistry.AtomRegistry;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  actions.login.mockReset();
  actions.respond.mockReset();
  actions.toast.mockReset();
  actions.statuses.clear();
  actions.failures.clear();
  actions.statusCalls.mockClear();
  actions.cancel.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  registry = AtomRegistry.make();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  registry.set(
    environmentPresentations.presentationsAtom as Atom.Writable<unknown>,
    new Map([
      [wsl, presentation("WSL test")],
      [dgx, presentation("DGX test")],
    ]),
  );
});

const presentation = (label: string, supportsPdSecrets = true) => ({
  connection: { phase: "connected" },
  entry: { target: { label } },
  serverConfig: { environment: { capabilities: supportsPdSecrets ? { pdSecrets: true } : {} } },
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  registry.dispose();
  vi.unstubAllGlobals();
});

const setStatus = (id: EnvironmentId, state: PdSecretsStatus["state"]) => {
  actions.statuses.set(id, state);
  registry.refresh(serverEnvironment.pdSecretsStatus({ environmentId: id, input: {} }));
};
const render = async (withControl = true) =>
  act(async () =>
    root.render(
      <RegistryContext.Provider value={registry}>
        <PdSecretsProvider>
          {withControl ? (
            <ul>
              <PdSecretsControl />
            </ul>
          ) : null}
        </PdSecretsProvider>
      </RegistryContext.Provider>,
    ),
  );
const credential = () => document.querySelector<HTMLInputElement>("#pd-secrets-credential")!;
const enter = async (value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      credential(),
      value,
    );
    credential().dispatchEvent(new Event("input", { bubbles: true }));
  });
const submit = async () =>
  act(async () => {
    credential().form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent === label,
  )!;

it("hides both control and dialog when no connected environment has pd-secrets", async () => {
  await render();
  expect(container.querySelector("button")).toBeNull();
  expect(document.querySelector("#pd-secrets-credential")).toBeNull();
});

it("checks the installed host without sending unsupported RPCs to an older connected host", async () => {
  actions.statuses.set(wsl, "connected");
  actions.failures.add(dgx);
  registry.set(
    environmentPresentations.presentationsAtom as Atom.Writable<unknown>,
    new Map([
      [wsl, presentation("WSL test")],
      [dgx, presentation("DGX test", false)],
    ]),
  );
  await render();
  const control = container.querySelector<HTMLButtonElement>("button")!;
  expect(control.getAttribute("aria-label")).toBe("pd-secrets: connected");
  await act(async () => control.click());
  expect(actions.toast).toHaveBeenCalledWith({ type: "success", title: "pd-secrets is connected" });
  expect(actions.statusCalls).not.toHaveBeenCalledWith(dgx);
});

it("reports a real status error from a host that supports pd-secrets", async () => {
  setStatus(wsl, "connected");
  await render();
  actions.failures.add(wsl);
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  expect(actions.toast).toHaveBeenCalledWith({
    type: "error",
    title: "Could not check pd-secrets",
  });
  expect(actions.toast).not.toHaveBeenCalledWith(expect.objectContaining({ type: "success" }));
});

it("prompts for the installed host even when the sidebar control is unmounted", async () => {
  setStatus(dgx, "disconnected");
  await render(false);
  expect(document.body.textContent).toContain("DGX test");
  expect(credential()).not.toBeNull();
  const cancel = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === "Cancel",
  )!;
  await act(async () => cancel.click());
  expect(actions.cancel).toHaveBeenCalledWith({ environmentId: dgx, input: {} });
  expect(credential()).toBeNull();
  await act(async () => setStatus(dgx, "connected"));
  await act(async () => setStatus(dgx, "disconnected"));
  expect(credential()).not.toBeNull();
});

it("keeps sign-in unavailable for a session without maintenance permission", async () => {
  setStatus(dgx, "disconnected");
  registry.set(
    serverEnvironment.loginPdSecrets.permissionAtom(dgx) as Atom.Writable<unknown>,
    false,
  );
  await render();
  expect(credential()).toBeNull();
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  expect(actions.toast).toHaveBeenCalledWith(
    expect.objectContaining({ description: "This session cannot manage environment credentials." }),
  );
  expect(actions.login).not.toHaveBeenCalled();
});

it("submits redacted password and TOTP to the selected environment, then closes on success", async () => {
  setStatus(dgx, "disconnected");
  actions.login.mockImplementation(({ environmentId, input }) => {
    expect(environmentId).toBe(dgx);
    expect(Redacted.value(PdSecretsLoginInput.make(input).password)).toBe("synthetic-password");
    return AsyncResult.success({ phase: "totp", flowId: "test-flow" });
  });
  actions.respond.mockImplementation(({ environmentId, input }) => {
    expect(environmentId).toBe(dgx);
    expect(Redacted.value(PdSecretsRespondInput.make(input).code)).toBe("123456");
    setStatus(dgx, "connected");
    return AsyncResult.success({ phase: "connected" });
  });
  await render();
  await enter("synthetic-password");
  await submit();
  expect(document.body.textContent).toContain("TOTP code");
  expect(credential().value).toBe("");
  expect(credential().type).toBe("text");
  expect(credential().autocomplete).toBe("one-time-code");
  expect(credential().hasAttribute("data-pd-ignore")).toBe(true);
  expect(credential().form!.hasAttribute("data-pd-ignore")).toBe(true);
  await enter("123456");
  await submit();
  expect(credential()).toBeNull();
  expect(actions.toast).toHaveBeenCalledWith({
    type: "success",
    title: "pd-secrets is connected on DGX test",
  });
});

it("keeps the dialog pending until setup ends and exposes a script failure without a success toast", async () => {
  setStatus(dgx, "disconnected");
  let finish!: (result: ReturnType<typeof AsyncResult.failure>) => void;
  actions.login.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render();
  await enter("synthetic-password");
  await submit();
  expect(document.body.textContent).toContain("Signing in and completing setup");
  expect(credential()).toBeNull();
  expect(document.querySelector('[role="status"][aria-busy="true"]')).not.toBeNull();
  expect(document.querySelector('[role="status"] svg')).not.toBeNull();
  expect(button("Continue in background")).toBeDefined();
  await act(async () => {
    finish(AsyncResult.failure(Cause.fail(new PdSecretsError({ reason: "post_login_failed" }))));
  });
  expect(document.body.textContent).toContain(
    "pd-secrets is connected, but the post-login script failed",
  );
  expect(actions.toast).not.toHaveBeenCalledWith(expect.objectContaining({ type: "success" }));
  expect(credential().value).toBe("");
  expect(document.querySelector('[role="status"][aria-busy="true"]')).toBeNull();
  expect(document.querySelector('[role="status"] svg')).toBeNull();
});

it("keeps a hidden login running and reopens the dialog when TOTP is required", async () => {
  setStatus(dgx, "disconnected");
  let finish!: (result: ReturnType<typeof AsyncResult.success>) => void;
  actions.login.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render();
  expect(credential().hasAttribute("data-pd-ignore")).toBe(true);
  await enter("synthetic-password");
  await submit();
  await act(async () => button("Continue in background").click());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(actions.cancel).not.toHaveBeenCalled();
  await act(async () => finish(AsyncResult.success({ phase: "totp", flowId: "test-flow" })));
  expect(document.body.textContent).toContain("TOTP code");
  expect(credential().value).toBe("");
  expect(actions.cancel).not.toHaveBeenCalled();
});

it("can reopen a running background verification without starting another request", async () => {
  setStatus(dgx, "disconnected");
  actions.login.mockResolvedValue(AsyncResult.success({ phase: "totp", flowId: "test-flow" }));
  let finish!: (result: ReturnType<typeof AsyncResult.success>) => void;
  actions.respond.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render();
  await enter("synthetic-password");
  await submit();
  await enter("123456");
  await submit();
  expect(credential()).toBeNull();
  await act(async () => button("Continue in background").click());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(actions.cancel).not.toHaveBeenCalled();
  const control = container.querySelector<HTMLButtonElement>("button")!;
  expect(control.disabled).toBe(false);
  expect(control.getAttribute("aria-label")).toBe("pd-secrets: signing in");
  await act(async () => control.click());
  expect(document.querySelector('[role="status"][aria-busy="true"]')).not.toBeNull();
  expect(credential()).toBeNull();
  await act(async () => button("Continue in background").click());
  await act(async () => {
    setStatus(dgx, "connected");
    finish(AsyncResult.success({ phase: "connected" }));
  });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(actions.login).toHaveBeenCalledTimes(1);
  expect(actions.respond).toHaveBeenCalledTimes(1);
  expect(actions.toast).toHaveBeenCalledWith({
    type: "success",
    title: "pd-secrets is connected on DGX test",
  });
});

it.each(["login_failed", "post_login_failed"] as const)(
  "reports a background %s in a toast without reopening the credential form",
  async (reason) => {
    setStatus(dgx, "disconnected");
    let finish!: (result: ReturnType<typeof AsyncResult.failure>) => void;
    actions.login.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await render();
    await enter("synthetic-password");
    await submit();
    await act(async () => button("Continue in background").click());
    expect(actions.cancel).not.toHaveBeenCalled();
    await act(async () => finish(AsyncResult.failure(Cause.fail(new PdSecretsError({ reason })))));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(credential()).toBeNull();
    expect(actions.toast).toHaveBeenCalledWith({
      type: "error",
      title: "Could not sign in to pd-secrets on DGX test",
      description: new PdSecretsError({ reason }).message,
    });
    expect(actions.toast).not.toHaveBeenCalledWith(expect.objectContaining({ type: "success" }));
    actions.login.mockResolvedValue(AsyncResult.success({ phase: "totp", flowId: "retry-flow" }));
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
    expect(credential().value).toBe("");
  },
);

it("cancels a pending verification only when Cancel is explicitly selected", async () => {
  setStatus(dgx, "disconnected");
  actions.login.mockResolvedValue(AsyncResult.success({ phase: "totp", flowId: "test-flow" }));
  let finish!: (result: ReturnType<typeof AsyncResult.success>) => void;
  actions.respond.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render();
  await enter("synthetic-password");
  await submit();
  await enter("123456");
  await submit();
  await act(async () => button("Cancel").click());
  expect(actions.cancel).toHaveBeenCalledWith({ environmentId: dgx, input: {} });
  await act(async () => finish(AsyncResult.success({ phase: "connected" })));
  expect(credential()).toBeNull();
  expect(actions.toast).not.toHaveBeenCalled();
});

it("continues a pending login when the dialog is closed with its close button", async () => {
  setStatus(dgx, "disconnected");
  let finish!: (result: ReturnType<typeof AsyncResult.success>) => void;
  actions.login.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render();
  await enter("synthetic-password");
  await submit();
  await act(async () =>
    document.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click(),
  );
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(actions.cancel).not.toHaveBeenCalled();
  await act(async () => {
    setStatus(dgx, "connected");
    finish(AsyncResult.success({ phase: "connected" }));
  });
  expect(actions.toast).toHaveBeenCalledWith({
    type: "success",
    title: "pd-secrets is connected on DGX test",
  });
});

it("reports an environment disconnect during background sign-in and ignores its stale result", async () => {
  setStatus(dgx, "disconnected");
  let finish!: (result: ReturnType<typeof AsyncResult.success>) => void;
  actions.login.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render();
  await enter("synthetic-password");
  await submit();
  await act(async () => button("Continue in background").click());
  await act(async () =>
    registry.set(
      environmentPresentations.presentationsAtom as Atom.Writable<unknown>,
      new Map([[wsl, presentation("WSL test")]]),
    ),
  );
  expect(actions.cancel).toHaveBeenCalledWith({ environmentId: dgx, input: {} });
  expect(actions.toast).toHaveBeenCalledWith({
    type: "error",
    title: "pd-secrets sign-in interrupted on DGX test",
    description: "The environment disconnected.",
  });
  await act(async () => finish(AsyncResult.success({ phase: "connected" })));
  expect(credential()).toBeNull();
  expect(actions.toast).not.toHaveBeenCalledWith(expect.objectContaining({ type: "success" }));
});
