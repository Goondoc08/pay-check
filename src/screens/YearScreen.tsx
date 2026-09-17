import { useMemo } from "react";
import { AVAILABLE_YEARS } from "../app/years";
import { useAppData } from "../app/AppData";
import { buildYearCsv } from "../app/csvExport";
import {
  blocksToAdminEntries,
  blocksToEntries,
  defaultAdmin9080DayEntries,
  defaultDayEntries,
  entriesToBlocks,
} from "../app/period";
import type { PayYear } from "../data/schema";
import { computeAdminPeriod } from "../engine/adminPeriod";
import { computePeriod } from "../engine/period";
import type { Profile } from "../engine/types";

export function YearScreen({
  year,
  profile,
  onSelectPeriod,
  onSelectYear,
}: {
  year: PayYear;
  profile: Profile;
  onSelectPeriod: (periodNumber: number) => void;
  onSelectYear: (yearId: string) => void;
}) {
  const { getPeriodBlocks, progression } = useAppData();
  const memberGrade = progression?.grade ?? null;
  const isAdmin = profile.track === "admin9080";
  const shift = profile.shift ?? "A";
  const fridayGroup = profile.fridayGroup ?? "week1";

  const rows = useMemo(() => {
    let running = 0;
    return year.periods.map((period) => {
      const saved = getPeriodBlocks(year.id, period.n);
      const entries = isAdmin
        ? saved.length > 0
          ? blocksToAdminEntries(period, fridayGroup, saved)
          : defaultAdmin9080DayEntries(period, fridayGroup)
        : saved.length > 0
          ? blocksToEntries(year, shift, period, saved, memberGrade)
          : defaultDayEntries(year, shift, period, memberGrade);
      const blocks = entriesToBlocks(entries);
      const result = isAdmin
        ? computeAdminPeriod(
            profile,
            period,
            blocks,
            period.n > 1 ? getPeriodBlocks(year.id, period.n - 1) : [],
          )
        : computePeriod(year, profile, blocks);
      running += result.gross;
      return {
        period,
        totalHours: result.totalHours,
        otHours: result.otHours,
        gross: result.gross,
        running,
        hasEntries: saved.length > 0,
      };
    });
  }, [
    year,
    profile,
    getPeriodBlocks,
    memberGrade,
    isAdmin,
    shift,
    fridayGroup,
  ]);

  function handleExportCsv() {
    const csv = buildYearCsv(
      rows.map((r) => ({
        periodNumber: r.period.n,
        start: r.period.start,
        end: r.period.end,
        totalHours: r.totalHours,
        otHours: r.otHours,
        gross: r.gross,
        running: r.running,
        hasEntries: r.hasEntries,
      })),
    );
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pay-check-${year.id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-4 p-4 text-ink">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{year.label}</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExportCsv}
            className="rounded-md border border-line px-2 py-1 text-sm"
          >
            Export CSV
          </button>
          {AVAILABLE_YEARS.length > 1 && (
            <select
              className="rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink"
              value={year.id}
              onChange={(e) => onSelectYear(e.target.value)}
            >
              {AVAILABLE_YEARS.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.label}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {rows.map(({ period, gross, running, hasEntries }) => (
          <button
            key={period.n}
            type="button"
            onClick={() => onSelectPeriod(period.n)}
            className="flex items-center justify-between rounded-lg border border-line p-3 text-left"
          >
            <div>
              <div className="text-sm font-medium">
                Period {period.n}
                {!hasEntries && (
                  <span className="ml-2 text-xs text-ink-muted">
                    (default schedule)
                  </span>
                )}
              </div>
              <div className="text-xs text-ink-muted">
                {period.start} – {period.end}
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm font-semibold">${gross.toFixed(2)}</div>
              <div className="text-xs text-ink-muted">
                running ${running.toFixed(2)}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
