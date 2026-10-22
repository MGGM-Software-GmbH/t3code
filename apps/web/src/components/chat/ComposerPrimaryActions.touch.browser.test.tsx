import { type ComponentProps, type MouseEvent as ReactMouseEvent } from "react";
import { act, render as renderScreen, type Screen } from "../../../test/render";
type Root = { render: Screen["rerender"]; unmount: Screen["unmount"] };
import { expect, it, vi } from "vite-plus/test";

vi.mock("~/hooks/useSettings", () => ({ useEnvironmentIdentificationMode: () => "none" }));
vi.mock("../SidebarStageBackdrop", () => ({
  StageBackdropButtonArt: () => null,
  useSidebarStageBackdropVariant: () => null,
}));

import { ComposerPrimaryActions } from "./ComposerPrimaryActions";

async function pointer(
  button: HTMLButtonElement,
  type: string,
  pointerType = "touch",
  clientX = 10,
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerType: { value: pointerType },
    pointerId: { value: 1 },
    button: { value: 0 },
    clientX: { value: clientX },
    clientY: { value: 10 },
  });
  await act(() => {
    button.dispatchEvent(event);
  });
}

async function click(button: HTMLButtonElement) {
  await act(() => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

it.each(["steer", "queue"] as const)(
  "a touch hold invokes the alternate of %s only once",
  async (followUpBehavior) => {
    await using test = await setup();
    const { submit, alternate, render } = test;
    const button = await render({ followUpBehavior });
    expect(button.getAttribute("aria-label")).toBe(
      followUpBehavior === "steer" ? "Steer message" : "Queue message",
    );
    await pointer(button, "pointerdown");
    await act(() => vi.advanceTimersByTime(549));
    expect(alternate).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTime(1));
    expect(alternate).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTime(1000));
    await pointer(button, "pointerup");
    await click(button);
    expect(alternate).toHaveBeenCalledTimes(1);
    expect(submit).not.toHaveBeenCalled();
  },
);

it("keeps a short tap and the next tap after a hold as the normal action", async () => {
  await using test = await setup();
  const { submit, alternate, render } = test;
  const button = await render();
  await pointer(button, "pointerdown");
  await act(() => vi.advanceTimersByTime(200));
  await pointer(button, "pointerup");
  await click(button);
  expect(submit).toHaveBeenCalledTimes(1);
  expect(alternate).not.toHaveBeenCalled();
  await pointer(button, "pointerdown");
  await act(() => vi.advanceTimersByTime(550));
  await pointer(button, "pointerup");
  await click(button);
  await pointer(button, "pointerdown");
  await pointer(button, "pointerup");
  await click(button);
  expect(submit).toHaveBeenCalledTimes(2);
  expect(alternate).toHaveBeenCalledTimes(1);
});

it.each(["pointercancel", "blur", "move", "unmount", "busy"])(
  "cancels a pending hold on %s",
  async (reason) => {
    await using test = await setup();
    const { submit, alternate, render } = test;
    const button = await render();
    await pointer(button, "pointerdown");
    if (reason === "blur")
      await act(() => {
        window.dispatchEvent(new Event("blur"));
      });
    else if (reason === "move") await pointer(button, "pointermove", "touch", 30);
    else if (reason === "unmount") await act(() => test.root.render(null));
    else if (reason === "busy") await render({ isSendBusy: true });
    else await pointer(button, reason);
    await act(() => vi.advanceTimersByTime(1000));
    expect(alternate).not.toHaveBeenCalled();
    if (reason === "move") {
      await pointer(button, "pointerup");
      await click(button);
      expect(submit).not.toHaveBeenCalled();
    }
  },
);

it.each(["mouse", "pen"])("does not replace a long %s click", async (pointerType) => {
  await using test = await setup();
  const { submit, alternate, render } = test;
  const button = await render();
  await pointer(button, "pointerdown", pointerType);
  await act(() => vi.advanceTimersByTime(1000));
  await pointer(button, "pointerup", pointerType);
  await click(button);
  expect(submit).toHaveBeenCalledTimes(1);
  expect(alternate).not.toHaveBeenCalled();
});

it.each([{ isRunning: false }, { isEditingQueuedMessage: true }, { canOperateThread: false }])(
  "does not send an alternate in state %s",
  async (overrides) => {
    await using test = await setup();
    const { alternate, render } = test;
    const button = await render(overrides);
    await pointer(button, "pointerdown");
    await act(() => vi.advanceTimersByTime(1000));
    expect(alternate).not.toHaveBeenCalled();
  },
);

async function setup() {
  let root: Root;
  let container: HTMLDivElement;
  const submit = vi.fn((event: ReactMouseEvent) => event.preventDefault());
  const alternate = vi.fn();
  const props: ComponentProps<typeof ComposerPrimaryActions> = {
    compact: true,
    canOperateThread: true,
    pendingAction: null,
    isRunning: true,
    canInterrupt: true,
    showPlanFollowUpPrompt: false,
    promptHasText: true,
    isSendBusy: false,
    sendDisabledReason: null,
    isConnecting: false,
    isEnvironmentUnavailable: false,
    isPreparingWorktree: false,
    hasSendableContent: true,
    onSubmitMessage: submit,
    onSubmitAlternateMessage: alternate,
    onPreviousPendingQuestion: () => {},
    onInterrupt: () => {},
    onImplementPlanInNewThread: () => {},
  };
  async function render(overrides: Partial<typeof props> = {}) {
    await act(() => root.render(<ComposerPrimaryActions {...props} {...overrides} />));
    return container.querySelector<HTMLButtonElement>("button")!;
  }

  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.append(container);
  // These isolated controls use mocked navigation and no route context.
  const screen = await renderScreen(null, { container, router: false });
  root = { render: screen.rerender, unmount: screen.unmount };

  return {
    root,
    container,
    submit,
    alternate,
    props,
    render,
    async [Symbol.asyncDispose]() {
      await screen[Symbol.asyncDispose]();
      vi.clearAllMocks();
      vi.unstubAllGlobals();
      vi.useRealTimers();
    },
  };
}
