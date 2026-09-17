import { useMemo, useState } from "react";
import { useAppData } from "../app/AppData";
import {
  computeUpcomingStep,
  gradeLabel,
  matchStep,
} from "../app/stepProgression";
import { todayIso } from "../app/years";
import type { PayYear } from "../data/schema";
import type {
  EmployeeTrack,
  FridayGroup,
  PayGrade,
  Profile,
  ShiftLetter,
} from "../engine/types";

const NONE = "__none__";

function incentiveTotal(
  year: PayYear,
  selections: {
    tcfp: string;
    education: string;
    emt: string;
    bilingual: boolean;
    assignment: string;
  },
): number {
  let total = 0;
  if (selections.tcfp !== NONE)
    total += year.incentives.tcfp[selections.tcfp] ?? 0;
  if (selections.education !== NONE)
    total += year.incentives.education[selections.education] ?? 0;
  if (selections.emt !== NONE)
    total += year.incentives.emt[selections.emt] ?? 0;
  if (selections.bilingual) total += year.incentives.bilingual;
  if (selections.assignment !== NONE)
    total += year.incentives.assignment[selections.assignment] ?? 0;
  return total;
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex flex-col gap-1 text-sm text-ink-muted">
      {label}
      <select
        className="rounded-md border border-line bg-surface px-3 py-2 text-ink"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function SetupScreen({
  year,
  onDone,
}: {
  year: PayYear;
  onDone: () => void;
}) {
  const {
    profile,
    setProfile,
    progression,
    setProgression,
    certifications,
    setCertifications,
  } = useAppData();
  const firstSegment = profile?.rateSegments[0];

  // A saved cert key that no longer exists in this year's incentive tables
  // (a stale key from a year whose options changed, e.g. FY26's
  // "EMT-P(FY25)" vs FY27's "EMT-P(FY26)") falls back to "None" rather than
  // silently selecting nothing the dropdown can actually show as picked.
  const savedOrNone = (
    saved: string | null | undefined,
    table: Record<string, number>,
  ) => (saved && saved in table ? saved : NONE);
  const grades = Object.keys(year.payPlan) as PayGrade[];

  const [track, setTrack] = useState<EmployeeTrack>(profile?.track ?? "shift");
  const [shift, setShift] = useState<ShiftLetter>(profile?.shift ?? "A");
  const [fridayGroup, setFridayGroup] = useState<FridayGroup>(
    profile?.fridayGroup ?? "week1",
  );
  const [grade, setGrade] = useState<PayGrade>(progression?.grade ?? grades[0]);

  // The pay plan table is the single source of truth for what a step pays
  // (docs/PAY_PLAN.md) — members know their step off-hand, not their HR
  // hourly rate to four decimal places, so Setup asks for the step and
  // looks the rate up rather than asking someone to type or remember it.
  // On an existing profile, seed the picker from whichever step its saved
  // rate is closest to; a rate the current table doesn't cover at all
  // (old data, a since-changed table) falls back to Step 0.
  const [stepIndex, setStepIndex] = useState(() =>
    firstSegment ? (matchStep(year, grade, firstSegment.hourlyRate) ?? 0) : 0,
  );

  const [tcfp, setTcfp] = useState(() =>
    savedOrNone(certifications?.tcfp, year.incentives.tcfp),
  );
  const [education, setEducation] = useState(() =>
    savedOrNone(certifications?.education, year.incentives.education),
  );
  const [emt, setEmt] = useState(() =>
    savedOrNone(certifications?.emt, year.incentives.emt),
  );
  const [bilingual, setBilingual] = useState(
    certifications?.bilingual ?? false,
  );
  const [assignment, setAssignment] = useState(() =>
    savedOrNone(certifications?.assignment, year.incentives.assignment),
  );

  const [longevity, setLongevity] = useState(
    profile?.longevityAnnual ? String(profile.longevityAnnual) : "",
  );

  const [anniversaryDate, setAnniversaryDate] = useState(
    progression?.anniversaryDate ?? "",
  );
  const [receivingStep, setReceivingStep] = useState(
    progression?.receivingStep ?? true,
  );

  const incentives = incentiveTotal(year, {
    tcfp,
    education,
    emt,
    bilingual,
    assignment,
  });

  const stepTable = year.payPlan[grade] ?? [];
  const currentRate = stepTable[stepIndex] ?? 0;
  const canSave = stepTable.length > 0;

  function handleGradeChange(nextGrade: PayGrade) {
    setGrade(nextGrade);
    // A step index that's meaningless for the new grade's (possibly
    // shorter) table would otherwise silently clamp to its last entry —
    // reset to Step 0 instead of guessing which step "carries over".
    const nextTable = year.payPlan[nextGrade] ?? [];
    if (stepIndex >= nextTable.length) setStepIndex(0);
  }

  const upcomingStep = useMemo(
    () =>
      anniversaryDate
        ? computeUpcomingStep(
            year,
            grade,
            stepIndex,
            anniversaryDate,
            todayIso(),
          )
        : null,
    [year, grade, stepIndex, anniversaryDate],
  );

  function handleSave() {
    if (!canSave) return;
    const newProfile: Profile = {
      track,
      shift: track === "shift" ? shift : null,
      fridayGroup: track === "admin9080" ? fridayGroup : null,
      rateSegments: [
        {
          effectiveFrom: year.effectiveFrom,
          hourlyRate: currentRate,
          incentiveTotal: incentives,
        },
        ...(upcomingStep && receivingStep
          ? [
              {
                effectiveFrom: upcomingStep.nextDate,
                hourlyRate: upcomingStep.nextRate,
                incentiveTotal: incentives,
              },
            ]
          : []),
      ],
      longevityAnnual: Number.isFinite(Number(longevity))
        ? Math.max(0, Number(longevity))
        : 0,
    };
    setProfile(newProfile);
    setProgression({
      grade,
      anniversaryDate: anniversaryDate || null,
      receivingStep,
    });
    setCertifications({
      tcfp: tcfp === NONE ? null : tcfp,
      education: education === NONE ? null : education,
      emt: emt === NONE ? null : emt,
      bilingual,
      assignment: assignment === NONE ? null : assignment,
    });
    onDone();
  }

  return (
    <div className="flex flex-col gap-5 p-4 text-ink">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Setup</h1>
          <p className="mt-1 text-sm text-ink-muted">
            One-time setup. Come back here whenever your step changes.
          </p>
        </div>
        {/* Only a real "back" when there's an existing profile to go back
            to — on first-run (profile === null) App.tsx keeps Setup open
            regardless of onDone, so a cancel button here would visibly do
            nothing and just be confusing. */}
        {profile && (
          <button
            type="button"
            onClick={onDone}
            className="shrink-0 rounded-md px-3 py-2 text-sm text-ink-muted"
          >
            ✕ Cancel
          </button>
        )}
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-line p-3">
        <h2 className="text-sm font-medium text-ink-muted">Employee type</h2>
        <div className="flex gap-2">
          {(
            [
              { value: "shift", label: "Shift" },
              { value: "admin9080", label: "Admin (9/80)" },
            ] as { value: EmployeeTrack; label: string }[]
          ).map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setTrack(opt.value)}
              className={`flex-1 rounded-md border px-3 py-2 text-sm ${
                track === opt.value
                  ? "border-accent bg-accent-soft font-semibold text-accent"
                  : "border-line"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-ink-muted">
          Admin (9/80) is for Captains/BCs assigned to admin, working a 9/80
          schedule on a Friday-noon FLSA workweek — not for civilian staff.
        </p>
      </div>

      {track === "shift" ? (
        <Select
          label="Shift"
          value={shift}
          onChange={(v) => setShift(v as ShiftLetter)}
          options={[
            { value: "A", label: "A-Shift" },
            { value: "B", label: "B-Shift" },
            { value: "C", label: "C-Shift" },
          ]}
        />
      ) : (
        <Select
          label="Friday group"
          value={fridayGroup}
          onChange={(v) => setFridayGroup(v as FridayGroup)}
          options={[
            { value: "week1", label: "Week 1 — off payday Friday" },
            { value: "week2", label: "Week 2 — off last-day Friday" },
          ]}
        />
      )}

      <Select
        label="Rank / grade"
        value={grade}
        onChange={(v) => handleGradeChange(v as PayGrade)}
        options={grades.map((g) => ({
          value: g,
          label: gradeLabel(year.id, g),
        }))}
      />

      <Select
        label="Step"
        value={String(stepIndex)}
        onChange={(v) => setStepIndex(Number(v))}
        options={stepTable.map((rate, i) => ({
          value: String(i),
          label: `Step ${i} — $${rate.toFixed(4)}/hr`,
        }))}
      />

      <label className="flex flex-col gap-1 text-sm text-ink-muted">
        Last longevity payoff (LP)
        <input
          className="rounded-md border border-line bg-surface px-3 py-2 text-ink"
          type="number"
          step="0.01"
          inputMode="decimal"
          value={longevity}
          onChange={(e) => setLongevity(e.target.value)}
          placeholder="284.00"
        />
        <span className="text-xs text-ink-muted">
          From your October longevity check. Paid separately, but FLSA folds it
          into the overtime rate, so it slightly raises OT periods.
        </span>
      </label>

      <div className="flex flex-col gap-3 rounded-lg border border-line p-3">
        <h2 className="text-sm font-medium text-ink-muted">Certifications</h2>
        <Select
          label="TCFP"
          value={tcfp}
          onChange={setTcfp}
          options={[
            { value: NONE, label: "None" },
            ...Object.keys(year.incentives.tcfp).map((k) => ({
              value: k,
              label: k,
            })),
          ]}
        />
        <Select
          label="Education"
          value={education}
          onChange={setEducation}
          options={[
            { value: NONE, label: "None" },
            ...Object.keys(year.incentives.education).map((k) => ({
              value: k,
              label: k,
            })),
          ]}
        />
        <Select
          label="EMT"
          value={emt}
          onChange={setEmt}
          options={[
            { value: NONE, label: "None" },
            ...Object.keys(year.incentives.emt).map((k) => ({
              value: k,
              label: k,
            })),
          ]}
        />
        <Select
          label="Assignment"
          value={assignment}
          onChange={setAssignment}
          options={[
            { value: NONE, label: "None" },
            ...Object.keys(year.incentives.assignment).map((k) => ({
              value: k,
              label: k,
            })),
          ]}
        />
        <label className="flex items-center gap-2 text-sm text-ink-muted">
          <input
            type="checkbox"
            checked={bilingual}
            onChange={(e) => setBilingual(e.target.checked)}
          />
          Bilingual
        </label>
        <p className="text-sm text-ink-muted">
          Incentive total:{" "}
          <span className="text-ink">${incentives.toFixed(4)}/hr</span>
        </p>
        <p className="text-sm text-ink-muted">
          Base + incentives:{" "}
          <span className="text-ink">
            ${(currentRate + incentives).toFixed(4)}/hr
          </span>
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-line p-3">
        <h2 className="text-sm font-medium text-ink-muted">Step progression</h2>
        <label className="flex flex-col gap-1 text-sm text-ink-muted">
          Hire date (or your most recent promotion date, if later)
          <input
            className="rounded-md border border-line bg-surface px-3 py-2 text-ink"
            type="date"
            value={anniversaryDate}
            onChange={(e) => setAnniversaryDate(e.target.value)}
          />
        </label>

        {!upcomingStep && anniversaryDate && (
          <p className="text-sm text-ink-muted">
            You're already at the top step of this grade — no further step to
            project.
          </p>
        )}

        {!anniversaryDate && (
          <p className="text-sm text-ink-muted">
            Add the date above to project your next step automatically.
          </p>
        )}

        {upcomingStep && (
          <>
            <p className="text-sm text-ink-muted">
              Next step: Step {upcomingStep.nextStepIndex} — $
              {upcomingStep.nextRate.toFixed(4)}/hr, landing{" "}
              {upcomingStep.nextDate}.
            </p>
            <label className="flex items-center gap-2 text-sm text-ink-muted">
              <input
                type="checkbox"
                checked={receivingStep}
                onChange={(e) => setReceivingStep(e.target.checked)}
              />
              I'm on track to receive this step
            </label>
          </>
        )}
      </div>

      <button
        type="button"
        disabled={!canSave}
        onClick={handleSave}
        className="rounded-md bg-accent px-4 py-3 font-medium text-accent-ink disabled:opacity-40"
      >
        Save
      </button>

      <p className="text-xs text-ink-muted">
        This is an unofficial estimation tool for personal comparison. It is not
        a payroll record and carries no authority in a pay dispute.
      </p>
    </div>
  );
}
