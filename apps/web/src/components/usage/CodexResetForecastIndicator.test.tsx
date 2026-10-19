// @vitest-environment jsdom
import { RegistryContext } from "@effect/atom-react";
import {
  CodexResetForecastError,
  EnvironmentId,
  type CodexResetForecast,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { act, type ButtonHTMLAttributes, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const actions = vi.hoisted(() => ({ touch: false, openExternal: vi.fn() }));
vi.mock("../../hooks/useSettings", () => ({ usePrimarySettings: () => "24h" }));
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
  next24Hours: { probability: 0.302, low: 0.145, high: 0.505 },
  nearTerm: { hours: 6, probability: 0.114, low: 0.046, high: 0.232 },
};
let root: Root;
let container: HTMLDivElement;
let registry: AtomRegistry.AtomRegistry;
const resultAtom = serverEnvironment.codexResetForecast({
  environmentId: EnvironmentId.make("forecast-test"),
  input: {},
});

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

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  actions.touch = false;
  actions.openExternal.mockReset();
  vi.spyOn(globalThis, "fetch").mockRejectedValue(
    new Error("Indicators must not request providers or LunarWerx directly"),
  );
  registry = AtomRegistry.make();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  registry.dispose();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("labels the gauge as a forecast and explains both horizons and uncertainty on focus", async () => {
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
  await render();
  await act(async () => container.querySelector("button")!.click());
  expect(actions.openExternal).toHaveBeenCalledExactlyOnceWith("https://codex.lunarwerx.com/");
});

it("opens touch details before following the source action", async () => {
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
