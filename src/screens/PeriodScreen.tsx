import { useEffect, useState } from "react";
import { useAppData } from "../app/AppData";
import {
  aggregateLineItems,
  blocksToAdminEntries,
  blocksToEntries,
  defaultAdmin9080DayEntries,
  defaultDayEntries,
  entriesToBlocks,
  MAX_DAY_LINES,
  type DayEntry,
  type DayEntryType,
  type DayLine,
} from "../app/period";
import type { PayYear, Period } from "../data/schema";
import { computeAdminPeriod } from "../engine/adminPeriod";
import { computePeriod } from "../engine/period";
import type { PayGrade, Profile } from "../engine/types";

const TYPE_LABELS: Record<DayEntryType, string> = {
  off: "Off",
  regular: "Regular",
  pto: "PTO",
  stepUp: "Step-up",
  tifmas: "TIFMAS",
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function weekdayName(iso: string): string {
  return DAY_NAMES[new Date(`${iso}T00:00:00Z`).getUTCDay()];
}

const FIELD =
  "rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink";

function DayHeader({
  entry,
  holidayName,
}: {
  entry: DayEntry;
  holidayName?: string | undefined;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className="text-sm font-semibold">
        {weekdayName(entry.date)} {entry.date.slice(8)}
      </span>
      {entry.scheduledHours > 0 && !entry.isHoliday && (
        <span className="text-[0.625rem] uppercase tracking-wide text-ink-muted">
          scheduled
        </span>
      )}
      {holidayName && (
        <span className="truncate rounded-full bg-holiday-soft px-2 py-0.5 text-[0.625rem] font-medium text-holiday-ink">
          {holidayName}
        </span>
      )}
    </div>
  );
}

/**
 * A holiday row deliberately has ONE input — the hours actually worked —
 * with RG/HW/HO derived from it, rather than the generic type+hours lines.
 * That derivation is the part verified against real paystubs and both
 * workbooks, so it isn't something to hand-edit into a shape payroll
 * wouldn't produce.
 */
function HolidayRow({
  entry,
  holidayName,
  onChange,
}: {
  entry: DayEntry;
  holidayName?: string | undefined;
  onChange: (next: DayEntry) => void;
}) {
  const worked = Math.min(24, Math.max(0, entry.holidayHoursWorked));
  const hw = Math.min(worked, 12);
  const leftover = Math.max(0, 12 - worked);
  const chips = [
    worked > 0 && `${worked} RG`,
    hw > 0 && `${hw} HW`,
    leftover > 0 && `${leftover} HO`,
  ].filter(Boolean) as string[];

  return (
    <div className="rounded-lg border border-holiday bg-holiday-soft p-3 lg:p-2">
      <DayHeader entry={entry} holidayName={holidayName} />
      <div className="mt-2 flex items-center gap-2 lg:flex-col lg:items-stretch lg:gap-1">
        <label
          className="text-sm text-ink-muted lg:text-xs"
          htmlFor={`hw-${entry.date}`}
        >
          Hours worked
        </label>
        <input
          id={`hw-${entry.date}`}
          className={`${FIELD} w-20 lg:w-full`}
          type="number"
          min={0}
          max={24}
          step="0.25"
          inputMode="decimal"
          value={entry.holidayHoursWorked}
          onChange={(e) =>
            onChange({
              ...entry,
              holidayHoursWorked: Number(e.target.value) || 0,
            })
          }
        />
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {chips.length > 0 ? (
          chips.map((chip) => (
            <span
              key={chip}
              className="rounded bg-surface px-1.5 py-0.5 text-[0.6875rem] font-medium text-holiday-ink"
            >
              {chip}
            </span>
          ))
        ) : (
          <span className="text-[0.6875rem] text-ink-muted">—</span>
        )}
      </div>
      {/* HWA banks just the 1.5x premium — the RG for hours actually worked
          always still pays cash. HO is never bankable. */}
      {hw > 0 && (
        <label className="mt-2 flex items-center gap-2 text-xs text-ink-muted">
          <input
            type="checkbox"
            checked={entry.holidayWorkedAccrued}
            onChange={(e) =>
              onChange({ ...entry, holidayWorkedAccrued: e.target.checked })
            }
          />
          Accrue the HW premium instead of cash
        </label>
      )}
    </div>
  );
}

function LineFields({
  line,
  stepUpGrades,
  scheduledHours,
  allowedTypes,
  onChange,
  onRemove,
}: {
  line: DayLine;
  stepUpGrades: PayGrade[];
  scheduledHours: number;
  allowedTypes: DayEntryType[];
  onChange: (next: DayLine) => void;
  onRemove?: (() => void) | undefined;
}) {
  return (
    // Side by side below lg, where a row has the full page width to work
    // with; stacked at lg+, where each card is one of seven columns and a
    // select + hours input + grade select side by side wouldn't fit.
    <div className="flex flex-wrap items-center gap-2 lg:flex-col lg:flex-nowrap lg:items-stretch lg:gap-1">
      <div className="flex flex-1 items-center gap-2 lg:w-full lg:flex-none">
        <select
          aria-label="Hour type"
          className={`${FIELD} min-w-0 flex-1`}
          value={line.type}
          onChange={(e) => {
            const type = e.target.value as DayEntryType;
            const hours =
              type === "off" ? 0 : line.hours || scheduledHours || 24;
            onChange({ ...line, type, hours });
          }}
        >
          {allowedTypes.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t]}
            </option>
          ))}
        </select>

        {onRemove && (
          <button
            type="button"
            aria-label="Remove this entry"
            className="shrink-0 rounded-md px-2 py-1 text-ink-muted hover:text-warn lg:hidden"
            onClick={onRemove}
          >
            ✕
          </button>
        )}
      </div>

      {line.type !== "off" && (
        <input
          aria-label="Hours"
          className={`${FIELD} w-20 lg:w-full`}
          type="number"
          min={0}
          step="0.25"
          inputMode="decimal"
          value={line.hours}
          onChange={(e) =>
            onChange({ ...line, hours: Number(e.target.value) || 0 })
          }
        />
      )}

      {line.type === "stepUp" && (
        <select
          aria-label="Step-up grade"
          className={`${FIELD} w-20 lg:w-full`}
          value={line.grade}
          onChange={(e) =>
            onChange({ ...line, grade: e.target.value as PayGrade })
          }
        >
          {stepUpGrades.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      )}

      {onRemove && (
        <button
          type="button"
          aria-label="Remove this entry"
          className="hidden shrink-0 rounded-md text-xs text-ink-muted hover:text-warn lg:block"
          onClick={onRemove}
        >
          ✕ remove
        </button>
      )}
    </div>
  );
}

