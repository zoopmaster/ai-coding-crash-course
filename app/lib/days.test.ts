import { describe, it, expect } from "vitest";
import { daysExcludingSundays } from "./days";

// Local-time constructors keep these tests independent of the machine's time
// zone. November 2026: Sun 15, Mon 16, ... Sat 21, Sun 22, Mon 23.
const at = (day: number, hour = 12) => new Date(2026, 10, day, hour);

describe("daysExcludingSundays", () => {
  it("is zero within the same calendar day", () => {
    expect(daysExcludingSundays(at(17, 1), at(17, 23))).toBe(0);
  });

  it("counts calendar days, not 24-hour periods", () => {
    expect(daysExcludingSundays(at(17, 23), at(18, 1))).toBe(1);
  });

  it("counts weekdays and Saturdays", () => {
    // Mon 16 → Sat 21: Tue, Wed, Thu, Fri, Sat
    expect(daysExcludingSundays(at(16), at(21))).toBe(5);
  });

  it("skips a Sunday in the middle of the range", () => {
    // Sat 14 → Mon 16: Sunday skipped, Monday counts
    expect(daysExcludingSundays(at(14), at(16))).toBe(1);
    // Fri 20 → Tue 24: Sat, Mon, Tue
    expect(daysExcludingSundays(at(20), at(24))).toBe(3);
  });

  it("does not count a Sunday the range ends on", () => {
    // Sat 21 → Sun 22
    expect(daysExcludingSundays(at(21), at(22))).toBe(0);
  });

  it("counts from a Sunday start without counting the Sunday", () => {
    // Sun 15 → Wed 18: Mon, Tue, Wed
    expect(daysExcludingSundays(at(15), at(18))).toBe(3);
  });

  it("skips every Sunday across several weeks", () => {
    // Mon 2 → Mon 16: 14 calendar days, two Sundays
    expect(daysExcludingSundays(at(2), at(16))).toBe(12);
  });

  it("accepts ISO strings", () => {
    expect(
      daysExcludingSundays(at(16).toISOString(), at(18).toISOString())
    ).toBe(2);
  });

  it("is never negative", () => {
    expect(daysExcludingSundays(at(18), at(16))).toBe(0);
  });
});
