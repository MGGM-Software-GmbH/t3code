import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { resolveRestingComposerControlsLayout } from "../composerFooterLayout";
import { measureRestingComposerControls } from "./restingComposerControlsMeasurement";

function measurePicker(input: {
  clientWidth: number;
  flexGrow: string;
  maxWidth?: string;
  weeklyLimitWidth?: number;
}) {
  const label = { clientWidth: input.clientWidth, scrollWidth: 160 };
  const picker = {
    getBoundingClientRect: () => ({ width: 52 }),
    querySelector: () => label,
  };
  const controls = {
    querySelector: (selector: string) => {
      if (selector === "[data-chat-provider-model-picker]") return picker;
      if (selector === "[data-resting-controls-overflow]") {
        return { getBoundingClientRect: () => ({ width: 24 }) };
      }
      if (selector === "[data-composer-weekly-limit]" && input.weeklyLimitWidth !== undefined) {
        return { getBoundingClientRect: () => ({ width: input.weeklyLimitWidth }) };
      }
      return null;
    },
    querySelectorAll: () => [
      {
        dataset: {},
        querySelectorAll: () => [],
        getBoundingClientRect: () => ({ width: 140 }),
      },
    ],
  };
  vi.stubGlobal("getComputedStyle", (element: unknown) => {
    if (element === label) return { flexGrow: input.flexGrow };
    if (element === picker) return { minWidth: "52px", maxWidth: input.maxWidth ?? "none" };
    return { columnGap: "4px" };
  });
  return measureRestingComposerControls(controls as unknown as HTMLElement)!;
}

afterEach(() => vi.unstubAllGlobals());

describe("measureRestingComposerControls", () => {
  it("reserves the weekly indicator while access controls move into overflow on narrow screens", () => {
    const measurement = measurePicker({ clientWidth: 0, flexGrow: "0", weeklyLimitWidth: 28 });
    expect(measurement.naturalFixedWidth).toBe(84);
    expect(measurement.minimumFixedWidth).toBe(84);
    expect(resolveRestingComposerControlsLayout({ ...measurement, hostWidth: 200 })).toEqual({
      hiddenCount: 1,
      iconOnlyCount: 1,
      visible: true,
    });
    const wide = resolveRestingComposerControlsLayout({ ...measurement, hostWidth: 240 });
    expect(wide.hiddenCount).toBe(0);
  });
});
