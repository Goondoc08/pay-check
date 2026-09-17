import { describe, expect, it } from "vitest";
import fy26Raw from "../data/fy26.json";
import { parsePayYear } from "../data/schema";
import { computePeriod } from "./period";
import type { HourBlock, Profile } from "./types";

/**
 * Rung two of the parity ladder (docs/BUILD_PLAN.md §5): the engine against
 * REAL paychecks, not against the workbook. These are the checks that
 * actually corrected the engine — each one caught a rule the build plan had
 * recorded backwards.
 *
 * Only hours, rates and dollar amounts live here. No names, employee
 * numbers, bank details or withholding figures from the source documents.
 */
describe("paystub parity — real checks", () => {
  const year = parsePayYear(fy26Raw);

  function profile(hourlyRate: number, longevityAnnual: number): Profile {
    return {
      shift: "A",
      track: "shift",
      fridayGroup: null,
      rateSegments: [
        {
          effectiveFrom: year.effectiveFrom,
          hourlyRate,
          incentiveTotal: 0, // rate passed in already all-in
        },
      ],
      longevityAnnual,
    };
  }

  it("plain OT period, 2026-08-01..14: 112 hrs with 6 hrs OT", () => {
    // The check that exposed the missing longevity term. Base 35.3302 +
    // certs 3.0906 = 38.4208 all-in; longevity payoff 284.00.
    //   sheet total : 4418.68
    //   real check  : 4418.69  (payroll rounds RG and FLSA separately)
    // Without the longevity term the engine returned 4418.39 — $0.30 light.
    const rate = 35.3302 + 3.0906;
    const blocks: HourBlock[] = [
      { date: "2026-08-02", type: "regular", hours: 16, destination: "cash" },
      { date: "2026-08-04", type: "regular", hours: 24, destination: "cash" },
      { date: "2026-08-05", type: "regular", hours: 24, destination: "cash" },
      { date: "2026-08-10", type: "regular", hours: 24, destination: "cash" },
      { date: "2026-08-11", type: "regular", hours: 24, destination: "cash" },
    ];

    const result = computePeriod(year, profile(rate, 284), blocks);
    expect(result.totalHours).toBe(112);
    expect(result.otHours).toBe(6);
    expect(result.gross).toBeCloseTo(4418.68, 2);
  });

  it("Christmas period, 2025-12-20..2026-01-02: 106 RG + 36 HW", () => {
    // The check that exposed the holiday model. The stub shows RG 106.0000 =
    // $4050.75 and HW 36.0000 = $2063.58, and Gross Pay = exactly their sum,
    // $6114.33. Both codes price off the SAME rate, and the HW hours are
    // also inside RG — proving HW is a 1.5x adder, not a replacement.
    //
    // Hours below are the timecard's own D/O (duty-on) lines, which sum to
    // exactly the 106 RG hours:
    //   12/20 = 10  (that shift's other 14 hrs were Comp Earned, banked at
    //                1.5x -> the stub's COMP earned 21.0000)
    //   12/25, 12/26, 12/31, 1/1 = 24 each
    // Four holidays fall in the window. 12/24 has a Holiday line but no D/O
    // line — unworked, and banked rather than paid (HA-HOLIDAY ACCRUED
    // earned 12.0000), so it produces no HO block here. The other three were
    // worked, giving HW 36.0000.
    const rate = 4050.75 / 106;
    const workedDay = (date: string, hours: number): HourBlock => ({
      date,
      type: "regular",
      hours,
      destination: "cash",
    });
    const holidayWorked = (date: string): HourBlock => ({
      date,
      type: "holidayWorked",
      hours: 12,
      destination: "cash",
    });
    const blocks: HourBlock[] = [
      workedDay("2025-12-20", 10),
      workedDay("2025-12-25", 24),
      workedDay("2025-12-26", 24),
      workedDay("2025-12-31", 24),
      workedDay("2026-01-01", 24),
      holidayWorked("2025-12-25"),
      holidayWorked("2025-12-31"),
      holidayWorked("2026-01-01"),
    ];

    const result = computePeriod(year, profile(rate, 284), blocks);
    expect(result.totalHours).toBe(106);
    expect(result.otHours).toBe(0);

    // Payroll rounds each line to the cent before summing, so compare that
    // way rather than against the engine's single unrounded total (which
    // lands at 6114.3396 — a cent high purely from deferred rounding).
    const cents = (x: number) => Math.round(x * 100) / 100;
    const sumRounded = (label: string) =>
      result.lineItems
        .filter((l) => l.label === label)
        .reduce((s, l) => s + cents(l.amount), 0);

    expect(sumRounded("Regular")).toBeCloseTo(4050.75, 2);
    expect(sumRounded("Holiday worked")).toBeCloseTo(2063.58, 2);
    expect(sumRounded("Regular") + sumRounded("Holiday worked")).toBeCloseTo(
      6114.33,
      2,
    );
  });
});
