import { useState } from "react";
import { parseAmount, rampUpRate, usd } from "./formulas";
import { NumberField, ToolCard } from "./ToolShell";

/**
 * "Ramp-Up Rate Formula" calculator — native rebuild of the Kajabi lesson
 * widget (post 2186600443). Same four inputs and defaults as the original; the
 * formula is the workbook's: (annual goal + annual expenses) ÷ (weeks × sessions).
 */
export function RampUpRateCalculator() {
  const [annualSalary, setAnnualSalary] = useState("50000");
  const [sessionsPerWeek, setSessionsPerWeek] = useState("10");
  const [weeksPerYear, setWeeksPerYear] = useState("50");
  const [annualExpenses, setAnnualExpenses] = useState("10000");

  const result = rampUpRate({
    annualSalary: parseAmount(annualSalary),
    sessionsPerWeek: parseAmount(sessionsPerWeek),
    weeksPerYear: parseAmount(weeksPerYear),
    annualExpenses: parseAmount(annualExpenses),
  });
  const rate = result?.rate ?? null;

  return (
    <ToolCard
      title="Ramp-Up Rate Formula"
      intro={<p>Rate per session = (annual income goal + annual expenses) ÷ billable hours per year, where billable hours = weeks worked × sessions per week.</p>}
      footnote="*This tool provides an estimate and should be ONE factor in considering your rate. If you offer 30 or 45 minute sessions, convert them to hours."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <NumberField label="Desired Annual Salary" prefix="$" value={annualSalary} onChange={setAnnualSalary} />
        <NumberField label="Sessions Per Week" value={sessionsPerWeek} onChange={setSessionsPerWeek} />
        <NumberField
          label="Weeks Worked Per Year"
          hint="e.g. 50 if you want 2 weeks vacation"
          value={weeksPerYear}
          onChange={setWeeksPerYear}
        />
        <NumberField label="Estimated Annual Expenses" prefix="$" value={annualExpenses} onChange={setAnnualExpenses} />
      </div>

      <div aria-live="polite" aria-atomic="true" className="rounded-xl border border-white/10 bg-white/[0.03] p-5 text-center">
        <p className="text-sm font-semibold text-orchid">Suggested Rate Per Session</p>
        <p className="mt-2 font-body text-3xl font-bold tabular-nums text-white sm:text-4xl">
          {usd(rate, rate !== null && !Number.isInteger(rate) ? 2 : 0)}
        </p>
        {result && (
          <p className="mt-2 text-xs text-orchid-dim tabular-nums">
            Based on {result.billableHours.toLocaleString("en-US")} billable hours per year
          </p>
        )}
      </div>
    </ToolCard>
  );
}
