import { describe, expect, it } from "vitest";
import { effectiveRate } from "./rate";
import type { Profile } from "./types";

describe("effectiveRate", () => {
  const singleSegmentProfile: Profile = {
    shift: "A",
    track: "shift",
    fridayGroup: null,
    rateSegments: [
      { effectiveFrom: "2026-09-26", hourlyRate: 26.8173, incentiveTotal: 0 },
    ],
    longevityAnnual: 0,
  };

  it("returns base + incentive for a single-segment profile", () => {
    expect(effectiveRate(singleSegmentProfile, "2027-01-01")).toBeCloseTo(
      26.8173,
    );
  });

  it("folds incentives into the rate", () => {
    const withIncentive: Profile = {
      shift: "A",
      track: "shift",
      fridayGroup: null,
      rateSegments: [
        {
          effectiveFrom: "2026-09-26",
          hourlyRate: 26.8173,
          incentiveTotal: 0.625,
        },
      ],
      longevityAnnual: 0,
    };
    expect(effectiveRate(withIncentive, "2027-01-01")).toBeCloseTo(27.4423);
  });

  it("picks the old rate before a step date and the new rate at/after it", () => {
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
    expect(effectiveRate(splitProfile, "2027-03-31")).toBeCloseTo(26.8173);
    expect(effectiveRate(splitProfile, "2027-04-01")).toBeCloseTo(27.621819);
    expect(effectiveRate(splitProfile, "2027-04-08")).toBeCloseTo(27.621819);
  });

  it("is order-independent for rate segments", () => {
    const outOfOrder: Profile = {
      shift: "A",
      track: "shift",
      fridayGroup: null,
      rateSegments: [
        {
          effectiveFrom: "2027-04-01",
          hourlyRate: 27.621819,
          incentiveTotal: 0,
        },
        { effectiveFrom: "2026-09-26", hourlyRate: 26.8173, incentiveTotal: 0 },
      ],
      longevityAnnual: 0,
    };
    expect(effectiveRate(outOfOrder, "2027-03-31")).toBeCloseTo(26.8173);
    expect(effectiveRate(outOfOrder, "2027-04-01")).toBeCloseTo(27.621819);
  });
});
