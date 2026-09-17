import type { PayYear } from "../data/schema";
import { addDays, scheduledHoursOn } from "./schedule";
import type { HourBlock, Profile, ShiftLetter } from "./types";

export interface FixturePeriod {
  n: number;
  start: string;
  end: string;
  dayHours: Record<string, number>;
  summary: {
    totalHours: number;
    otHours: number;
    straightPay: number;
    flsaPay: number;
    totalPay: number;
  };
}

export interface FixtureProfile {
  rate: number;
  incentive: number;
  /** The workbook's "Last Longevity" (N3) input, folded into FLSA premium. */
  longevity: number;
  anniversaryDate: string | null;
  anniversaryNewRate: number | null;
}

export function profileFromFixture(
  shift: ShiftLetter,
  year: PayYear,
  fixtureProfile: FixtureProfile,
): Profile {
  const rateSegments: Profile["rateSegments"] = [
    {
      effectiveFrom: year.effectiveFrom,
      hourlyRate: fixtureProfile.rate,
      incentiveTotal: fixtureProfile.incentive,
    },
  ];
  if (fixtureProfile.anniversaryDate && fixtureProfile.anniversaryNewRate) {
    rateSegments.push({
      effectiveFrom: fixtureProfile.anniversaryDate,
      hourlyRate: fixtureProfile.anniversaryNewRate,
      incentiveTotal: fixtureProfile.incentive,
    });
  }
  return {
    shift,
    track: "shift",
    fridayGroup: null,
    rateSegments,
    longevityAnnual: fixtureProfile.longevity,
  };
}

/** The holiday entitlement per holiday date, and the cap on the HW premium
 * (src/app/period.ts carries the same rule for the interface). */
const HOLIDAY_ENTITLEMENT_HOURS = 12;

/**
 * Reconstructs typed hour blocks from the workbook's own worked-day cells,
 * mirroring its straight-pay formula
 * `J*(rate+inc) + HO*(rate+inc) + HW*(rate+inc)*1.5`:
 *
 * - every worked-day cell becomes a `regular` block (the sheet's J column
 *   includes holiday shifts, so those hours are ordinary paid hours and
 *   count toward the 106-hr cap);
 * - a worked day landing on a holiday date ALSO gets a `holidayWorked`
 *   premium adder, capped at the 12-hr entitlement;
 * - a holiday date the shift didn't work becomes a 12-hr `holidayObserved`
 *   adder, matching how the sheet auto-populates HO from the schedule
 *   intersected with the holiday calendar.
 */
export function blocksFromFixturePeriod(
  year: PayYear,
  shift: ShiftLetter,
  holidayDates: ReadonlySet<string>,
  period: FixturePeriod,
): HourBlock[] {
  const blocks: HourBlock[] = [];

  for (const [date, hours] of Object.entries(period.dayHours)) {
    blocks.push({ date, type: "regular", hours, destination: "cash" });
    if (holidayDates.has(date)) {
      const hwHours = Math.min(hours, HOLIDAY_ENTITLEMENT_HOURS);
      if (hwHours > 0) {
        blocks.push({
          date,
          type: "holidayWorked",
          hours: hwHours,
          destination: "cash",
        });
      }
    }
  }

  let cur = period.start;
  while (cur <= period.end) {
    const alreadyWorked = cur in period.dayHours;
    if (
      holidayDates.has(cur) &&
      !alreadyWorked &&
      scheduledHoursOn(year, shift, cur) === 0
    ) {
      blocks.push({
        date: cur,
        type: "holidayObserved",
        hours: HOLIDAY_ENTITLEMENT_HOURS,
        destination: "cash",
      });
    }
    cur = addDays(cur, 1);
  }

  return blocks;
}
