import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";

import { isSameSchedule, nextScheduledRunAt } from "./Schedule.ts";

describe("scheduled task schedule calculation", () => {
  it.each([
    ["2026-11-01T08:00:00Z", 1, "2026-11-04T08:00:00.000Z"],
    ["2026-11-04T08:00:00Z", 1, "2026-12-02T08:00:00.000Z"],
    ["2026-12-03T08:00:00Z", 1, "2027-01-06T08:00:00.000Z"],
    ["2026-11-01T08:00:00Z", 5, "2026-12-30T08:00:00.000Z"],
    ["2026-11-01T08:00:00Z", -1, "2026-11-25T08:00:00.000Z"],
    ["2027-02-01T08:00:00Z", -1, "2027-02-24T08:00:00.000Z"],
    ["2027-03-03T08:00:00Z", 1, "2027-04-07T07:00:00.000Z"],
  ])("finds monthly Wednesday from %s, occurrence %s", (from, weekOfMonth, expected) => {
    const next = nextScheduledRunAt(
      { type: "fixed_time", timeOfDay: "09:00", weekdays: [3], weekOfMonth },
      DateTime.makeZonedUnsafe(from, { timeZone: "Europe/Berlin" }),
    );
    expect(next && DateTime.formatIso(next)).toBe(expected);
  });

  it("skips to the next matching fixed-time weekday", () => {
    const next = nextScheduledRunAt(
      { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 2, 3, 4, 5] },
      DateTime.makeZonedUnsafe(
        {
          year: 2026,
          month: 7,
          day: 3,
          hour: 10,
          minute: 0,
          second: 0,
          millisecond: 0,
        },
        { timeZone: "America/Los_Angeles", adjustForTimeZone: true },
      ),
    );
    const parts = next ? DateTime.toParts(next) : null;
    expect(parts?.weekDay).toBe(1);
    expect(parts?.hour).toBe(9);
    expect(parts?.minute).toBe(0);
  });

  it("compares schedules structurally", () => {
    const monthly = {
      type: "fixed_time",
      timeOfDay: "09:00",
      weekdays: [3],
      weekOfMonth: 1,
    } as const;
    expect(isSameSchedule(monthly, { ...monthly })).toBe(true);
    expect(isSameSchedule(monthly, { ...monthly, weekOfMonth: 2 })).toBe(false);
    expect(isSameSchedule(monthly, { ...monthly, weekOfMonth: null })).toBe(false);
    expect(
      isSameSchedule(
        { ...monthly, weekOfMonth: null },
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [3] },
      ),
    ).toBe(true);
    expect(
      isSameSchedule(
        { type: "once", runAt: "2026-11-01T03:00:00-05:00" },
        { type: "once", runAt: "2026-11-01T08:00:00.000Z" },
      ),
    ).toBe(true);
    expect(
      isSameSchedule({ type: "interval", everyMs: 60_000 }, { type: "interval", everyMs: 60_000 }),
    ).toBe(true);
    expect(
      isSameSchedule({ type: "interval", everyMs: 60_000 }, { type: "interval", everyMs: 30_000 }),
    ).toBe(false);
    expect(
      isSameSchedule(
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 2] },
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 2] },
      ),
    ).toBe(true);
    expect(
      isSameSchedule(
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [5, 1] },
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 5, 5] },
      ),
    ).toBe(true);
    expect(
      isSameSchedule(
        { type: "fixed_time", timeOfDay: "09:00" },
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [0, 1, 2, 3, 4, 5, 6] },
      ),
    ).toBe(true);
    expect(
      isSameSchedule(
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [] },
        { type: "fixed_time", timeOfDay: "09:00" },
      ),
    ).toBe(true);
    expect(
      isSameSchedule(
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 2] },
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 3] },
      ),
    ).toBe(false);
    expect(
      isSameSchedule(
        { type: "fixed_time", timeOfDay: "09:00" },
        { type: "fixed_time", timeOfDay: "09:30" },
      ),
    ).toBe(false);
    expect(
      isSameSchedule(
        { type: "interval", everyMs: 60_000 },
        { type: "fixed_time", timeOfDay: "09:00" },
      ),
    ).toBe(false);
  });
});
