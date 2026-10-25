import { describe, expect, it } from "vite-plus/test";
import { formatGermanTimestamp } from "./timestampFormat";

describe("formatGermanTimestamp", () => {
  it("uses German weekdays and padded local date/time without a comma before the time", () => {
    expect(formatGermanTimestamp(new Date(2026, 9, 20, 11, 4).toISOString())).toBe(
      "Dienstag, 20.10.2026 11:04",
    );
    expect(formatGermanTimestamp(new Date(2027, 0, 3, 0, 9).toISOString())).toBe(
      "Sonntag, 03.01.2027 00:09",
    );
  });

  it("does not invent a timestamp for an invalid date", () => {
    expect(formatGermanTimestamp("not a date")).toBe("");
  });
});
