import type { Period } from "../data/schema";
import { addDays } from "./schedule";
import { effectiveRate } from "./rate";
import type { FridayGroup, HourBlock, LineItem, PeriodResult, Profile } from "./types";

/**
 * `PeriodResult` plus the per-workweek breakdown, so the UI can show
 * exactly what the department asked to see: how many hours landed in each
 * of the two Friday-noon workweeks a period straddles, not just the
 * combined OT total.
 */
export interface AdminPeriodResult extends PeriodResult {
  weekIHours: number;
  weekIIHours: number;
  otHoursWeekI: number;
  otHoursWeekII: number;
}

/**
 * Admin 9/80 uses the standard 2080-hour year to annualize the longevity
 * payoff into the OT premium — see `Profile.longevityAnnual`'s doc comment.
 * Fire ops uses 2912 (its own 53-hr-average 7(k) workweek basis) instead.
 */
export const ADMIN_ANNUALIZATION_HOURS = 2080;

/** Confirmed directly: OT hits after 40hrs in a workweek, not a 14-day
 * period — a genuinely different threshold from fire ops' 106-hr/period. */
export const ADMIN_FLSA_THRESHOLD_HOURS = 40;

/** The 9/80 schedule's one variable day — 8hrs when it's this profile's
 * worked Friday, 0 when it's their off Friday. */
const SCHEDULED_FRIDAY_HOURS = 8;

