import { describe, expect, it } from "vitest";
import fy27Raw from "../data/fy27.json";
import { parsePayYear } from "../data/schema";
import { computePeriod, computeStepUp } from "./period";
import type { HourBlock, Profile } from "./types";

const year = parsePayYear(fy27Raw);

const flatProfile: Profile = {
  shift: "A",
  track: "shift",
  fridayGroup: null,
  rateSegments: [
    { effectiveFrom: "2026-09-26", hourlyRate: 26.8173, incentiveTotal: 0 },
  ],
  longevityAnnual: 0,
};

describe("computePeriod", () => {
  it("returns zero for a period with no hour blocks", () => {
    const result = computePeriod(year, flatProfile, []);
    expect(result).toEqual({
      totalHours: 0,
      otHours: 0,
      gross: 0,
      lineItems: [],
    });
  });

  it("matches a plain 120-hour period with no OT-triggering surplus", () => {
    // 5 worked days of 24 hrs = 120, over the 106-hr cap by 14.
    const blocks: HourBlock[] = [
      "2026-09-27",
      "2026-09-28",
      "2026-10-03",
      "2026-10-04",
      "2026-10-09",
    ].map((date) => ({
      date,
      type: "regular",
      hours: 24,
      destination: "cash",
    }));

    const result = computePeriod(year, flatProfile, blocks);
    expect(result.totalHours).toBe(120);
    expect(result.otHours).toBe(14);
    // 120 * 26.8173 (straight) + 14 * 0.5 * 26.8173 (FLSA premium)
    expect(result.gross).toBeCloseTo(120 * 26.8173 + 14 * 0.5 * 26.8173, 4);
  });

  it("a 96-hour period has no OT", () => {
    const blocks: HourBlock[] = ["2026-10-24", "2026-10-25"].map((date) => ({
      date,
      type: "regular",
      hours: 24,
      destination: "cash",
    }));
    // pad to 96 with two more days
    blocks.push(
      { date: "2026-10-31", type: "regular", hours: 24, destination: "cash" },
      { date: "2026-11-01", type: "regular", hours: 24, destination: "cash" },
    );
    const result = computePeriod(year, flatProfile, blocks);
    expect(result.totalHours).toBe(96);
    expect(result.otHours).toBe(0);
    expect(result.gross).toBeCloseTo(96 * 26.8173, 4);
  });

  it("PTO hours are paid straight but never count toward the 106-hr cap", () => {
    // 120 hrs worked + 24 hrs PTO. If PTO counted toward the cap this would
    // be 38 OT hours; it must stay 14 (from the worked hours alone).
    const worked: HourBlock[] = [
      "2026-09-27",
      "2026-09-28",
      "2026-10-03",
      "2026-10-04",
      "2026-10-09",
    ].map((date) => ({
      date,
      type: "regular",
      hours: 24,
      destination: "cash",
    }));
    const blocks: HourBlock[] = [
      ...worked,
      { date: "2026-10-10", type: "pto", hours: 24 },
    ];
    const result = computePeriod(year, flatProfile, blocks);
    expect(result.totalHours).toBe(144);
    expect(result.otHours).toBe(14);
    const expectedGross = 120 * 26.8173 + 14 * 0.5 * 26.8173 + 24 * 26.8173;
    expect(result.gross).toBeCloseTo(expectedGross, 4);
  });

  it("holiday worked is a 1.5x adder; its worked hours still count toward the cap", () => {
    // A worked holiday is 24 RG (which DO count toward the cap) plus a 12-hr
    // HW premium adder layered on top — the adder is neither hours on the
    // clock nor cap-counting. 120 worked hours, 14 over the 106 cap.
    const blocks: HourBlock[] = [
      { date: "2026-11-21", type: "regular", hours: 24, destination: "cash" },
      { date: "2026-11-26", type: "regular", hours: 24, destination: "cash" },
      {
        date: "2026-11-26",
        type: "holidayWorked",
        hours: 12,
        destination: "cash",
      },
      { date: "2026-12-02", type: "regular", hours: 24, destination: "cash" },
      { date: "2026-12-03", type: "regular", hours: 24, destination: "cash" },
      { date: "2026-11-27", type: "regular", hours: 24, destination: "cash" },
    ];
    const result = computePeriod(year, flatProfile, blocks);
    expect(result.totalHours).toBe(120);
    expect(result.otHours).toBe(14);
    const expectedGross =
      120 * 26.8173 + 12 * 1.5 * 26.8173 + 14 * 0.5 * 26.8173;
    expect(result.gross).toBeCloseTo(expectedGross, 4);
  });

  it("holiday observed pays straight time but is not hours on the clock", () => {
    const blocks: HourBlock[] = [
      {
        date: "2027-01-18",
        type: "holidayObserved",
        hours: 12,
        destination: "cash",
      },
    ];
    const result = computePeriod(year, flatProfile, blocks);
    expect(result.totalHours).toBe(0);
    expect(result.otHours).toBe(0);
    expect(result.gross).toBeCloseTo(12 * 26.8173, 4);
  });

  it("folds the annual longevity payoff into the FLSA premium", () => {
    // FLSA requires non-discretionary pay in the regular rate even when it's
    // disbursed separately. Verified against a real check: without this term
    // the engine came in $0.30 light on a 6-hr-OT period.
    const blocks: HourBlock[] = Array.from({ length: 5 }, (_, i) => ({
      date: `2026-09-2${i + 1}`,
      type: "regular" as const,
      hours: 24,
      destination: "cash" as const,
    }));
    const withLongevity = { ...flatProfile, longevityAnnual: 284 };
    const base = computePeriod(year, flatProfile, blocks).gross;
    const bumped = computePeriod(year, withLongevity, blocks).gross;
    expect(bumped - base).toBeCloseTo(14 * 0.5 * (284 / 2912), 6);
  });

  it("comped or accrued hours contribute $0 to this check's gross", () => {
    const blocks: HourBlock[] = [
      { date: "2026-09-27", type: "regular", hours: 24, destination: "comp" },
      { date: "2026-11-26", type: "regular", hours: 24, destination: "comp" },
      {
        date: "2026-11-26",
        type: "holidayWorked",
        hours: 12,
        destination: "comp",
      },
      {
        date: "2027-01-18",
        type: "holidayObserved",
        hours: 12,
        destination: "accrue",
      },
    ];
    const result = computePeriod(year, flatProfile, blocks);
    expect(result.totalHours).toBe(48);
    expect(result.gross).toBe(0);
  });

  it("splits a period spanning a step date: old rate before, new rate at/after", () => {
    // Real FY27 workbook period 14 (2027-03-27..2027-04-09), anniversary
    // 2027-04-01: the sheet prices the whole period at the OLD rate
    // (a known bug, BUILD_PLAN.md Appendix defect #4) — the engine must
    // split it instead.
    const splitProfile: Profile = {
      shift: "A",
      track: "shift",
      fridayGroup: null,
      rateSegments: [
        { effectiveFrom: "2026-09-26", hourlyRate: 26.8173, incentiveTotal: 0 },
        {
          effectiveFrom: "2027-04-01",
          hourlyRate: 27.621819,
          incentiveTotal: 0,
        },
      ],
      longevityAnnual: 0,
    };
    const blocks: HourBlock[] = [
      "2027-03-27",
      "2027-04-01",
      "2027-04-02",
      "2027-04-07",
      "2027-04-08",
    ].map((date) => ({
      date,
      type: "regular",
      hours: 24,
      destination: "cash",
    }));

    const result = computePeriod(year, splitProfile, blocks);
    expect(result.totalHours).toBe(120);
    expect(result.otHours).toBe(14);

    const oldRatePay = 24 * 26.8173; // 3/27, before the step date
    const newRatePay = 96 * 27.621819; // the other 4 days, at/after it
    // The FLSA premium uses the period's hours-weighted "regular rate"
    // across the split, the same blending computeStepUp uses when
    // step-up and regular hours mix (docs/BUILD_PLAN.md §4) — the sheet
    // itself doesn't split at all (defect #4), so there's no sheet number
    // to match here, only the confirmed rule that it must split.
    const blendedRate = (oldRatePay + newRatePay) / 120;
    const flsaPremium = 14 * 0.5 * blendedRate;
    expect(result.gross).toBeCloseTo(oldRatePay + newRatePay + flsaPremium, 4);

    // Sheet's (buggy) whole-period-at-old-rate total, for contrast —
    // the engine must NOT match this.
    const sheetTotal = 3405.7971;
    expect(result.gross).not.toBeCloseTo(sheetTotal, 2);
  });

  it("matches the member's real FY26 and FY27 sheets on a partial holiday holdover crossing the FLSA cap", () => {
    // Verified live (2026-08-23) against both the member's personal FY26
    // and FY27 sheets: 5 scheduled 24-hr days (120h) plus a 6-hr holdover
    // on an off-day holiday (6 RG + 6 HW + 6 HO), 20 hrs over the 106-hr
    // cap. Both sheets landed on this exact total once their own input
    // errors were corrected (FY26: an incentive-omission bug already
    // documented in knownDivergencesFy26.ts; FY27: a rounded hourly rate
    // and a stale placeholder step date, both sheet data-entry mistakes,
    // not engine bugs) — real rate ($35.3302 + $3.0906 incentive) and
    // longevity ($284).
    const profile: Profile = {
      shift: "A",
      track: "shift",
      fridayGroup: null,
      rateSegments: [
        {
          effectiveFrom: "2026-09-26",
          hourlyRate: 35.3302,
          incentiveTotal: 3.0906,
        },
      ],
      longevityAnnual: 284,
    };
    const scheduled: HourBlock[] = [
      "2026-09-27",
      "2026-09-28",
      "2026-10-03",
      "2026-10-04",
      "2026-10-09",
    ].map((date) => ({
      date,
      type: "regular",
      hours: 24,
      destination: "cash",
    }));
    const blocks: HourBlock[] = [
      ...scheduled,
      { date: "2026-10-10", type: "regular", hours: 6, destination: "cash" },
      {
        date: "2026-10-10",
        type: "holidayWorked",
        hours: 6,
        destination: "cash",
      },
      {
        date: "2026-10-10",
        type: "holidayObserved",
        hours: 6,
        destination: "cash",
      },
    ];

    const result = computePeriod(year, profile, blocks);
    expect(result.totalHours).toBe(126);
    expect(result.otHours).toBe(20);

    const rate = 35.3302 + 3.0906;
    const straight = 126 * rate + 6 * 1.5 * rate + 6 * rate;
    const flsaPremium = 20 * (0.5 * rate + 0.5 * (284 / 2912));
    expect(result.gross).toBeCloseTo(straight + flsaPremium, 4);
    expect(result.gross).toBeCloseTo(5802.52, 2);
  });

  it("matches the same holdover scenario when it stays under the FLSA cap", () => {
    // Same shape, verified against the FY27 sheet for the MLK-day period:
    // 4 scheduled days (96h) instead of 5, so 102h total stays under 106 —
    // no FLSA premium line at all.
    const profile: Profile = {
      shift: "A",
      track: "shift",
      fridayGroup: null,
      rateSegments: [
        {
          effectiveFrom: "2026-09-26",
          hourlyRate: 35.3302,
          incentiveTotal: 3.0906,
        },
      ],
      longevityAnnual: 284,
    };
    const scheduled: HourBlock[] = [
      "2026-09-27",
      "2026-09-28",
      "2026-10-03",
      "2026-10-04",
    ].map((date) => ({
      date,
      type: "regular",
      hours: 24,
      destination: "cash",
    }));
    const blocks: HourBlock[] = [
      ...scheduled,
      { date: "2026-10-09", type: "regular", hours: 6, destination: "cash" },
      {
        date: "2026-10-09",
        type: "holidayWorked",
        hours: 6,
        destination: "cash",
      },
      {
        date: "2026-10-09",
        type: "holidayObserved",
        hours: 6,
        destination: "cash",
      },
    ];

    const result = computePeriod(year, profile, blocks);
    expect(result.totalHours).toBe(102);
    expect(result.otHours).toBe(0);

    const rate = 35.3302 + 3.0906;
    const straight = 102 * rate + 6 * 1.5 * rate + 6 * rate;
    expect(result.gross).toBeCloseTo(straight, 4);
    expect(result.gross).toBeCloseTo(4495.23, 2);
  });

  it("prices TIFMAS hours at 1.5x base rate plus straight-time incentive", () => {
    // Reported bug: a member's real check showed TIFMAS gross of $4,160.03
    // for 90 hrs at $29.3040 base + $2.2665 incentive; the engine was
    // pricing TIFMAS like regular hours (effectiveRate), landing $1,318.68
    // short. Confirmed from the member's workbook formula
    // `=(B1*B13*1.5)+(D17*B13)` == hours * (1.5 * hourlyRate + incentiveTotal).
    const profile: Profile = {
      shift: "A",
      track: "shift",
      fridayGroup: null,
      rateSegments: [
        {
          effectiveFrom: "2026-09-26",
          hourlyRate: 29.304,
          incentiveTotal: 2.2665,
        },
      ],
      longevityAnnual: 0,
    };
    const blocks: HourBlock[] = [
      { date: "2026-09-27", type: "tifmas", hours: 90, destination: "cash" },
    ];

    const result = computePeriod(year, profile, blocks);
    const tifmasLine = result.lineItems.find((li) => li.label === "TIFMAS");
    const expected = 90 * (1.5 * 29.304 + 2.2665); // 4160.025, rounds to the check's $4,160.03
    expect(tifmasLine?.amount).toBeCloseTo(expected, 4);
    expect(result.gross).toBeCloseTo(expected, 4);
  });

  it("computeStepUp returns Step 0 of the covered grade, not a percentage", () => {
    expect(computeStepUp(year, "F2")).toBe(35.3302);
    expect(computeStepUp(year, "F3")).toBe(41.7566);
    expect(computeStepUp(year, "F4")).toBe(48.8773);
  });

  it("step-up pay adds the member's own incentive on top of the covered grade's Step 0", () => {
    // Reported bug: riding up as F2 was paying Step 0 ($35.3302) alone,
    // dropping the member's own incentive pay ($3.0906/hr). Confirmed from
    // the member's workbook formula `=(E1+D17)*B4` where E1 is the step-up
    // rate and D17 the incentive-per-hour.
    const profile: Profile = {
      shift: "A",
      track: "shift",
      fridayGroup: null,
      rateSegments: [
        {
          effectiveFrom: "2026-09-26",
          hourlyRate: 26.8173,
          incentiveTotal: 3.0906,
        },
      ],
      longevityAnnual: 0,
    };
    const blocks: HourBlock[] = [
      {
        date: "2026-09-27",
        type: "stepUp",
        hours: 24,
        destination: "cash",
        grade: "F2",
      },
    ];

    const result = computePeriod(year, profile, blocks);
    const stepUpLine = result.lineItems.find((li) =>
      li.label.startsWith("Step-up"),
    );
    const expected = 24 * (35.3302 + 3.0906);
    expect(stepUpLine?.amount).toBeCloseTo(expected, 4);
    expect(result.gross).toBeCloseTo(expected, 4);
  });

  it("blends step-up and regular hours into one FLSA rate when mixed", () => {
    // 4 regular days (96 hrs) at the member's own rate + 1 step-up day
    // (24 hrs, riding up as F2) = 120 total, 14 over the cap.
    const blocks: HourBlock[] = [
      "2026-09-27",
      "2026-09-28",
      "2026-10-03",
      "2026-10-04",
    ].map(
      (date) =>
        ({
          date,
          type: "regular",
          hours: 24,
          destination: "cash",
        }) as HourBlock,
    );
    blocks.push({
      date: "2026-10-09",
      type: "stepUp",
      hours: 24,
      destination: "cash",
      grade: "F2",
    });

    const result = computePeriod(year, flatProfile, blocks);
    expect(result.totalHours).toBe(120);
    expect(result.otHours).toBe(14);

    const stepUpRate = computeStepUp(year, "F2");
    const straight = 96 * 26.8173 + 24 * stepUpRate;
    const blendedRate = (96 * 26.8173 + 24 * stepUpRate) / 120;
    const premium = 14 * 0.5 * blendedRate;
    expect(result.gross).toBeCloseTo(straight + premium, 4);
  });
});
