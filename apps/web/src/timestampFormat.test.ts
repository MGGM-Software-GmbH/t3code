import { describe, expect, it } from "vite-plus/test";

import { formatDayAwareTimestamp, formatUpcomingTimestamp } from "./timestampFormat";

describe("timestamps in an explicit time zone", () => {
  // 23:00 UTC on July 1 is 7 PM on July 1 in New York, whatever the host zone.
  const now = Date.parse("2026-07-01T23:00:00.000Z");
  const zone = "America/New_York";

  it("picks relative days from the calendar in that zone", () => {
    expect(formatUpcomingTimestamp("2026-07-02T00:30:00.000Z", "12-hour", now, zone)).not.toMatch(
      /tomorrow/,
    );
    expect(formatUpcomingTimestamp("2026-07-02T05:30:00.000Z", "12-hour", now, zone)).toMatch(
      /^tomorrow at /,
    );
    expect(formatDayAwareTimestamp("2026-07-01T03:30:00.000Z", "12-hour", now, zone)).toMatch(
      /^yesterday at /,
    );
  });
});

import { formatGermanTimestamp } from "./timestampFormat";

describe("formatGermanTimestamp", () => {
  it("uses German weekdays and padded local date/time without a comma before the time", () => {
    expect(formatGermanTimestamp(new Date(2026, 9, 20, 11, 4).toISOString())).toBe(
      "Dienstag, 20.10.2026 11:04",
    );
    expect(formatGermanTimestamp(new Date(2027, 0, 3, 0, 9).toISOString())).toBe(
      "Sonntag, 03.01.2027 00:09",
    );
    expect(
      formatGermanTimestamp(new Date(2027, 0, 3, 0, 9).toISOString(), { includeWeekday: false }),
    ).toBe("03.01.2027 00:09");
  });

  it("does not invent a timestamp for an invalid date", () => {
    expect(formatGermanTimestamp("not a date")).toBe("");
  });
});
