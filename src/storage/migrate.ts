import { emptyStoredData, type StoredDataV1 } from "./schema";

export const CURRENT_VERSION = 1;

/**
 * Shape used by an early unversioned prototype build, before the storage
 * wrapper existed: profile fields at the top level, no `version` key.
 * Treated as "version 0" so it has a real migration path to prove out,
 * not just a promise.
 */
interface LegacyV0Shape {
  shift?: "A" | "B" | "C";
  hourlyRate?: number;
  incentiveTotal?: number;
  periodEntries?: Record<string, unknown[]>;
}

const LEGACY_V0_FIELDS = [
  "shift",
  "hourlyRate",
  "incentiveTotal",
  "periodEntries",
] as const;

function isLegacyV0Shape(data: unknown): data is LegacyV0Shape {
  if (typeof data !== "object" || data === null) return false;
  if ("version" in data) return false;
  return LEGACY_V0_FIELDS.some((field) => field in data);
}

function migrateV0toV1(legacy: LegacyV0Shape): StoredDataV1 {
  const base = emptyStoredData();
  return {
    ...base,
    profile:
      legacy.shift && typeof legacy.hourlyRate === "number"
        ? {
            shift: legacy.shift,
            track: "shift" as const,
            fridayGroup: null,
            rateSegments: [
              {
                effectiveFrom: "1970-01-01",
                hourlyRate: legacy.hourlyRate,
                incentiveTotal: legacy.incentiveTotal ?? 0,
              },
            ],
            // Predates the field; Setup will prompt for it.
            longevityAnnual: 0,
          }
        : null,
    periodEntries: (legacy.periodEntries ??
      {}) as StoredDataV1["periodEntries"],
  };
}

/**
 * Runs whatever migrations are needed to bring raw stored data up to
 * `CURRENT_VERSION`. Returns the migrated (but not yet schema-validated)
 * object — the caller still validates it, since a migration can't rule out
 * corruption within fields it doesn't touch.
 */
export function migrateToCurrent(raw: unknown): unknown {
  if (isLegacyV0Shape(raw)) {
    return migrateV0toV1(raw);
  }
  return raw;
}
