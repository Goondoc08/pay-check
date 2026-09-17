import { describe, expect, it } from "vitest";
import {
  computeAdminPeriod,
  findFridaysInPeriod,
  splitFridayHours,
} from "./adminPeriod";
import type { HourBlock, Profile } from "./types";

// Sat 8/29/2026 .. Fri 9/11/2026 — a real 14-day period from the shared
// pay-period calendar, chosen because it's the exact period a reported
// 9/80 timecard fell in. Two Fridays: 9/4 (first/payday) and 9/11
// (last/period-end).
const period = { n: 27, start: "2026-08-29", end: "2026-09-11" };

function profileFor(
  fridayGroup: "week1" | "week2",
  overrides: Partial<Profile> = {},
): Profile {
  return {
    track: "admin9080",
    shift: null,
    fridayGroup,
    rateSegments: [
      { effectiveFrom: "2026-01-01", hourlyRate: 40, incentiveTotal: 0 },
    ],
    longevityAnnual: 0,
    ...overrides,
  };
}

function regular(date: string, hours: number): HourBlock {
  return { date, type: "regular", hours, destination: "cash" };
}

describe("findFridaysInPeriod", () => {
  it("finds both Fridays of a 14-day period in chronological order", () => {
    expect(findFridaysInPeriod(period)).toEqual(["2026-09-04", "2026-09-11"]);
  });
});

describe("splitFridayHours", () => {
  it("splits the scheduled amount 50/50 with no extra", () => {
    expect(splitFridayHours(8, 8)).toEqual({ am: 4, pm: 4 });
  });
  it("attributes extra hours above scheduled entirely to the PM side", () => {
    expect(splitFridayHours(8, 10)).toEqual({ am: 4, pm: 6 });
  });
  it("an off Friday (0 scheduled) with nothing entered splits to nothing", () => {
    expect(splitFridayHours(0, 0)).toEqual({ am: 0, pm: 0 });
  });
});