function dayOfWeekUtc(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/**
 * A 14-day period always contains exactly 2 Fridays — returns them in
 * chronological order [first, last]. The first is the "payday Friday" (pay
 * lags a period), the last is the period-end/"last day" Friday.
 */
export function findFridaysInPeriod(period: Period): [string, string] {
  const fridays: string[] = [];
  let cur = period.start;
  while (cur <= period.end) {
    if (dayOfWeekUtc(cur) === 5) fridays.push(cur);
    cur = addDays(cur, 1);
  }
  if (fridays.length !== 2) {
    throw new Error(
      `Expected exactly 2 Fridays in period ${period.n} (${period.start}..${period.end}), found ${fridays.length}`,
    );
  }
  return [fridays[0], fridays[1]];
}

/** Which of a period's two Fridays this profile has off, every period,
 * never changing — "week1" skips the first (payday) Friday, "week2" skips
 * the last (period-end) Friday. */
function fridayIsOff(fridayGroup: FridayGroup, isFirstFriday: boolean): boolean {
  return fridayGroup === "week1" ? isFirstFriday : !isFirstFriday;
}

/**
 * Splits one Friday's OT-counting hours at the noon FLSA boundary. The
 * *scheduled* portion (0 if this is the profile's off Friday, 8 if it's
 * their worked one) always splits exactly 50/50 — the whole point of a
 * compliant 9/80 schedule, and why the schedule is baseline-OT-neutral.
 * Anything entered ABOVE the scheduled amount (extra hours actually
 * worked) is attributed entirely to the PM/second-workweek side — the
 * simplest defensible rule without real punch times.
 */
export function splitFridayHours(
  scheduledHours: number,
  enteredHours: number,
): { am: number; pm: number } {
  const scheduledPortion = Math.min(enteredHours, scheduledHours);
  const extra = Math.max(0, enteredHours - scheduledHours);
  return { am: scheduledPortion / 2, pm: scheduledPortion / 2 + extra };
}

/** Only "regular" hours count toward the 40-hr OT threshold — PTO doesn't,
 * mirroring fire ops' cap-counting rule (not actually worked). */
function otCountingHoursOn(blocks: HourBlock[], date: string): number {
  return blocks
    .filter((b) => b.date === date && b.type === "regular")
    .reduce((sum, b) => sum + b.hours, 0);
}

function otCountingHoursBetweenExclusive(
  blocks: HourBlock[],
  afterDate: string,
  beforeDate: string,
): number {
  let sum = 0;
  let cur = addDays(afterDate, 1);
  while (cur < beforeDate) {
    sum += otCountingHoursOn(blocks, cur);
    cur = addDays(cur, 1);
  }
  return sum;
}

/**
 * Prices one 9/80 admin pay period. The FLSA workweek here (Friday noon to
 * Friday noon) doesn't align with the 14-day pay-period boundary, so this
 * needs `previousPeriodBlocks` — the workweek that starts at the prior
 * period's last Friday noon spills a few hours back across the boundary.
 * Confirmed directly by the department: to know this period's OT you have
 * to look at what was worked the prior period's last Friday afternoon.
 *
 * Pure function otherwise, matching `computePeriod`'s shape: pay every
 * entered hour at the straight effective rate, then add one premium line
 * for whatever hours land over the 40-hr threshold in either workweek —
 * `0.5 * rate` (the top-up from straight to 1.5x) plus the longevity kicker,
 * exactly the pattern `computePeriod`'s FLSA premium already uses.
 */
export function computeAdminPeriod(
  profile: Profile,
  period: Period,
  thisPeriodBlocks: HourBlock[],
  previousPeriodBlocks: HourBlock[],
): AdminPeriodResult {
  if (!profile.fridayGroup) {
    throw new Error("computeAdminPeriod requires profile.fridayGroup");
  }
  const fridayGroup = profile.fridayGroup;

  const [friday1, friday2] = findFridaysInPeriod(period);
  // The previous period's last day is always a Friday, always exactly 7
  // days before this period's first Friday (both periods are 14 days).
  const prevFriday = addDays(friday1, -7);

  const scheduled1 = fridayIsOff(fridayGroup, true) ? 0 : SCHEDULED_FRIDAY_HOURS;
  const scheduled2 = fridayIsOff(fridayGroup, false) ? 0 : SCHEDULED_FRIDAY_HOURS;
  // The previous period's last Friday plays the same "last Friday of a
  // period" role every period (the group never changes), so it shares
  // friday2's on/off schedule.
  const prevScheduled = scheduled2;

  const prevSplit = splitFridayHours(
    prevScheduled,
    otCountingHoursOn(previousPeriodBlocks, prevFriday),
  );
  const friday1Split = splitFridayHours(
    scheduled1,
    otCountingHoursOn(thisPeriodBlocks, friday1),
  );
  const friday2Split = splitFridayHours(
    scheduled2,
    otCountingHoursOn(thisPeriodBlocks, friday2),
  );

  // Workweek I: [prev-last-Friday noon .. this period's first Friday noon).
  // Its Sat-through-Thu portion falls entirely inside this period, since
  // this period starts the day after prev-last-Friday.
  const weekIHours =
    prevSplit.pm +
    otCountingHoursBetweenExclusive(thisPeriodBlocks, prevFriday, friday1) +
    friday1Split.am;

  // Workweek II: [this period's first Friday noon .. its last Friday noon).
  const weekIIHours =
    friday1Split.pm +
    otCountingHoursBetweenExclusive(thisPeriodBlocks, friday1, friday2) +
    friday2Split.am;

  const otHoursWeekI = Math.max(0, weekIHours - ADMIN_FLSA_THRESHOLD_HOURS);
  const otHoursWeekII = Math.max(0, weekIIHours - ADMIN_FLSA_THRESHOLD_HOURS);
  const otHours = otHoursWeekI + otHoursWeekII;

  const sorted = [...thisPeriodBlocks].sort((a, b) => (a.date < b.date ? -1 : 1));
  const lineItems: LineItem[] = [];
  let gross = 0;
  let totalHours = 0;

  for (const block of sorted) {
    const rate = effectiveRate(profile, block.date);
    const amount = block.hours * rate;
    gross += amount;
    totalHours += block.hours;
    lineItems.push({
      label: block.type === "pto" ? "PTO" : "Regular",
      date: block.date,
      hours: block.hours,
      rate,
      amount,
    });
  }

  if (otHours > 0) {
    // A single rate lookup (not a blended one across a step-date split) —
    // a step date landing mid-period is a rare enough edge case for this
    // track to defer rather than build the fire-ops-style blend for now.
    const rate = effectiveRate(profile, period.end);
    const longevityPremiumRate =
      0.5 * (profile.longevityAnnual / ADMIN_ANNUALIZATION_HOURS);
    const otPremiumRate = 0.5 * rate + longevityPremiumRate;
    const amount = otHours * otPremiumRate;
    gross += amount;
    lineItems.push({
      label: "OT premium",
      date: period.end,
      hours: otHours,
      rate: otPremiumRate,
      amount,
    });
  }

  return {
    totalHours,
    otHours,
    gross,
    lineItems,
    weekIHours,
    weekIIHours,
    otHoursWeekI,
    otHoursWeekII,
  };
}
