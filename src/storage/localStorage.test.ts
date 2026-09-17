import { describe, expect, it } from "vitest";
import { clear, load, save, type StorageLike } from "./localStorage";
import { emptyStoredData, type StoredDataV1 } from "./schema";

function fakeStorage(initial: Record<string, string> = {}): StorageLike {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
  };
}

const sample: StoredDataV1 = {
  version: 1,
  profile: {
    shift: "A",
    track: "shift",
    fridayGroup: null,
    rateSegments: [
      { effectiveFrom: "2026-09-26", hourlyRate: 26.8173, incentiveTotal: 0 },
    ],
    longevityAnnual: 0,
  },
  periodEntries: {
    "FY27:1": [
      { date: "2026-09-27", type: "regular", hours: 24, destination: "cash" },
    ],
  },
  settings: {
    selectedYearId: "FY27",
    installCardDismissed: false,
    textSize: "normal",
    theme: "system",
  },
  progression: null,
  certifications: null,
};

describe("load", () => {
  it("returns empty defaults when nothing is stored", () => {
    const result = load(fakeStorage());
    expect(result.data).toEqual(emptyStoredData());
    expect(result.recovered).toBe(false);
  });

  it("returns empty defaults when storage itself is unavailable", () => {
    const result = load(null);
    expect(result.data).toEqual(emptyStoredData());
    expect(result.recovered).toBe(false);
  });

  it("round-trips valid stored data exactly", () => {
    const storage = fakeStorage();
    save(sample, storage);
    const result = load(storage);
    expect(result.data).toEqual(sample);
    expect(result.recovered).toBe(false);
  });

  it("falls back to defaults on corrupted (non-JSON) storage", () => {
    const storage = fakeStorage({ "pay-calculator:v1": "{not json" });
    const result = load(storage);
    expect(result.data).toEqual(emptyStoredData());
    expect(result.recovered).toBe(true);
  });

  it("falls back to defaults when getItem throws (storage blocked)", () => {
    const storage: StorageLike = {
      getItem: () => {
        throw new Error("SecurityError: storage disabled");
      },
      setItem: () => {},
      removeItem: () => {},
    };
    const result = load(storage);
    expect(result.data).toEqual(emptyStoredData());
    expect(result.recovered).toBe(true);
  });

  it("recovers a valid profile even when one period entry is corrupt", () => {
    const storage = fakeStorage({
      "pay-calculator:v1": JSON.stringify({
        version: 1,
        profile: sample.profile,
        periodEntries: {
          "FY27:1": sample.periodEntries["FY27:1"],
          "FY27:2": [{ date: "not-a-date", type: "bogus" }],
        },
        settings: { selectedYearId: "FY27" },
      }),
    });
    const result = load(storage);
    expect(result.recovered).toBe(true);
    expect(result.data.profile).toEqual(sample.profile);
    expect(result.data.periodEntries["FY27:1"]).toEqual(
      sample.periodEntries["FY27:1"],
    );
    expect(result.data.periodEntries["FY27:2"]).toBeUndefined();
  });

  it("migrates an unversioned legacy shape", () => {
    const storage = fakeStorage({
      "pay-calculator:v1": JSON.stringify({
        shift: "B",
        hourlyRate: 33.3021,
        incentiveTotal: 0.625,
        periodEntries: {
          "FY27:1": [
            {
              date: "2026-09-29",
              type: "regular",
              hours: 24,
              destination: "cash",
            },
          ],
        },
      }),
    });
    const result = load(storage);
    expect(result.recovered).toBe(true);
    expect(result.data.profile).toEqual({
      shift: "B",
      track: "shift",
      fridayGroup: null,
      rateSegments: [
        {
          effectiveFrom: "1970-01-01",
          hourlyRate: 33.3021,
          incentiveTotal: 0.625,
        },
      ],
      longevityAnnual: 0,
    });
    expect(result.data.periodEntries["FY27:1"]).toHaveLength(1);
  });
});

describe("save", () => {
  it("reports failure without throwing when setItem is blocked (quota exceeded)", () => {
    const storage: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      },
      removeItem: () => {},
    };
    const result = save(sample, storage);
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("reports failure when storage is unavailable", () => {
    const result = save(sample, null);
    expect(result.ok).toBe(false);
  });
});

describe("clear", () => {
  it("removes stored data", () => {
    const storage = fakeStorage();
    save(sample, storage);
    clear(storage);
    expect(load(storage).data).toEqual(emptyStoredData());
  });

  it("doesn't throw when storage is unavailable", () => {
    expect(() => clear(null)).not.toThrow();
  });
});