describe("computeAdminPeriod", () => {
  it("prices a baseline week1 period as OT-neutral (the whole point of a compliant 9/80)", () => {
    // week1: off first Friday (9/4), works last Friday (9/11).
    const profile = profileFor("week1");
    const thisBlocks: HourBlock[] = [
      regular("2026-08-31", 9),
      regular("2026-09-01", 9),
      regular("2026-09-02", 9),
      regular("2026-09-03", 9),
      // 9/4 off — no block.
      regular("2026-09-07", 9),
      regular("2026-09-08", 9),
      regular("2026-09-09", 9),
      regular("2026-09-10", 9),
      regular("2026-09-11", 8),
    ];
    // Prior period's last Friday (8/28) is a worked day for week1.
    const prevBlocks: HourBlock[] = [regular("2026-08-28", 8)];

    const result = computeAdminPeriod(profile, period, thisBlocks, prevBlocks);

    expect(result.otHours).toBe(0);
    expect(result.totalHours).toBe(80); // 4*9 + 4*9 + 8
    expect(result.gross).toBeCloseTo(80 * 40, 4);
  });

  it("mirrors the same baseline for week2 (off last Friday, works first)", () => {
    const profile = profileFor("week2");
    const thisBlocks: HourBlock[] = [
      regular("2026-08-31", 9),
      regular("2026-09-01", 9),
      regular("2026-09-02", 9),
      regular("2026-09-03", 9),
      regular("2026-09-04", 8),
      regular("2026-09-07", 9),
      regular("2026-09-08", 9),
      regular("2026-09-09", 9),
      regular("2026-09-10", 9),
      // 9/11 off — no block.
    ];
    // Prior period's last Friday (8/28) is OFF for week2 — nothing entered.
    const prevBlocks: HourBlock[] = [];

    const result = computeAdminPeriod(profile, period, thisBlocks, prevBlocks);

    expect(result.otHours).toBe(0);
    expect(result.totalHours).toBe(80);
    expect(result.gross).toBeCloseTo(80 * 40, 4);
  });

  it("extra hours worked on a Mon-Thu day create OT within that same workweek", () => {
    const profile = profileFor("week1");
    const thisBlocks: HourBlock[] = [
      regular("2026-08-31", 9),
      regular("2026-09-01", 9),
      regular("2026-09-02", 9),
      regular("2026-09-03", 9),
      regular("2026-09-07", 9),
      regular("2026-09-08", 13), // 4 extra hours
      regular("2026-09-09", 9),
      regular("2026-09-10", 9),
      regular("2026-09-11", 8),
    ];
    const prevBlocks: HourBlock[] = [regular("2026-08-28", 8)];

    const result = computeAdminPeriod(profile, period, thisBlocks, prevBlocks);

    // Week II = 0 (friday1 off, no PM) + (9+13+9+9=40) + 4 (friday2 AM) = 44
    expect(result.otHours).toBeCloseTo(4, 4);
    const otLine = result.lineItems.find((li) => li.label === "OT premium");
    expect(otLine?.amount).toBeCloseTo(4 * 0.5 * 40, 4);
  });

  it("extra hours worked on the period's LAST Friday don't create OT until next period (PM bleeds forward)", () => {
    const profile = profileFor("week1");
    const thisBlocks: HourBlock[] = [
      regular("2026-08-31", 9),
      regular("2026-09-01", 9),
      regular("2026-09-02", 9),
      regular("2026-09-03", 9),
      regular("2026-09-07", 9),
      regular("2026-09-08", 9),
      regular("2026-09-09", 9),
      regular("2026-09-10", 9),
      regular("2026-09-11", 10), // 2 extra hours on the last Friday
    ];
    const prevBlocks: HourBlock[] = [regular("2026-08-28", 8)];

    const result = computeAdminPeriod(profile, period, thisBlocks, prevBlocks);

    // Week II only sees friday2's AM half (still 4) — the extra 2 hours
    // are in the PM half, which belongs to next period's workweek.
    expect(result.otHours).toBe(0);
  });

  it("sick/PTO hours are paid but don't count toward the 40-hr threshold", () => {
    const profile = profileFor("week1");
    const thisBlocks: HourBlock[] = [
      regular("2026-08-31", 9),
      regular("2026-09-01", 9),
      regular("2026-09-02", 9),
      { date: "2026-09-03", type: "pto", hours: 9 }, // sick day
      regular("2026-09-07", 9),
      regular("2026-09-08", 9),
      regular("2026-09-09", 9),
      regular("2026-09-10", 9),
      regular("2026-09-11", 8),
    ];
    const prevBlocks: HourBlock[] = [regular("2026-08-28", 8)];

    const result = computeAdminPeriod(profile, period, thisBlocks, prevBlocks);

    expect(result.otHours).toBe(0); // no false OT from excluding the sick day
    expect(result.totalHours).toBe(80); // still paid for all 80 entered hours
    expect(result.gross).toBeCloseTo(80 * 40, 4);
  });

  it("adds the longevity kicker to the OT premium, annualized over 2080", () => {
    const profile = profileFor("week1", { longevityAnnual: 2080 }); // $1/hr exactly
    const thisBlocks: HourBlock[] = [
      regular("2026-08-31", 9),
      regular("2026-09-01", 9),
      regular("2026-09-02", 9),
      regular("2026-09-03", 9),
      regular("2026-09-07", 9),
      regular("2026-09-08", 13),
      regular("2026-09-09", 9),
      regular("2026-09-10", 9),
      regular("2026-09-11", 8),
    ];
    const prevBlocks: HourBlock[] = [regular("2026-08-28", 8)];

    const result = computeAdminPeriod(profile, period, thisBlocks, prevBlocks);

    // otPremiumRate = 0.5*40 + 0.5*(2080/2080) = 20 + 0.5 = 20.5
    const otLine = result.lineItems.find((li) => li.label === "OT premium");
    expect(otLine?.rate).toBeCloseTo(20.5, 4);
  });

  it("with no previous-period data at all, the lookback is just 0 (no crash, no false OT)", () => {
    const profile = profileFor("week1");
    const thisBlocks: HourBlock[] = [
      regular("2026-08-31", 9),
      regular("2026-09-01", 9),
      regular("2026-09-02", 9),
      regular("2026-09-03", 9),
      regular("2026-09-07", 9),
      regular("2026-09-08", 9),
      regular("2026-09-09", 9),
      regular("2026-09-10", 9),
      regular("2026-09-11", 8),
    ];

    const result = computeAdminPeriod(profile, period, thisBlocks, []);

    expect(result.otHours).toBe(0);
  });

  it("throws a clear error if the profile has no fridayGroup", () => {
    const profile = profileFor("week1", { fridayGroup: null });
    expect(() => computeAdminPeriod(profile, period, [], [])).toThrow(
      /fridayGroup/,
    );
  });
});
