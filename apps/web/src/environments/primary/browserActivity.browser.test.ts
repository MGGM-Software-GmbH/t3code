import { expect, it, vi } from "vite-plus/test";
import { fakeTimers } from "../../../test/render";
import { trackBrowserSessionActivity } from "./browserActivity";

it("renews on foreground use, batches inputs and stops renewing when idle", () => {
  using _timers = fakeTimers();
  using cleanup = new DisposableStack();
  let visibility: DocumentVisibilityState = "hidden";
  using _visibility = vi
    .spyOn(document, "visibilityState", "get")
    .mockImplementation(() => visibility);
  const report = vi.fn(async () => {});
  cleanup.defer(trackBrowserSessionActivity(report));
  window.dispatchEvent(new Event("keydown"));
  expect(report).not.toHaveBeenCalled();
  visibility = "visible";
  document.dispatchEvent(new Event("visibilitychange"));
  expect(report).toHaveBeenCalledTimes(1);
  window.dispatchEvent(new Event("wheel"));
  window.dispatchEvent(new Event("pointerdown"));
  vi.advanceTimersByTime(60_000);
  expect(report).toHaveBeenCalledTimes(2);
  vi.advanceTimersByTime(5 * 60_000);
  expect(report).toHaveBeenCalledTimes(2);
  window.dispatchEvent(new Event("keydown"));
  expect(report).toHaveBeenCalledTimes(3);
});
