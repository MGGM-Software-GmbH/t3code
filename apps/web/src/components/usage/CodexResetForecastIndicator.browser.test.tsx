import { RegistryContext } from "@effect/atom-react";
import {
  CodexResetForecastError,
  EnvironmentId,
  type CodexResetForecast,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { type ButtonHTMLAttributes, type ReactNode } from "react";
import { act, render as renderScreen, type Screen } from "../../../test/render";
type Root = { render: Screen["rerender"]; unmount: Screen["unmount"] };
import { expect, it, vi } from "vite-plus/test";

const actions = vi.hoisted(() => ({ touch: false, openExternal: vi.fn() }));
vi.mock("../../hooks/useMediaQuery", () => ({ useMediaQuery: () => actions.touch }));
vi.mock("../../localApi", () => ({
  ensureLocalApi: () => ({ shell: { openExternal: actions.openExternal } }),
}));
vi.mock("../../state/primaryEnvironment", async () => {
  const { Atom } = await import("effect/reactivity");
  return { primaryEnvironmentIdAtom: Atom.make("forecast-test") };
});
vi.mock("../../state/server", async () => {
  const { Atom, AsyncResult } = await import("effect/reactivity");
  const result = Atom.make(AsyncResult.initial());
  return { serverEnvironment: { codexResetForecast: () => result } };
});
vi.mock("../ui/sidebar", () => ({
  SidebarMenuItem: ({ children }: { children: ReactNode }) => <li>{children}</li>,
  SidebarMenuButton: ({
    size: _size,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { size: string }) => <button {...props} />,
}));

import { serverEnvironment } from "../../state/server";
import { CodexResetForecastIndicator } from "./CodexResetForecastIndicator";

const forecast: CodexResetForecast = {
  generatedAt: "2026-10-19T20:35:50.070Z",
  lastResetAt: "2026-10-19T18:18:00.000Z",
  next24Hours: { probability: 0.302, low: 0.145, high: 0.505 },
  nearTerm: { hours: 6, probability: 0.114, low: 0.046, high: 0.232 },
};

const resultAtom = serverEnvironment.codexResetForecast({
  environmentId: EnvironmentId.make("forecast-test"),
  input: {},
});

it("labels the gauge as a forecast and explains both horizons and uncertainty on focus", async () => {
  await using test = await setup();
  const { container, render } = test;
  await render();
  expect(container.querySelector("button")?.getAttribute("aria-label")).toBe(
    "Codex reset forecast: 30% chance in 24 hours",
  );
  await act(async () => {
    container.querySelector("button")!.focus();
    await vi.advanceTimersByTimeAsync(1000);
  });
  const text = document.body.textContent;
  expect(text).toContain("Codex reset forecast");
  expect(text).toContain("Statistical estimate, not a guaranteed reset.");
  expect(text).toContain("30.2%");
  expect(text).toContain("11.4%");
  expect(text).toContain("14.5% to 50.5%");
  expect(text).toContain("Separate from your regular account reset.");
  expect(text).toContain("Forecast from");
  expect(text).toContain("Updated every 60 minutes.");
  expect(fetch).not.toHaveBeenCalled();
});

it("opens LunarWerx directly on a desktop click", async () => {
  await using test = await setup();
  const { container, render } = test;
  await render();
  await act(async () => container.querySelector("button")!.click());
  expect(actions.openExternal).toHaveBeenCalledExactlyOnceWith("https://codex.lunarwerx.com/");
});

it("shows the last reset's age and German timestamp without a new request", async () => {
  await using test = await setup();
  const { container, render } = test;
  actions.touch = true;
  await render();
  await act(async () => container.querySelector("button")!.click());
  const popup = document.querySelector('[data-slot="popover-popup"]')!;
  expect(popup.textContent).toContain("Time since last reset: 2h 17m");
  const reset = popup.querySelector(`time[datetime="${forecast.lastResetAt}"]`)!;
  const local = new Date(forecast.lastResetAt!);
  expect(reset.textContent).toBe(
    `Montag, 19.10.2026 ${String(local.getHours()).padStart(2, "0")}:${String(local.getMinutes()).padStart(2, "0")}`,
  );
  expect(reset.closest(".text-success-foreground")).not.toBeNull();
  expect(popup.querySelector(`time[datetime="${forecast.generatedAt}"]`)?.textContent).toMatch(
    /^Montag, 19\.10\.2026 \d{2}:\d{2}$/,
  );
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(popup.textContent).toContain("Time since last reset: 2h 18m");
  expect(fetch).not.toHaveBeenCalled();
});

it("removes the recent-reset highlight at eight hours using the local minute clock", async () => {
  await using test = await setup();
  const { container, render } = test;
  actions.touch = true;
  await render(AsyncResult.success({ ...forecast, lastResetAt: "2026-10-19T12:36:00.000Z" }));
  await act(async () => container.querySelector("button")!.click());
  const popup = document.querySelector('[data-slot="popover-popup"]')!;
  const reset = popup.querySelector('time[datetime="2026-10-19T12:36:00.000Z"]')!;
  expect(popup.textContent).toContain("Time since last reset: 7h 59m");
  expect(reset.closest(".text-success-foreground")).not.toBeNull();
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(popup.textContent).toContain("Time since last reset: 8h 0m");
  expect(reset.closest(".text-success-foreground")).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});

it.each([null, undefined])("identifies an unreported last reset (%s)", async (lastResetAt) => {
  await using test = await setup();
  const { container, render } = test;
  actions.touch = true;
  const { lastResetAt: _reported, ...withoutReset } = forecast;
  await render(
    AsyncResult.success(lastResetAt === undefined ? withoutReset : { ...forecast, lastResetAt }),
  );
  await act(async () => container.querySelector("button")!.click());
  const popup = document.querySelector('[data-slot="popover-popup"]')!;
  expect(popup.textContent).toContain("Last reset: not reported");
  expect(popup.querySelector(".text-success-foreground")).toBeNull();
  expect(popup.textContent).toContain("30.2%");
});

it("opens touch details before following the source action", async () => {
  await using test = await setup();
  const { container, render } = test;
  actions.touch = true;
  await render();
  await act(async () => {
    container.querySelector("button")!.click();
    await vi.advanceTimersByTimeAsync(1000);
  });
  const popup = document.querySelector('[data-slot="popover-popup"]');
  expect(popup?.textContent).toContain("Statistical estimate, not a guaranteed reset.");
  expect(actions.openExternal).not.toHaveBeenCalled();
  await act(async () =>
    [...popup!.querySelectorAll("button")]
      .find((button) => button.textContent === "Open Codex Forecast")!
      .click(),
  );
  expect(actions.openExternal).toHaveBeenCalledExactlyOnceWith("https://codex.lunarwerx.com/");
  expect(fetch).not.toHaveBeenCalled();
});

it("shows an unavailable estimate instead of keeping a previously successful percentage", async () => {
  await using test = await setup();
  const { container, registry, render } = test;
  actions.touch = true;
  await render();
  await act(async () =>
    registry.set(
      resultAtom as Atom.Writable<unknown>,
      AsyncResult.failure(Cause.fail(new CodexResetForecastError({ reason: "stale" }))),
    ),
  );
  expect(container.querySelector("button")?.getAttribute("aria-label")).toBe(
    "Codex reset forecast: unavailable",
  );
  expect(container.textContent).toBe("?");
  await act(async () => {
    container.querySelector("button")!.click();
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(document.body.textContent).toContain("Forecast unavailable.");
  expect(document.body.textContent).not.toContain("30.2%");
});

async function setup() {
  let root: Root;
  let container: HTMLDivElement;
  let registry: AtomRegistry.AtomRegistry;
  async function render(result = AsyncResult.success(forecast)) {
    registry.set(resultAtom as Atom.Writable<unknown>, result);
    await act(async () =>
      root.render(
        <RegistryContext.Provider value={registry}>
          <ul>
            <CodexResetForecastIndicator />
          </ul>
        </RegistryContext.Provider>,
      ),
    );
  }

  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-19T20:35:00.000Z"));
  actions.touch = false;
  actions.openExternal.mockReset();
  vi.spyOn(globalThis, "fetch").mockRejectedValue(
    new Error("Indicators must not request providers or LunarWerx directly"),
  );
  registry = AtomRegistry.make();
  container = document.createElement("div");
  document.body.append(container);
  // These isolated controls use mocked navigation and no route context.
  const screen = await renderScreen(null, { container, router: false });
  root = { render: screen.rerender, unmount: screen.unmount };

  return {
    container,
    registry,
    render,
    async [Symbol.asyncDispose]() {
      await screen[Symbol.asyncDispose]();
      registry.dispose();
      vi.useRealTimers();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    },
  };
}
