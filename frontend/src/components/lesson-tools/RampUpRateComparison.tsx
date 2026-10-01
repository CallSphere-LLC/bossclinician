import { useState } from "react";
import { parseAmount, rateComparison, usd } from "./formulas";
import { Figure, NumberField, ToolCard } from "./ToolShell";

/**
 * "Ramp-Up Rate Comparison" — native rebuild of the Kajabi lesson widget
 * (post 2186600444). Sessions per week plus three candidate rates; weekly,
 * monthly (×4) and annual (×12 months) income for each, as the original showed.
 */
const TIERS = [
  { key: "good", rateLabel: "Good Rate", incomeLabel: "Good", initial: "100" },
  { key: "higher", rateLabel: "Higher Rate", incomeLabel: "High", initial: "125" },
  { key: "highest", rateLabel: "Highest Rate", incomeLabel: "Highest", initial: "150" },
] as const;

export function RampUpRateComparison() {
  const [sessions, setSessions] = useState("10");
  const [rates, setRates] = useState<Record<string, string>>(
    Object.fromEntries(TIERS.map((tier) => [tier.key, tier.initial])),
  );

  const sessionCount = parseAmount(sessions);

  return (
    <ToolCard
      title="Ramp-Up Rate Comparison"
      intro={<p>Compare rates side by side to see how adjusting your session rate changes your weekly, monthly and annual income.</p>}
      footnote="Monthly income = weekly income × 4; annual income = monthly income × 12."
    >
      <div className="sm:max-w-xs">
        <NumberField label="Number of Sessions Per Week" value={sessions} onChange={setSessions} />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {TIERS.map((tier) => {
          const income = rateComparison(sessionCount, parseAmount(rates[tier.key] ?? ""));
          return (
            <div key={tier.key} className="flex flex-col gap-4 rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <NumberField
                label={tier.rateLabel}
                prefix="$"
                value={rates[tier.key] ?? ""}
                onChange={(value) => setRates((current) => ({ ...current, [tier.key]: value }))}
              />
              <div aria-live="polite" aria-atomic="true" className="flex flex-col gap-3">
                <Figure label={`${tier.incomeLabel} Weekly Income`} value={usd(income?.weekly)} />
                <Figure label={`${tier.incomeLabel} Monthly Income`} value={usd(income?.monthly)} />
                <Figure label={`${tier.incomeLabel} Annual Income`} value={usd(income?.annual)} />
              </div>
            </div>
          );
        })}
      </div>
    </ToolCard>
  );
}
