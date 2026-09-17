import { describe, expect, it } from "vitest";
import fy27Raw from "../data/fy27.json";
import { parsePayYear } from "../data/schema";
import { computePeriod } from "../engine/period";
import {
  aggregateLineItems,
  blocksToEntries,
  defaultDayEntries,
  entriesToBlocks,
  findPeriodForDate,
} from "./period";

const year = parsePayYear(fy27Raw);

describe("findPeriodForDate", () => {
  it("finds the period containing a date", () => {
    expect(findPeriodForDate(year, "2026-11-26")?.n).toBe(5);
  });

  it("falls back to period 1 before the year starts", () => {
    expect(findPeriodForDate(year, "2020-01-01")?.n).toBe(1);
  });

  it("falls back to the last period after the year ends", () => {
    expect(findPeriodForDate(year, "2099-01-01")?.n).toBe(26);
  });
});

describe("defaultDayEntries", () => {
  const period = year.periods[4]; // period 5, the Thanksgiving period

  it("defaults a worked holiday day to holidayHoursWorked = scheduled hours", () => {
    const entries = defaultDayEntries(year, "A", period);
    const thanksgiving = entries.find((e) => e.date === "2026-11-26");
    expect(thanksgiving?.isHoliday).toBe(true);
    expect(thanksgiving?.holidayHoursWorked).toBe(24);
  });

  it("defaults an off-day holiday to holidayHoursWorked = 0 (full 12-hr observed)", () => {
    const mlkPeriod = year.periods[8]; // period 9, contains MLK day
    const entries = defaultDayEntries(year, "A", mlkPeriod);
    const mlk = entries.find((e) => e.date === "2027-01-18");
    expect(mlk?.isHoliday).toBe(true);
    expect(mlk?.holidayHoursWorked).toBe(0);
  });

  it("defaults a plain scheduled day to a single regular line", () => {
    const entries = defaultDayEntries(year, "A", period);
    const regularDay = entries.find((e) => e.date === "2026-11-21");
    expect(regularDay?.lines).toHaveLength(1);
    expect(regularDay?.lines[0].type).toBe("regular");
    expect(regularDay?.lines[0].hours).toBe(24);
  });

  it("defaults a scheduled-off day to a single off line with 0 hours", () => {
    const entries = defaultDayEntries(year, "A", period);
    const offDay = entries.find((e) => e.date === "2026-11-22");
    expect(offDay?.lines).toHaveLength(1);
    expect(offDay?.lines[0].type).toBe("off");
    expect(offDay?.lines[0].hours).toBe(0);
  });

  it("gives a holiday day no generic lines — it derives from hours worked", () => {
    const entries = defaultDayEntries(year, "A", period);
    const thanksgiving = entries.find((e) => e.date === "2026-11-26");
    expect(thanksgiving?.lines).toEqual([]);
  });

  it("never defaults grade to F1 — it's never a valid step-up target", () => {
    // Regression: the UI's step-up grade picker only lists F2+, so if a
    // line's default grade were "F1" the picker would visually show its
    // first listed option (F2) while the line actually held "F1" —
    // silently pricing a step-up block at the wrong (lower) rate the
    // moment someone picked "Step-up" without also touching the grade
    // dropdown themselves.
    const entries = defaultDayEntries(year, "A", period);
    expect(entries.every((e) => e.lines.every((l) => l.grade !== "F1"))).toBe(
      true,
    );
  });

  it("defaults step-up grade to the one directly above the member's own", () => {
    // Step-up always covers Step 0 of the grade above the member's own,
    // regardless of the member's own step within their grade
    // (docs/PAY_PLAN.md) — an F3 member defaults to riding up as F4, not
    // always F2.
    const entriesForF3 = defaultDayEntries(year, "A", period, "F3");
    expect(
      entriesForF3.every((e) => e.lines.every((l) => l.grade === "F4")),
    ).toBe(true);
  });

  it("falls back to F2 when the member's grade isn't known yet", () => {
    const entries = defaultDayEntries(year, "A", period, null);
    expect(entries.every((e) => e.lines.every((l) => l.grade === "F2"))).toBe(
      true,
    );
  });
});