function DayRow({
  entry,
  stepUpGrades,
  allowedTypes,
  onChange,
}: {
  entry: DayEntry;
  stepUpGrades: PayGrade[];
  allowedTypes: DayEntryType[];
  onChange: (next: DayEntry) => void;
}) {
  const isIdle = entry.lines.every((l) => l.type === "off" || l.hours <= 0);
  // A split day defaults its second line to "stepUp" (riding up) where
  // that's an allowed type — the common reason a fire-ops shift splits.
  // Admin has no step-up concept, so its default second line is PTO
  // instead (e.g. part worked, part sick the same day).
  const splitDefaultType: DayEntryType = allowedTypes.includes("stepUp")
    ? "stepUp"
    : "pto";

  function setLine(index: number, next: DayLine) {
    const lines = entry.lines.slice();
    lines[index] = next;
    onChange({ ...entry, lines });
  }

  function addLine() {
    onChange({
      ...entry,
      lines: [
        ...entry.lines,
        { type: splitDefaultType, hours: 0, grade: entry.lines[0].grade },
      ],
    });
  }

  function removeLine(index: number) {
    onChange({
      ...entry,
      lines: entry.lines.filter((_, i) => i !== index),
    });
  }

  return (
    <div
      className={`rounded-lg border border-line bg-surface p-3 lg:p-2 ${
        isIdle ? "opacity-60" : ""
      }`}
    >
      <DayHeader entry={entry} />
      <div className="mt-2 flex flex-col gap-2 lg:gap-1.5">
        {entry.lines.map((line, i) => (
          <LineFields
            key={i}
            line={line}
            stepUpGrades={stepUpGrades}
            scheduledHours={entry.scheduledHours}
            allowedTypes={allowedTypes}
            onChange={(next) => setLine(i, next)}
            onRemove={i > 0 ? () => removeLine(i) : undefined}
          />
        ))}
      </div>
      {entry.lines.length < MAX_DAY_LINES && entry.lines[0].type !== "off" && (
        <button
          type="button"
          className="mt-2 text-xs font-medium text-accent"
          onClick={addLine}
        >
          + split this shift
        </button>
      )}
    </div>
  );
}

