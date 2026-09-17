import { describe, expect, it } from "vitest";
import { profileSchema, storedDataV1Schema } from "./schema";

/**
 * Guards the thing that actually matters when a field gets added to a
 * schema that's already live on real devices: does an already-saved
 * payload, with no trace of the new keys, still parse to the same
 * behavior? Written when `track`/`fridayGroup` were added for the admin
 * 9/80 track (period.ts/adminPeriod.ts) — every existing fire-ops user's
 * saved profile predates both fields entirely.
 */
describe("backward compatibility for real pre-existing saved data", () => {
  it("parses a profile saved before track/fridayGroup existed, with no trace of those keys", () => {
    // Exactly the shape a real user's localStorage has today — no `track`,
    // no `fridayGroup`, because those fields didn't exist when they saved.
    const realOldProfile = {
      shift: "A",
      rateSegments: [
        {
          effectiveFrom: "2026-09-26",
          hourlyRate: 35.3302,
          incentiveTotal: 3.0906,
        },
      ],
      longevityAnnual: 284,
    };
    const result = profileSchema.parse(realOldProfile);
    expect(result.track).toBe("shift");
    expect(result.shift).toBe("A");
    expect(result.fridayGroup).toBe(null);
    expect(result.rateSegments).toEqual(realOldProfile.rateSegments);
    expect(result.longevityAnnual).toBe(284);
  });

  it("parses a full pre-existing StoredDataV1 payload (the actual localStorage shape) unchanged", () => {
    const realOldStoredData = {
      version: 1,
      profile: {
        shift: "C",
        rateSegments: [
          {
            effectiveFrom: "2026-09-26",
            hourlyRate: 26.8173,
            incentiveTotal: 0,
          },
        ],
        longevityAnnual: 0,
      },
      periodEntries: {
        "FY27:14": [
          {
            date: "2027-03-27",
            type: "regular",
            hours: 24,
            destination: "cash",
          },
        ],
      },
      settings: { selectedYearId: "FY27", installCardDismissed: true },
      progression: {
        grade: "F2",
        anniversaryDate: "2020-06-01",
        receivingStep: true,
      },
      certifications: null,
    };
    const result = storedDataV1Schema.parse(realOldStoredData);
    expect(result.profile?.track).toBe("shift");
    expect(result.profile?.shift).toBe("C");
    expect(result.profile?.fridayGroup).toBe(null);
    // Everything else survives byte-for-byte.
    expect(result.profile?.rateSegments).toEqual(
      realOldStoredData.profile.rateSegments,
    );
    expect(result.periodEntries).toEqual(realOldStoredData.periodEntries);
    expect(result.settings.selectedYearId).toBe("FY27");
    expect(result.progression).toEqual(realOldStoredData.progression);
  });
});
