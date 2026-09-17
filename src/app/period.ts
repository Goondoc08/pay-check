import type { Period, PayYear } from "../data/schema";
import { findFridaysInPeriod } from "../engine/adminPeriod";
import { addDays, scheduledHoursOn } from "../engine/schedule";
import { nextGradeUp } from "./stepProgression";
import type {
  FridayGroup,
  HourBlock,
  LineItem,
  PayGrade,
  ShiftLetter,
} from "../engine/types";

// Fallback only for when the member's own grade isn't known yet (e.g. data
// saved before Setup started capturing grade). Once known, step-up always
// defaults to the grade directly above the member's own (nextGradeUp).
const FALLBACK_STEP_UP_GRADE: PayGrade = "F2";

/** The standard holiday-off entitlement — 12 hrs per holiday date, whether
 * or not any of it gets worked, and the cap on the HW premium. */
const HOLIDAY_ENTITLEMENT_HOURS = 12;

/**
 * A holiday date is handled separately (see `holidayHoursWorked` below):
 * it isn't one-or-the-other, since working *part* of a holiday pays both a
 * worked premium for the hours worked and the leftover observed
 * entitlement for the hours that weren't — a first-class case, not a
 * variant of "off"/"regular".
 */
export type DayEntryType = "off" | "regular" | "pto" | "stepUp" | "tifmas";

/**
 * One kind of hours on one day. A day usually has exactly one, but a shift
 * can genuinely split — half worked at rank, half riding up as a step-up,
 * say — so a day carries up to MAX_DAY_LINES of them.
 */
export interface DayLine {
  type: DayEntryType;
  hours: number;
  /** Only meaningful for type "stepUp" — the grade being covered. */
  grade: PayGrade;
}

/** A split shift needs two; more than that isn't a real timecard shape. */
export const MAX_DAY_LINES = 2;

export interface DayEntry {
  date: string;
  scheduledHours: number;
  isHoliday: boolean;
  /**
   * Meaningful only when !isHoliday — holiday days derive everything from
   * `holidayHoursWorked` instead. Always at least one line; a day that
   * isn't worked is a single line of type "off".
   */
  lines: DayLine[];
  /**
   * Meaningful only when isHoliday. Hours actually worked on the holiday
   * (0-24) — everything else derives from this. Verified against a real
   * Christmas-period paystub (RG 106h / HW 36h, gross to the cent), and
   * matching both workbooks' straight-pay formula:
   *   - all `worked` hrs pay straight as REGULAR, and count toward the
   *     106-hr cap like any other worked hours
   *   - min(worked, 12) hrs ALSO pay a 1.5x HW premium on top — an adder,
   *     not a replacement, capped per holiday date
   *   - max(0, 12 - worked) hrs of unworked entitlement pay straight as
   *     HO, excluded from the cap
   * So a fully-worked 24-hr holiday is 24 RG + 12 HW; a 2-hr holdover is
   * 2 RG + 2 HW + 10 HO, exactly as described by the member.
   */
  holidayHoursWorked: number;
  /**
   * Meaningful only when isHoliday and holidayHoursWorked > 0. Per city
   * policy 501.1.1(G): a member who works a holiday can elect "Holiday
   * Worked-Accrued" (HWA) instead of cash HW — banking the 1.5x premium
   * hours to use later rather than being paid for them this check.
   * Confirmed directly: this only replaces the HW premium itself, not the
   * underlying RG wage for hours actually worked, which always still pays
   * cash — matching how ordinary FLSA comp time only banks the OT premium,
   * never the straight-time pay underneath it.
   */
  holidayWorkedAccrued: boolean;
}

function datesInPeriod(period: Period): string[] {
  const dates: string[] = [];
  let cur = period.start;
  while (cur <= period.end) {
    dates.push(cur);
    cur = addDays(cur, 1);
  }
  return dates;
}

export function findPeriodForDate(
  year: PayYear,
  date: string,
): Period | undefined {
  if (date < year.effectiveFrom) return year.periods[0];
  if (date > year.effectiveTo) return year.periods[year.periods.length - 1];
  return year.periods.find((p) => p.start <= date && date <= p.end);
}

/**
 * Seeds one day's default entry from the deterministic rotation and the
 * holiday calendar — the same auto-population the sheet does
 * (BUILD_PLAN.md §4): a holiday date defaults to however many hours the
 * shift is actually scheduled to work that day (0 if it's an off day,
 * which naturally defaults holidayHoursWorked to 0 -> full 12-hr
 * holiday-observed).
 */
