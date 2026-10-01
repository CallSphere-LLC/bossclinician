import { useState } from "react";
import { parseAmount, ptoSetAside, usd } from "./formulas";
import { Figure, NumberField, ToolCard } from "./ToolShell";

/**
 * Section 2 of the PTO Planning Tool (Practice Elevation, Kajabi post
 * 2199631527) as a live calculator. The Google Doc worksheet stays linked in
 * the lesson for the calendar and client-communication sections.
 */
export function PtoSetAsideCalculator() {
  const [monthlySalary, setMonthlySalary] = useState("6000");
  const [ptoWeeks, setPtoWeeks] = useState("4");

  const result = ptoSetAside(parseAmount(monthlySalary), parseAmount(ptoWeeks));

  return (
    <ToolCard
      title="Income Set-Aside Calculator"
      intro={<p>Set your PTO weeks first, then fund them. Your weekly pay × your PTO weeks is the reserve; spread over 12 months, that is your monthly set-aside.</p>}
      footnote="Move the monthly set-aside into a dedicated savings account labeled PTO Fund, and only withdraw from it during your actual time off."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <NumberField
          label="My monthly owner's salary"
          hint="From your Salary Planning Worksheet"
          prefix="$"
          value={monthlySalary}
          onChange={setMonthlySalary}
        />
        <NumberField
          label="My PTO weeks per year"
          hint="Most sustainable practices plan 4 to 6"
          suffix="weeks"
          value={ptoWeeks}
          onChange={setPtoWeeks}
        />
      </div>

      <div aria-live="polite" aria-atomic="true" className="grid gap-4 rounded-xl border border-white/10 bg-white/[0.03] p-5 sm:grid-cols-3">
        <Figure label="Weekly pay" value={usd(result?.weeklyPay, 2)} />
        <Figure label="Reserve needed for the year" value={usd(result?.reserve, 2)} />
        <Figure label="My monthly PTO set-aside" value={usd(result?.monthly, 2)} emphasis />
      </div>
    </ToolCard>
  );
}
