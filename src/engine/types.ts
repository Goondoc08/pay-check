export type ShiftLetter = "A" | "B" | "C";

/**
 * "shift" is the original 24-hr rotating fire-suppression track. "admin9080"
 * is Captains/BCs assigned to admin, working a 9/80 schedule on a Friday-
 * noon-to-Friday-noon FLSA workweek instead — see engine/adminPeriod.ts.
 * Civilian (non-step-plan) admin staff are out of scope; this track is only
 * for members still on the grade/step pay plan.
 */
export type EmployeeTrack = "shift" | "admin9080";

/**
 * Which Friday of every pay period an admin9080 member has off — fixed per
 * person, never changes. "week1" is off the period's first Friday (the
 * payday Friday, since pay lags a period) and works the last one; "week2"
 * is the reverse.
 */
export type FridayGroup = "week1" | "week2";
/**
 * F1 (Fire Fighter) .. F4/F5 (Battalion Chief) — see docs/PAY_PLAN.md.
 * FY26 has 5 grades; FY27's proposed Lieutenant/Captain merger drops it to
 * 4, so F4 means different things depending on the active year — always
 * read grade labels from the year file's own payPlan keys, never assume
 * a fixed 4-grade structure.
 */
export type PayGrade = "F1" | "F2" | "F3" | "F4" | "F5";

/** Where a block of hours is paid out: cash on this check, or banked (comp/accrue). */
export type Destination = "cash" | "comp" | "accrue";

/**
 * A rate as of a given date. `hourlyRate` + `incentiveTotal` is the
 * "effective rate" (base + incentives). A profile carries more than one
 * segment only for the single period spanning a step/anniversary date; the
 * app otherwise just asks the member for their current rate.
 */
export interface RateSegment {
  effectiveFrom: string; // ISO date, inclusive
  hourlyRate: number;
  incentiveTotal: number;
}

export interface Profile {
  /** Defaults to "shift" for every profile saved before this field existed. */
  track: EmployeeTrack;
  /** Meaningful only when track === "shift"; null for admin9080. */
  shift: ShiftLetter | null;
  /** Meaningful only when track === "admin9080"; null for shift. */
  fridayGroup: FridayGroup | null;
  /** Sorted ascending by effectiveFrom. Must have at least one segment. */
  rateSegments: RateSegment[];
  /**
   * Last annual longevity payoff (the LP pay code), in dollars. Paid on its
   * own check each October, but FLSA still requires this non-discretionary
   * pay to be folded into the "regular rate" for overtime, so it adds
   * `(longevityAnnual / 2912) x otHours x 0.5` to every period's FLSA
   * premium (2912 for "shift"; 2080 for "admin9080" — see
   * engine/adminPeriod.ts). Verified against a real check: omitting it left
   * the engine $0.30 light on a 6-hr-OT period. Both workbooks carry it as
   * the "Last Longevity" input cell (N3) and use exactly this formula.
   */
  longevityAnnual: number;
}

interface BlockBase {
  date: string; // ISO date
}

export interface RegularBlock extends BlockBase {
  type: "regular";
  hours: number;
  destination: Destination;
}

export interface StepUpBlock extends BlockBase {
  type: "stepUp";
  hours: number;
  destination: Destination;
  /**
   * The grade being covered — step-up pays Step 0 of this grade, plus the
   * member's own incentive pay (riding up doesn't suspend personal certs).
   */
  grade: PayGrade;
}

/**
 * State TIFMAS mobilization pay. Counts toward the 106-hr cap like regular
 * hours, but prices at 1.5x the base hourly rate plus incentive at straight
 * time — see `tifmasRate` in rate.ts.
 */
export interface TifmasBlock extends BlockBase {
  type: "tifmas";
  hours: number;
  destination: Destination;
}

/**
 * The HW pay code — a 1.5x premium ADDER, not a replacement. Hours actually
 * worked on a holiday are ALSO paid as an ordinary `regular` block (and count
 * toward the 106-hr cap like any other worked hours); this block sits on top
 * of that. Capped at 12 hrs per holiday date.
 *
 * Verified against a real check (12/20/2025-01/02/2026): RG 106 hrs =
 * $4050.75 and HW 36 hrs = $2063.58 are priced off the same effective rate,
 * and RG + HW is exactly the stated gross. Both workbooks compute straight
 * pay as `J*(rate+inc) + HO*(rate+inc) + HW*(rate+inc)*1.5`, where J already
 * includes the worked holiday hours.
 */
export interface HolidayWorkedBlock extends BlockBase {
  type: "holidayWorked";
  hours: number;
  destination: Destination;
}

/**
 * The HO pay code — the unworked remainder of the 12-hr entitlement, paid
 * straight at the effective rate. Also an adder, and never counts toward the
 * 106-hr cap (no hours were actually worked).
 */
export interface HolidayObservedBlock extends BlockBase {
  type: "holidayObserved";
  hours: number;
  destination: Destination;
}

export interface PtoBlock extends BlockBase {
  type: "pto";
  hours: number;
}

export type HourBlock =
  | RegularBlock
  | StepUpBlock
  | TifmasBlock
  | HolidayWorkedBlock
  | HolidayObservedBlock
  | PtoBlock;

export interface LineItem {
  label: string;
  date?: string;
  hours: number;
  rate: number;
  amount: number;
}

export interface PeriodResult {
  /**
   * Hours "on the clock" — worked hours plus PTO, matching the workbooks'
   * "Total Hours" (J) column. Deliberately excludes the HO/HW premium
   * adders, which are dollars layered on top rather than additional hours.
   */
  totalHours: number;
  otHours: number;
  gross: number;
  lineItems: LineItem[];
}