function defaultEntry(
  year: PayYear,
  shift: ShiftLetter,
  date: string,
  holidayDates: ReadonlySet<string>,
  defaultStepUpGrade: PayGrade,
): DayEntry {
  const scheduledHours = scheduledHoursOn(year, shift, date);
  const isHoliday = holidayDates.has(date);

  if (isHoliday) {
    return {
      date,
      scheduledHours,
      isHoliday,
      // Holiday days ignore `lines` entirely — holidayHoursWorked drives
      // the whole RG/HW/HO split.
      lines: [],
      holidayHoursWorked: scheduledHours,
      holidayWorkedAccrued: false,
    };
  }
  return {
    date,
    scheduledHours,
    isHoliday,
    lines: [
      scheduledHours > 0
        ? { type: "regular", hours: scheduledHours, grade: defaultStepUpGrade }
        : { type: "off", hours: 0, grade: defaultStepUpGrade },
    ],
    holidayHoursWorked: 0,
    holidayWorkedAccrued: false,
  };
}

/**
 * @param memberGrade The member's own current grade (Setup), used only to
 * default a step-up entry's grade to the one directly above it — Step 0 of
 * the covered grade, per docs/PAY_PLAN.md, regardless of the member's own
 * step within their grade. Falls back to F2 if not yet known (e.g. data
 * saved before Setup captured grade) or if the member is already at the
 * year's top grade.
 */
export function defaultDayEntries(
  year: PayYear,
  shift: ShiftLetter,
  period: Period,
  memberGrade?: PayGrade | null,
): DayEntry[] {
  const holidayDates = new Set(year.holidays.map((h) => h.date));
  const defaultStepUpGrade =
    (memberGrade ? nextGradeUp(year, memberGrade) : null) ??
    FALLBACK_STEP_UP_GRADE;
  return datesInPeriod(period).map((date) =>
    defaultEntry(year, shift, date, holidayDates, defaultStepUpGrade),
  );
}

/**
 * Seeds a 9/80 admin period's default schedule: Mon-Thu = 9hrs regular,
 * the profile's off-Friday = 0 (off), the other Friday = 8hrs regular,
 * Sat/Sun = 0. No holiday/step-up handling — out of scope for this track
 * (docs note in the admin build: civilians aren't on this track at all,
 * and holidays are a v1 scope cut for everyone on it).
 */
export function defaultAdmin9080DayEntries(
  period: Period,
  fridayGroup: FridayGroup,
): DayEntry[] {
  const [friday1, friday2] = findFridaysInPeriod(period);
  // DayLine.grade only matters for type "stepUp", which this track never
  // uses — any placeholder grade is fine here.
  const placeholderGrade: PayGrade = "F4";

  return datesInPeriod(period).map((date) => {
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    let hours = 0;
    if (dow >= 1 && dow <= 4) {
      hours = 9; // Mon-Thu
    } else if (date === friday1) {
      hours = fridayGroup === "week1" ? 0 : 8;
    } else if (date === friday2) {
      hours = fridayGroup === "week1" ? 8 : 0;
    }
    return {
      date,
      scheduledHours: hours,
      isHoliday: false,
      lines: [
        hours > 0
          ? { type: "regular", hours, grade: placeholderGrade }
          : { type: "off", hours: 0, grade: placeholderGrade },
      ],
      holidayHoursWorked: 0,
      holidayWorkedAccrued: false,
    };
  });
}

export function entriesToBlocks(entries: DayEntry[]): HourBlock[] {
  const blocks: HourBlock[] = [];
  for (const entry of entries) {
    if (entry.isHoliday) {
      const worked = Math.min(24, Math.max(0, entry.holidayHoursWorked));

      // Every hour actually worked is an ordinary regular hour, paid at the
      // effective rate and counted toward the 106-hr cap. Always cash — RG
      // is the wage for hours actually worked, never bankable, same as
      // ordinary FLSA comp time never defers straight-time pay.
      if (worked > 0) {
        blocks.push({
          date: entry.date,
          type: "regular",
          hours: worked,
          destination: "cash",
        });
      }

      // HW: the 1.5x premium adder, capped at the 12-hr entitlement. Working
      // past 12 on one holiday earns no further premium (the hours are still
      // paid as regular above). Independently bankable as HWA.
      const hwHours = Math.min(worked, HOLIDAY_ENTITLEMENT_HOURS);
      if (hwHours > 0) {
        blocks.push({
          date: entry.date,
          type: "holidayWorked",
          hours: hwHours,
          destination: entry.holidayWorkedAccrued ? "accrue" : "cash",
        });
      }

      // HO: the unworked remainder of the entitlement. Never bankable —
      // confirmed directly: unlike the worked side's HWA option, holiday
      // observed always pays cash.
      const leftover = Math.max(0, HOLIDAY_ENTITLEMENT_HOURS - worked);
      if (leftover > 0) {
        blocks.push({
          date: entry.date,
          type: "holidayObserved",
          hours: leftover,
          destination: "cash",
        });
      }
      continue;
    }

    for (const line of entry.lines) {
      if (line.type === "off" || line.hours <= 0) continue;
      if (line.type === "pto") {
        blocks.push({ date: entry.date, type: "pto", hours: line.hours });
      } else if (line.type === "stepUp") {
        blocks.push({
          date: entry.date,
          type: "stepUp",
          hours: line.hours,
          destination: "cash",
          grade: line.grade,
        });
      } else {
        blocks.push({
          date: entry.date,
          type: line.type,
          hours: line.hours,
          destination: "cash",
        });
      }
    }
  }
  return blocks;
}

