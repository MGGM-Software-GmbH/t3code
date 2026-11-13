import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { observeVisibleAnimation } from "./visibleAnimation";

let page = Object.assign(new EventTarget(), { visibilityState: "visible" });
let motion = Object.assign(new EventTarget(), { matches: false });
let observers: TestIntersectionObserver[] = [];
let cleanups: Array<() => void> = [];

class TestIntersectionObserver {
  constructor(private readonly callback: IntersectionObserverCallback) {
    observers.push(this);
  }

  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();

  report(target: Element, isIntersecting: boolean) {
    this.callback(
      [{ target, isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

function animationElement() {
  const properties = new Map<string, string>();
  const element = {
    style: { setProperty: (name: string, value: string) => properties.set(name, value) },
  } as unknown as HTMLElement;
  return {
    element,
    state: () => properties.get("--visible-animation-state"),
    willChange: () => properties.get("--visible-animation-will-change"),
  };
}

function attach(element: HTMLElement, allowReducedMotion = false) {
  const cleanup = observeVisibleAnimation(element, { allowReducedMotion });
  if (cleanup) cleanups.push(cleanup);
  return cleanup;
}

beforeEach(() => {
  page = Object.assign(new EventTarget(), { visibilityState: "visible" });
  motion = Object.assign(new EventTarget(), { matches: false });
  observers = [];
  cleanups = [];
  vi.stubGlobal("document", page);
  vi.stubGlobal("window", { matchMedia: () => motion });
  vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
});

afterEach(() => {
  for (const cleanup of cleanups) cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("observeVisibleAnimation", () => {
  it.each([false, true])(
    "keeps explicit progress moving when reduced motion starts as %s, while pausing hidden progress",
    (initiallyReduced) => {
      motion.matches = initiallyReduced;
      const progress = animationElement();
      const decorative = animationElement();
      attach(progress.element, true);
      attach(decorative.element);
      const observer = observers[0]!;
      observer.report(progress.element, true);
      observer.report(decorative.element, true);
      expect(progress.state()).toBe("running");
      expect(decorative.state()).toBe(initiallyReduced ? "paused" : "running");

      motion.matches = true;
      motion.dispatchEvent(new Event("change"));
      expect(progress.state()).toBe("running");
      expect(decorative.state()).toBe("paused");

      page.visibilityState = "hidden";
      page.dispatchEvent(new Event("visibilitychange"));
      expect(progress.state()).toBe("paused");
      expect(progress.willChange()).toBe("auto");
      page.visibilityState = "visible";
      page.dispatchEvent(new Event("visibilitychange"));
      expect(progress.state()).toBe("running");
      observer.report(progress.element, false);
      expect(progress.state()).toBe("paused");
      observer.report(progress.element, true);
      expect(progress.state()).toBe("running");

      motion.matches = false;
      motion.dispatchEvent(new Event("change"));
      expect(progress.state()).toBe("running");
      expect(decorative.state()).toBe("running");
    },
  );
});
