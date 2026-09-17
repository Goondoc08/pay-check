import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const shiftLetter = z.enum(["A", "B", "C"]);
const destination = z.enum(["cash", "comp", "accrue"]);
const payGrade = z.enum(["F1", "F2", "F3", "F4", "F5"]);
const employeeTrack = z.enum(["shift", "admin9080"]);
const fridayGroup = z.enum(["week1", "week2"]);

const rateSegmentSchema = z.object({
  effectiveFrom: isoDate,
  hourlyRate: z.number().nonnegative(),
  incentiveTotal: z.number().nonnegative(),
});

const hourBlockSchema = z.discriminatedUnion("type", [
  z.object({
    date: isoDate,
    type: z.literal("regular"),
    hours: z.number().nonnegative(),
    destination,
  }),
  z.object({
    date: isoDate,
    type: z.literal("stepUp"),
    hours: z.number().nonnegative(),
    destination,
    grade: payGrade,
  }),
  z.object({
    date: isoDate,
    type: z.literal("tifmas"),
    hours: z.number().nonnegative(),
    destination,
  }),
  z.object({
    date: isoDate,
    type: z.literal("holidayWorked"),
    hours: z.number().nonnegative(),
    destination,
  }),
  z.object({
    date: isoDate,
    type: z.literal("holidayObserved"),
    hours: z.number().nonnegative(),
    destination,
  }),
  z.object({
    date: isoDate,
    type: z.literal("pto"),
    hours: z.number().nonnegative(),
  }),
]);

export const profileSchema = z.object({
  // .default("shift") so profiles saved before this field existed still
  // parse as the track they always were.
  track: employeeTrack.default("shift"),
  // .nullable().default(null) so admin9080 profiles (which have no shift)
  // parse, and so old "shift"-only saves keep working unchanged.
  shift: shiftLetter.nullable().default(null),
  // Meaningful only when track === "admin9080".
  fridayGroup: fridayGroup.nullable().default(null),
  rateSegments: z.array(rateSegmentSchema).min(1),
  /**
   * Last annual longevity payoff (LP pay code). Defaults to 0 so profiles
   * saved before this field existed still parse — a member who hasn't
   * entered it simply gets no longevity term in their FLSA premium, which
   * is the old (slightly low) behaviour rather than a validation failure.
   */
  longevityAnnual: z.number().nonnegative().default(0),
});

/**
 * Setup-screen metadata used to auto-project a member's next step
 * (civil-service rule: step lands on hire/promotion anniversary, not a
 * shared fiscal-year date — docs/PAY_PLAN.md). Not read by the engine —
 * it only ever sees the resulting rateSegments — kept here so Setup can
 * re-derive the same projection next time it's opened instead of asking
 * again from scratch.
 */
export const progressionSchema = z.object({
  /** Always captured once Setup is completed, whether or not the member
   * enters a step date — also drives step-up's default ride-up target
   * (the grade immediately above this one). */
  grade: payGrade,
  /** Hire date, or most recent promotion date if later — whichever the
   * member's next step actually lands on. Null if not entered — grade is
   * still captured either way. */
  anniversaryDate: isoDate.nullable(),
  /** Whether the member confirmed they're on track for the projected
   * step (civil-service progression is "for employees in good
   * standing," so this isn't automatic). Meaningless when
   * anniversaryDate is null. */
  receivingStep: z.boolean(),
});

/**
 * Setup-screen metadata: which certifications drove the profile's combined
 * incentiveTotal. Not read by the engine (it only ever sees that single
 * summed rate) — kept here so Setup can show the member's actual picks
 * again next time, instead of resetting every dropdown to "None" and
 * risking a re-save that silently zeroes their incentive pay.
 */
export const certificationsSchema = z.object({
  tcfp: z.string().nullable(),
  education: z.string().nullable(),
  emt: z.string().nullable(),
  bilingual: z.boolean(),
  assignment: z.string().nullable(),
});

export const hourBlockListSchema = z.array(hourBlockSchema);

/** Key: `${yearId}:${periodNumber}`, e.g. "FY27:14". */
export const periodEntriesSchema = z.record(z.string(), hourBlockListSchema);

export const textSizeSchema = z.enum(["normal", "large", "xlarge"]);

/** "system" follows the OS/browser's own light-dark preference. */
export const themeSchema = z.enum(["system", "light", "dark"]);

export const settingsSchema = z.object({
  selectedYearId: z.string().nullable(),
  // .default(false) so data saved before this field existed still parses —
  // treated as "not yet dismissed," which just shows the card once more.
  installCardDismissed: z.boolean().default(false),
  // .default("normal") so data saved before this field existed still parses.
  textSize: textSizeSchema.default("normal"),
  // .default("system") so data saved before this field existed still parses.
  theme: themeSchema.default("system"),
});

export const storedDataV1Schema = z.object({
  version: z.literal(1),
  profile: profileSchema.nullable(),
  periodEntries: periodEntriesSchema,
  settings: settingsSchema,
  // .default(null) so data saved before this field existed still parses.
  progression: progressionSchema.nullable().default(null),
  certifications: certificationsSchema.nullable().default(null),
});

export type StoredDataV1 = z.infer<typeof storedDataV1Schema>;

export function emptyStoredData(): StoredDataV1 {
  return {
    version: 1,
    profile: null,
    periodEntries: {},
    settings: {
      selectedYearId: null,
      installCardDismissed: false,
      textSize: "normal",
      theme: "system",
    },
    progression: null,
    certifications: null,
  };
}

export function periodEntryKey(yearId: string, periodNumber: number): string {
  return `${yearId}:${periodNumber}`;
}