function CompareToCheck({
  aggregated,
  gross,
}: {
  aggregated: { label: string; hours: number; amount: number }[];
  gross: number;
}) {
  const [open, setOpen] = useState(false);
  const [checkTotal, setCheckTotal] = useState("");
  const [checkByLabel, setCheckByLabel] = useState<Record<string, string>>({});

  const totalDelta =
    checkTotal.trim() === "" ? null : Number(checkTotal) - gross;

  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <button
        type="button"
        className="w-full text-left text-sm font-medium"
        onClick={() => setOpen((o) => !o)}
      >
        Compare to check {open ? "▲" : "▼"}
      </button>
      {open && (
        <div className="mt-3 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm text-ink-muted">
            What the check paid (total)
            <input
              className={FIELD}
              type="number"
              step="0.01"
              inputMode="decimal"
              value={checkTotal}
              onChange={(e) => setCheckTotal(e.target.value)}
            />
          </label>
          {totalDelta !== null && (
            <p
              className={`text-sm ${
                Math.abs(totalDelta) < 0.01 ? "text-good" : "text-warn"
              }`}
            >
              {Math.abs(totalDelta) < 0.01
                ? "Matches, to the cent."
                : `Total is off by $${Math.abs(totalDelta).toFixed(2)} (${
                    totalDelta > 0 ? "check paid more" : "check paid less"
                  }).`}
            </p>
          )}

          <div className="flex flex-col gap-2">
            {aggregated.map((item) => {
              const checkValue = checkByLabel[item.label] ?? "";
              const delta =
                checkValue.trim() === ""
                  ? null
                  : Number(checkValue) - item.amount;
              return (
                <div key={item.label} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between text-sm">
                    <span>{item.label}</span>
                    <span className="text-ink-muted">
                      computed ${item.amount.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      className={`${FIELD} w-28`}
                      type="number"
                      step="0.01"
                      inputMode="decimal"
                      placeholder="check said..."
                      value={checkValue}
                      onChange={(e) =>
                        setCheckByLabel((prev) => ({
                          ...prev,
                          [item.label]: e.target.value,
                        }))
                      }
                    />
                    {delta !== null && Math.abs(delta) >= 0.01 && (
                      <span className="text-xs text-warn">
                        your {item.label.toLowerCase()} is{" "}
                        {delta > 0 ? "over" : "missing"} $
                        {Math.abs(delta).toFixed(2)}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

const HOLIDAY_LABELS = new Set(["Holiday worked", "Holiday observed"]);
const FLSA_LABEL = "FLSA premium";

/** A fast jump grid over every period in the year — an alternative to
 * spamming Prev/Next to reach a period several weeks away. Deliberately
 * lighter than the Year tab's list (no gross/running totals computed per
 * period): this is for getting somewhere fast, not for reviewing pay. */
function PeriodPickerModal({
  year,
  currentPeriodN,
  onSelect,
  onClose,
}: {
  year: PayYear;
  currentPeriodN: number;
  onSelect: (periodNumber: number) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-10 flex items-end justify-center bg-structure/60 sm:items-center"
      onClick={onClose}
    >
      <div
        className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-t-xl border border-line bg-surface p-3 sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Jump to a period</h2>
          <button
            type="button"
            aria-label="Close"
            className="rounded-md px-2 py-1 text-ink-muted"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {year.periods.map((p) => (
            <button
              key={p.n}
              type="button"
              onClick={() => onSelect(p.n)}
              className={`flex flex-col items-center rounded-lg border p-2 text-center ${
                p.n === currentPeriodN
                  ? "border-holiday bg-holiday-soft"
                  : "border-line"
              }`}
            >
              <span className="text-sm font-medium">{p.n}</span>
              <span className="text-[0.625rem] text-ink-muted">
                {p.start.slice(5)}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function PeriodScreen({
  year,
  profile,
  period,
  onNavigate,
}: {
  year: PayYear;
  profile: Profile;
  period: Period;
  onNavigate: (periodNumber: number) => void;
}) {
  const { getPeriodBlocks, setPeriodBlocks, progression } = useAppData();
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const memberGrade = progression?.grade ?? null;
  const isAdmin = profile.track === "admin9080";
  // Both fall back defensively (Setup always sets the field that matters
  // for the active track) rather than asserting non-null against stale or
  // hand-edited storage.
  const shift = profile.shift ?? "A";
  const fridayGroup = profile.fridayGroup ?? "week1";

  // Entries are local editing state, loaded once per period (not re-derived
  // from saved blocks after every keystroke): entriesToBlocks() drops a
  // block once its hours hit 0, which happens for an instant while
  // backspacing a number to retype it (e.g. "24" -> "" -> "16"). Re-reading
  // that lossy round trip back through blocksToEntries() on every edit
  // flipped the day's type to "Off" mid-edit and the hours field vanished
  // under the user's cursor. Saving still happens on every edit (below);
  // just not reading back.
  function loadEntries(): DayEntry[] {
    const saved = getPeriodBlocks(year.id, period.n);
    if (isAdmin) {
      return saved.length > 0
        ? blocksToAdminEntries(period, fridayGroup, saved)
        : defaultAdmin9080DayEntries(period, fridayGroup);
    }
    return saved.length > 0
      ? blocksToEntries(year, shift, period, saved, memberGrade)
      : defaultDayEntries(year, shift, period, memberGrade);
  }

  const [entries, setEntries] = useState<DayEntry[]>(loadEntries);

  useEffect(() => {
    setEntries(loadEntries());
    // Deliberately excludes getPeriodBlocks: it's a live snapshot of
    // storage that changes on every save, and re-syncing from it here is
    // exactly the round trip this fix removes. Re-sync only when the
    // member switches to a genuinely different period/shift/year/grade.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year.id, period.n, profile.track, shift, fridayGroup, memberGrade]);

  function updateEntry(index: number, next: DayEntry) {
    const updated = entries.slice();
    updated[index] = next;
    setEntries(updated);
    setPeriodBlocks(year.id, period.n, entriesToBlocks(updated));
  }

  const blocks = entriesToBlocks(entries);
  const previousBlocks =
    isAdmin && period.n > 1 ? getPeriodBlocks(year.id, period.n - 1) : [];
  const adminResult = isAdmin
    ? computeAdminPeriod(profile, period, blocks, previousBlocks)
    : null;
  const result = adminResult ?? computePeriod(year, profile, blocks);
  const aggregated = aggregateLineItems(result.lineItems);
  // F1 is never a step-up target (it's the base grade); every grade above
  // it is a valid ride-up, and the set varies by year (FY26 has F1..F5,
  // FY27's proposed merger drops it to F1..F4). Unused for admin9080 (no
  // step-up on that track), but harmless to compute either way.
  const stepUpGrades = (Object.keys(year.payPlan) as PayGrade[]).filter(
    (g) => g !== "F1",
  );
  const allowedTypes: DayEntryType[] = isAdmin
    ? ["off", "regular", "pto"]
    : (Object.keys(TYPE_LABELS) as DayEntryType[]);
  const holidayNames = new Map(year.holidays.map((h) => [h.date, h.name]));

  const OT_LABEL = "OT premium";
  const sumWhere = (pick: (label: string) => boolean) =>
    aggregated.filter((a) => pick(a.label)).reduce((s, a) => s + a.amount, 0);
  const regularTotal = sumWhere(
    (l) => l !== FLSA_LABEL && l !== OT_LABEL && !HOLIDAY_LABELS.has(l),
  );
  const flsaTotal = sumWhere((l) => l === FLSA_LABEL || l === OT_LABEL);
  const holidayTotal = sumWhere((l) => HOLIDAY_LABELS.has(l));

  return (
    <div className="flex flex-col gap-3 p-3 pb-40">
      <div className="flex items-center justify-between">
        <button
          type="button"
          disabled={period.n <= 1}
          onClick={() => onNavigate(period.n - 1)}
          className="rounded-md px-3 py-2 text-accent disabled:opacity-30"
        >
          ← Prev
        </button>
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="flex flex-col items-center rounded-md px-2 py-1"
        >
          <div className="text-sm font-medium">Period {period.n}</div>
          <div className="text-xs text-ink-muted underline decoration-dotted">
            {period.start} – {period.end}
          </div>
        </button>
        <button
          type="button"
          disabled={period.n >= year.periods.length}
          onClick={() => onNavigate(period.n + 1)}
          className="rounded-md px-3 py-2 text-accent disabled:opacity-30"
        >
          Next →
        </button>
      </div>

      {pickerOpen && (
        <PeriodPickerModal
          year={year}
          currentPeriodN={period.n}
          onSelect={(n) => {
            onNavigate(n);
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {/* Below lg, one column, full-width rows — a scrolling list. At lg+
          there's room for the sheet's own shape: two rows of seven, Sat
          through Fri, matching the source workbooks this app is checked
          against. */}
      <div className="flex flex-col gap-2 lg:grid lg:grid-cols-7 lg:items-start lg:gap-2">
        {entries.map((entry, i) =>
          entry.isHoliday ? (
            <HolidayRow
              key={entry.date}
              entry={entry}
              holidayName={holidayNames.get(entry.date)}
              onChange={(next) => updateEntry(i, next)}
            />
          ) : (
            <DayRow
              key={entry.date}
              entry={entry}
              stepUpGrades={stepUpGrades}
              allowedTypes={allowedTypes}
              onChange={(next) => updateEntry(i, next)}
            />
          ),
        )}
      </div>

      <div className="rounded-lg border border-line bg-surface p-3">
        <button
          type="button"
          className="w-full text-left text-sm font-medium"
          onClick={() => setBreakdownOpen((o) => !o)}
        >
          Itemized breakdown {breakdownOpen ? "▲" : "▼"}
        </button>
        {breakdownOpen && (
          <div className="mt-3 flex flex-col gap-1">
            {aggregated.map((item) => (
              <div key={item.label} className="flex justify-between text-sm">
                <span className="text-ink-muted">
                  {item.label} ({item.hours}h)
                </span>
                <span className="tabular-nums">${item.amount.toFixed(2)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <CompareToCheck aggregated={aggregated} gross={result.gross} />

      <div className="fixed inset-x-0 bottom-0 border-t border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto max-w-md px-4 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2">
          <div className="flex justify-between text-[0.6875rem] text-ink-muted">
            <span>Total hours {result.totalHours}</span>
            {adminResult ? (
              adminResult.otHours > 0 && (
                <span>
                  {adminResult.otHoursWeekI > 0 &&
                    `Wk1: ${adminResult.otHoursWeekI} OT`}
                  {adminResult.otHoursWeekI > 0 &&
                    adminResult.otHoursWeekII > 0 &&
                    " · "}
                  {adminResult.otHoursWeekII > 0 &&
                    `Wk2: ${adminResult.otHoursWeekII} OT`}
                </span>
              )
            ) : (
              result.otHours > 0 && <span>{result.otHours} over 106</span>
            )}
          </div>
          {adminResult && (
            <div className="mt-1 flex justify-between text-[0.6875rem] text-ink-muted">
              <span>Week 1: {adminResult.weekIHours}h</span>
              <span>Week 2: {adminResult.weekIIHours}h</span>
            </div>
          )}
          <div className="mt-1 grid grid-cols-3 gap-2 text-[0.6875rem]">
            <div>
              <div className="text-ink-muted">Regular</div>
              <div className="tabular-nums">${regularTotal.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-ink-muted">{adminResult ? "OT" : "FLSA"}</div>
              <div className="tabular-nums">${flsaTotal.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-ink-muted">Holiday</div>
              <div className="tabular-nums text-holiday-ink">
                ${holidayTotal.toFixed(2)}
              </div>
            </div>
          </div>
          <div className="mt-1 flex items-center justify-between border-t border-line pt-1">
            <span className="text-sm text-ink-muted">Check total</span>
            <span className="text-2xl font-semibold tabular-nums">
              ${result.gross.toFixed(2)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
