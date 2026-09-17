import { describe, expect, it } from "vitest";
import { exportToJson, importFromJson } from "./exportImport";
import { load, save, type StorageLike } from "./localStorage";
import type { StoredDataV1 } from "./schema";

function fakeStorage(): StorageLike {
  const store = new Map<string, string>();
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
    shift: "C",
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
  },
  periodEntries: {
    "FY27:5": [
      { date: "2026-11-21", type: "regular", hours: 24, destination: "cash" },
      {
        date: "2026-11-26",
        type: "holidayWorked",
        hours: 24,
        destination: "cash",
      },
    ],
  },
  settings: {
    selectedYearId: "FY27",
    installCardDismissed: false,
    textSize: "normal",
    theme: "system",
  },
  progression: {
    grade: "F1",
    anniversaryDate: "2027-04-01",
    receivingStep: true,
  },
  certifications: {
    tcfp: "Adv",
    education: null,
    emt: "Paramedic",
    bilingual: false,
    assignment: null,
  },
};

describe("export / import", () => {
  it("round-trips through JSON with no data loss", () => {
    const json = exportToJson(sample);
    const result = importFromJson(json);
    expect(result.ok).toBe(true);
    expect(result.data).toEqual(sample);
  });

  it("Phase 04 gate: export from one browser, import into another, identical numbers", () => {
    const browserA = fakeStorage();
    save(sample, browserA);

    const exported = exportToJson(load(browserA).data);

    const browserB = fakeStorage();
    const imported = importFromJson(exported);
    expect(imported.ok).toBe(true);
    save(imported.data as StoredDataV1, browserB);

    expect(load(browserB).data).toEqual(load(browserA).data);
  });

  it("rejects invalid JSON", () => {
    const result = importFromJson("{not json");
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("rejects well-formed JSON that isn't a 48/96 export", () => {
    const result = importFromJson(JSON.stringify({ hello: "world" }));
    expect(result.ok).toBe(false);
  });

  it("imports a legacy unversioned export via migration", () => {
    const legacy = JSON.stringify({
      shift: "A",
      hourlyRate: 26.8173,
      incentiveTotal: 0,
      periodEntries: {},
    });
    const result = importFromJson(legacy);
    expect(result.ok).toBe(true);
    expect(result.data?.profile?.shift).toBe("A");
  });
});