export function blocksToEntries(
  year: PayYear,
  shift: ShiftLetter,
  period: Period,
  blocks: HourBlock[],
  memberGrade?: PayGrade | null,
): DayEntry[] {
  const defaults = defaultDayEntries(year, shift, period, memberGrade);
  const blocksByDate = new Map<string, HourBlock[]>();
  for (const block of blocks) {
    const existing = blocksByDate.get(block.date);
    if (existing) existing.push(block);
    else blocksByDate.set(block.date, [block]);
  }

  return defaults.map((entry) => {
    const dayBlocks = blocksByDate.get(entry.date) ?? [];

    if (entry.isHoliday) {
      // The regular block carries the full worked-hours figure; HW is only
      // the capped premium slice of it, so it can't be used to reconstruct
      // hours past 12.
      const workedBlock = dayBlocks.find((b) => b.type === "regular");
      const hwBlock = dayBlocks.find((b) => b.type === "holidayWorked");
      return {
        ...entry,
        holidayHoursWorked: workedBlock?.hours ?? 0,
        holidayWorkedAccrued: hwBlock?.destination === "accrue",
      };
    }

    const defaultGrade = entry.lines[0]?.grade ?? FALLBACK_STEP_UP_GRADE;
    const lines: DayLine[] = [];
    for (const block of dayBlocks) {
      if (lines.length >= MAX_DAY_LINES) break;
      if (block.type === "pto") {
        lines.push({ type: "pto", hours: block.hours, grade: defaultGrade });
      } else if (block.type === "stepUp") {
        lines.push({
          type: "stepUp",
          hours: block.hours,
          grade: block.grade,
        });
      } else if (block.type === "regular" || block.type === "tifmas") {
        lines.push({
          type: block.type,
          hours: block.hours,
          grade: defaultGrade,
        });
      }
    }

    if (lines.length === 0) {
      lines.push({ type: "off", hours: 0, grade: defaultGrade });
    }
    return { ...entry, lines };
  });
}

/** Reconstructs a 9/80 admin period's entries from saved blocks, same
 * relationship `blocksToEntries` has to `defaultDayEntries`. Only ever
 * expects "regular"/"pto" blocks — stepUp/tifmas/holiday blocks shouldn't
 * occur on this track, and are just ignored (not crashed on) if stale data
 * from a track switch somehow contains them. */
export function blocksToAdminEntries(
  period: Period,
  fridayGroup: FridayGroup,
  blocks: HourBlock[],
): DayEntry[] {
  const defaults = defaultAdmin9080DayEntries(period, fridayGroup);
  const blocksByDate = new Map<string, HourBlock[]>();
  for (const block of blocks) {
    const existing = blocksByDate.get(block.date);
    if (existing) existing.push(block);
    else blocksByDate.set(block.date, [block]);
  }

  return defaults.map((entry) => {
    const dayBlocks = blocksByDate.get(entry.date) ?? [];
    const placeholderGrade = entry.lines[0]?.grade ?? "F4";
    const lines: DayLine[] = [];
    for (const block of dayBlocks) {
      if (lines.length >= MAX_DAY_LINES) break;
      if (block.type === "pto" || block.type === "regular") {
        lines.push({
          type: block.type,
          hours: block.hours,
          grade: placeholderGrade,
        });
      }
    }
    if (lines.length === 0) {
      lines.push({ type: "off", hours: 0, grade: placeholderGrade });
    }
    return { ...entry, lines };
  });
}

export interface AggregatedLineItem {
  label: string;
  hours: number;
  amount: number;
}

/** Collapses per-day line items into one row per pay code, for a compact
 * itemized display and for matching against what a real check shows. */
export function aggregateLineItems(
  lineItems: LineItem[],
): AggregatedLineItem[] {
  const byLabel = new Map<string, AggregatedLineItem>();
  for (const item of lineItems) {
    const existing = byLabel.get(item.label);
    if (existing) {
      existing.hours += item.hours;
      existing.amount += item.amount;
    } else {
      byLabel.set(item.label, {
        label: item.label,
        hours: item.hours,
        amount: item.amount,
      });
    }
  }
  return [...byLabel.values()];
}
