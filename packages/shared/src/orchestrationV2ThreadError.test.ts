import { describe, expect, it } from "vite-plus/test";

import { modelCapacityRetryAt } from "./orchestrationV2ThreadError.ts";

describe("modelCapacityRetryAt", () => {
  it("anchors the five-minute retry to the failed run", () => {
    expect(modelCapacityRetryAt(Date.parse("2026-10-19T08:00:00.000Z"), 5)).toBe(
      "2026-10-19T08:05:00.000Z",
    );
  });

  it.each([0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "does not schedule with invalid delay %s",
    (delay) => {
      expect(modelCapacityRetryAt(Date.parse("2026-10-19T08:00:00.000Z"), delay)).toBeNull();
    },
  );

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_VALUE])(
    "does not schedule with invalid timestamp %s",
    (timestamp) => {
      expect(modelCapacityRetryAt(timestamp, 5)).toBeNull();
    },
  );
});