describe("entriesToBlocks / blocksToEntries round-trip", () => {
  it("converts defaults to blocks and back without loss", () => {
    const period = year.periods[4];
    const entries = defaultDayEntries(year, "A", period);
    const blocks = entriesToBlocks(entries);
    const roundTripped = blocksToEntries(year, "A", period, blocks);
    expect(roundTripped).toEqual(entries);
  });

  it("reproduces the same gross as computing straight from defaults", () => {
    const period = year.periods[4];
    const profile = {
      shift: "A" as const,
      track: "shift" as const,
      fridayGroup: null,
      rateSegments: [
        {
          effectiveFrom: year.effectiveFrom,
          hourlyRate: 26.8173,
          incentiveTotal: 0,
        },
      ],
      longevityAnnual: 0,
    };
    const entries = defaultDayEntries(year, "A", period);
    const blocks = entriesToBlocks(entries);
    const result = computePeriod(year, profile, blocks);
    expect(result.gross).toBeGreaterThan(0);
  });

  it("splits a partial holiday holdover into 2 RG + 2 HW + 10 HO", () => {
    // A 2-hr late-call holdover pays those 2 hrs as ordinary regular time,
    // ALSO earns a 2-hr HW premium on top, and still pays the remaining 10
    // hrs of entitlement as HO — exactly as described by the member, and
    // matching the workbooks' `J*(r) + HO*(r) + HW*(r)*1.5`.
    const period = year.periods[4];
    const entries = defaultDayEntries(year, "A", period).map((e) =>
      e.date === "2026-11-26" ? { ...e, holidayHoursWorked: 2 } : e,
    );
    const blocks = entriesToBlocks(entries);
    const thanksgivingBlocks = blocks.filter((b) => b.date === "2026-11-26");
    expect(thanksgivingBlocks).toEqual([
      { date: "2026-11-26", type: "regular", hours: 2, destination: "cash" },
      {
        date: "2026-11-26",
        type: "holidayWorked",
        hours: 2,
        destination: "cash",
      },
      {
        date: "2026-11-26",
        type: "holidayObserved",
        hours: 10,
        destination: "cash",
      },
    ]);
  });

  it("round-trips a partial holiday holdover", () => {
    const period = year.periods[4];
    const entries = defaultDayEntries(year, "A", period).map((e) =>
      e.date === "2026-11-26" ? { ...e, holidayHoursWorked: 2 } : e,
    );
    const blocks = entriesToBlocks(entries);
    const roundTripped = blocksToEntries(year, "A", period, blocks);
    expect(roundTripped).toEqual(entries);
  });

  it("caps the HW premium at 12 hrs — a full 24-hr holiday is 24 RG + 12 HW", () => {
    // Working past the 12-hr entitlement earns no further premium, but the
    // hours are still paid as ordinary regular time (and still count toward
    // the 106-hr cap). Verified against a real Christmas paystub: RG 106 hrs
    // and HW 36 hrs (3 holidays x 12) summing to the stated gross.
    const period = year.periods[4];
    const entries = defaultDayEntries(year, "A", period); // default: fully worked
    const blocks = entriesToBlocks(entries);
    const thanksgivingBlocks = blocks.filter((b) => b.date === "2026-11-26");
    expect(thanksgivingBlocks).toEqual([
      { date: "2026-11-26", type: "regular", hours: 24, destination: "cash" },
      {
        date: "2026-11-26",
        type: "holidayWorked",
        hours: 12,
        destination: "cash",
      },
    ]);

    const profile = {
      shift: "A" as const,
      track: "shift" as const,
      fridayGroup: null,
      rateSegments: [
        {
          effectiveFrom: year.effectiveFrom,
          hourlyRate: 26.8173,
          incentiveTotal: 0,
        },
      ],
      longevityAnnual: 0,
    };
    const gross = computePeriod(year, profile, thanksgivingBlocks).gross;
    // 24 hrs straight + a 12-hr premium adder (no OT — nowhere near 106).
    expect(gross).toBeCloseTo(24 * 26.8173 + 12 * 1.5 * 26.8173, 4);
  });

  it("round-trips a fully-worked holiday past the 12-hr cap", () => {
    const period = year.periods[4];
    const entries = defaultDayEntries(year, "A", period);
    const blocks = entriesToBlocks(entries);
    const roundTripped = blocksToEntries(year, "A", period, blocks);
    expect(roundTripped).toEqual(entries);
  });

  const flatProfile = {
    shift: "A" as const,
    track: "shift" as const,
    fridayGroup: null,
    rateSegments: [
      {
        effectiveFrom: year.effectiveFrom,
        hourlyRate: 26.8173,
        incentiveTotal: 0,
      },
    ],
    longevityAnnual: 0,
  };

  it("banks the HW premium as HWA — RG still pays cash, only HW goes to $0", () => {
    // Per city policy 501.1.1(G): HWA is "in lieu of Holiday Worked" (the
    // premium specifically), not the underlying wage for hours actually
    // worked — same as ordinary FLSA comp time, which only defers the OT
    // premium and never the straight-time pay underneath it. Confirmed
    // directly.
    const period = year.periods[4];
    const entries = defaultDayEntries(year, "A", period).map((e) =>
      e.date === "2026-11-26"
        ? { ...e, holidayHoursWorked: 24, holidayWorkedAccrued: true }
        : e,
    );
    const blocks = entriesToBlocks(entries);
    const thanksgivingBlocks = blocks.filter((b) => b.date === "2026-11-26");
    expect(thanksgivingBlocks).toEqual([
      { date: "2026-11-26", type: "regular", hours: 24, destination: "cash" },
      {
        date: "2026-11-26",
        type: "holidayWorked",
        hours: 12,
        destination: "accrue",
      },
    ]);

    const gross = computePeriod(year, flatProfile, thanksgivingBlocks).gross;
    // Only RG pays this check — the HW premium is banked, not cash.
    expect(gross).toBeCloseTo(24 * 26.8173, 4);
  });

  it("round-trips an HWA-banked holiday-worked entry", () => {
    const period = year.periods[4];
    const entries = defaultDayEntries(year, "A", period).map((e) =>
      e.date === "2026-11-26"
        ? { ...e, holidayHoursWorked: 24, holidayWorkedAccrued: true }
        : e,
    );
    const blocks = entriesToBlocks(entries);
    const roundTripped = blocksToEntries(year, "A", period, blocks);
    expect(roundTripped).toEqual(entries);
  });

  it("holiday observed can never be banked, even when the day is fully unworked", () => {
    // Confirmed directly: unlike HWA on the worked side, HO has no accrue
    // option at all — the field doesn't exist on DayEntry, so there's
    // nothing to set. This just locks the always-cash behavior in.
    const period = year.periods[4];
    const entries = defaultDayEntries(year, "A", period).map((e) =>
      e.date === "2026-11-26" ? { ...e, holidayHoursWorked: 0 } : e,
    );
    const blocks = entriesToBlocks(entries);
    const thanksgivingBlocks = blocks.filter((b) => b.date === "2026-11-26");
    expect(thanksgivingBlocks).toEqual([
      {
        date: "2026-11-26",
        type: "holidayObserved",
        hours: 12,
        destination: "cash",
      },
    ]);
  });

  it("HWA banks only the worked premium — the unworked HO remainder always stays cash", () => {
    const period = year.periods[4];
    const entries = defaultDayEntries(year, "A", period).map((e) =>
      e.date === "2026-11-26"
        ? { ...e, holidayHoursWorked: 2, holidayWorkedAccrued: true }
        : e,
    );
    const blocks = entriesToBlocks(entries);
    const thanksgivingBlocks = blocks.filter((b) => b.date === "2026-11-26");
    expect(thanksgivingBlocks).toEqual([
      { date: "2026-11-26", type: "regular", hours: 2, destination: "cash" },
      {
        date: "2026-11-26",
        type: "holidayWorked",
        hours: 2,
        destination: "accrue",
      },
      {
        date: "2026-11-26",
        type: "holidayObserved",
        hours: 10,
        destination: "cash",
      },
    ]);

    const roundTripped = blocksToEntries(year, "A", period, blocks);
    expect(roundTripped).toEqual(entries);
  });

  it("splits one day into two lines — half at rank, half riding up", () => {
    // The real case this exists for: a 24-hr shift worked partly at the
    // member's own grade and partly covering the rank above.
    const period = year.periods[4];
    const entries = defaultDayEntries(year, "A", period, "F2").map((e) =>
      e.date === "2026-11-21"
        ? {
            ...e,
            lines: [
              { type: "regular" as const, hours: 12, grade: "F3" as const },
              { type: "stepUp" as const, hours: 12, grade: "F3" as const },
            ],
          }
        : e,
    );
    const blocks = entriesToBlocks(entries);
    const dayBlocks = blocks.filter((b) => b.date === "2026-11-21");
    expect(dayBlocks).toEqual([
      { date: "2026-11-21", type: "regular", hours: 12, destination: "cash" },
      {
        date: "2026-11-21",
        type: "stepUp",
        hours: 12,
        destination: "cash",
        grade: "F3",
      },
    ]);
  });

  it("round-trips a split day without collapsing it back to one line", () => {
    const period = year.periods[4];
    const entries = defaultDayEntries(year, "A", period, "F2").map((e) =>
      e.date === "2026-11-21"
        ? {
            ...e,
            lines: [
              { type: "regular" as const, hours: 12, grade: "F3" as const },
              { type: "stepUp" as const, hours: 12, grade: "F3" as const },
            ],
          }
        : e,
    );
    const blocks = entriesToBlocks(entries);
    const roundTripped = blocksToEntries(year, "A", period, blocks, "F2");
    expect(roundTripped).toEqual(entries);
  });

  it("emits every block as destination cash by default — accrual is opt-in", () => {
    const period = year.periods[4];
    const entries = defaultDayEntries(year, "A", period);
    const blocks = entriesToBlocks(entries);
    expect(
      blocks.every((b) => !("destination" in b) || b.destination === "cash"),
    ).toBe(true);
  });
});

describe("aggregateLineItems", () => {
  it("collapses per-day line items into one row per pay code", () => {
    const aggregated = aggregateLineItems([
      {
        label: "Regular",
        date: "2026-09-27",
        hours: 24,
        rate: 26.8173,
        amount: 643.6152,
      },
      {
        label: "Regular",
        date: "2026-09-28",
        hours: 24,
        rate: 26.8173,
        amount: 643.6152,
      },
      {
        label: "FLSA premium",
        date: "2026-09-28",
        hours: 4,
        rate: 13.40865,
        amount: 53.6346,
      },
    ]);
    expect(aggregated).toHaveLength(2);
    const regular = aggregated.find((a) => a.label === "Regular");
    expect(regular?.hours).toBe(48);
    expect(regular?.amount).toBeCloseTo(1287.2304, 4);
  });
});
