import { useState, type ReactNode } from "react";
import {
  ActionButton,
  Callout,
  DashboardFrame,
  Grid,
  NumField,
  Panel,
  RestoreButton,
  SelectField,
  TabBar,
  Tile,
  downloadFile,
  escapeHtml,
  printReport,
  reportDocument,
} from "./DashboardKit";
import {
  BOARDROOM_DISCLAIMER,
  BOARDROOM_KEY,
  benefitsFigures,
  boardroomDefaults,
  capacityFigures,
  capacityScenario,
  cashFigures,
  count,
  guardrailNote,
  money,
  money2,
  normaliseBoardroom,
  ownerFigures,
  pct,
  rampModel,
  reportSections,
  scenarioFigures,
  snapshotFigures,
  teamFigures,
  versusGuardrail,
  type BoardroomState,
  type Num,
} from "./boardroom";
import { useToolState } from "./useToolState";

/**
 * Boardroom CEO Dashboard (QA sheet row 95), the first lesson of The Boss
 * Boardroom. Nine tabs from Yvette's blank member-ready mockup — CEO Snapshot,
 * EHR + Capacity, Team + Pay, Hiring, Owner Pay, Cash Strategy, Benefits,
 * Scenario Lab, CEO Report — with every figure computed in boardroom.ts and
 * the member's entries saved to their account.
 */

type Tab = "snapshot" | "capacity" | "team" | "hiring" | "owner" | "cash" | "benefits" | "scenario" | "report";

const TABS: readonly { id: Tab; label: string; title: string; sub: string }[] = [
  { id: "snapshot", label: "CEO Snapshot", title: "CEO Snapshot", sub: "Start with your current monthly financial picture." },
  { id: "capacity", label: "EHR + Capacity", title: "EHR + Clinical Capacity", sub: "Use one reporting period and one clinician group at a time." },
  { id: "team", label: "Team + Pay", title: "Team + Pay", sub: "Test clinician compensation against collections and total employer cost." },
  { id: "hiring", label: "Hiring", title: "Hiring + Ramp-Up", sub: "Model a realistic ramp instead of assuming immediate full utilization." },
  { id: "owner", label: "Owner Pay", title: "Owner Pay", sub: "See what you pay yourself now, what you want, and what the business would need to support." },
  { id: "cash", label: "Cash Strategy", title: "Cash Strategy", sub: "Know how many months your cash covers and what to set aside to reach your reserve." },
  { id: "benefits", label: "Benefits", title: "Compensation + Benefits", sub: "Model monthly and annual employer cost before making the commitment." },
  { id: "scenario", label: "Scenario Lab", title: "CEO Scenario Lab", sub: "Test the impact of a decision before making it." },
  { id: "report", label: "CEO Report", title: "CEO Summary Report", sub: "A decision-prep summary based only on the information entered." },
];

/** The mockup's empty-state hint: a note with a pink left border. */
function Hint({ children }: { children: ReactNode }) {
  return <Callout tone="rose">{children}</Callout>;
}

/** A label / value line, as in the mockup's result lists. */
function Line({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-white/10 py-2.5 text-sm last:border-0">
      <span className="text-orchid">{label}</span>
      <span className="text-right font-body font-bold tabular-nums text-white">{value}</span>
    </div>
  );
}

export function BoardroomCeoDashboard() {
  const { state, setState, status, ready, savedAt } = useToolState(BOARDROOM_KEY, boardroomDefaults, normaliseBoardroom);
  const [tab, setTab] = useState<Tab>("snapshot");
  const current = TABS.find((t) => t.id === tab) ?? TABS[0];

  const set = <K extends keyof BoardroomState>(key: K, value: BoardroomState[K]) =>
    setState((prev) => ({ ...prev, [key]: value }));
  const num = (key: { [K in keyof BoardroomState]: BoardroomState[K] extends Num ? K : never }[keyof BoardroomState]) => ({
    value: state[key] as Num,
    onChange: (value: number | null) => set(key, value as BoardroomState[typeof key]),
  });

  const snap = snapshotFigures(state);
  const cap = capacityFigures(state);
  const capScenario = capacityScenario(state);
  const team = teamFigures(state);
  const ramp = rampModel(state);
  const owner = ownerFigures(state);
  const cash = cashFigures(state);
  const ben = benefitsFigures(state);
  const scenario = scenarioFigures(state);
  const report = reportSections(state);
  const unit = state.method === "hours" ? "hours" : "sessions";

  const reportHtml = () =>
    `<small>THE BOSS BOARDROOM</small><h1>CEO Summary Report</h1><p class="muted">A decision-prep summary based only on the information entered. Prepared ${escapeHtml(
      new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
    )}.</p>${report
      .map((sec) => `<section><h2>${escapeHtml(sec.title)}</h2><ul>${sec.lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul></section>`)
      .join("")}<p class="note">${escapeHtml(BOARDROOM_DISCLAIMER)}</p>`;

  const backup = () =>
    downloadFile(
      "Boardroom_CEO_Dashboard_Backup.json",
      JSON.stringify({ version: 1, createdAt: new Date().toISOString(), data: state }, null, 2),
      "application/json",
    );

  const restore = (obj: unknown) => {
    const candidate = obj && typeof obj === "object" ? ((obj as { data?: unknown }).data ?? obj) : undefined;
    if (!candidate || typeof candidate !== "object" || !("guardrailPct" in candidate)) {
      window.alert("This does not appear to be a valid Boardroom CEO Dashboard backup.");
      return;
    }
    if (!window.confirm("Restore the backup and replace your current dashboard entries?")) return;
    setState(normaliseBoardroom(candidate));
  };

  if (!ready) {
    return (
      <DashboardFrame eyebrow="The Boss Boardroom" title="Boardroom CEO Dashboard" status={status}>
        <p className="text-sm text-orchid-dim">Loading your dashboard…</p>
      </DashboardFrame>
    );
  }

  return (
    <DashboardFrame
      eyebrow="The Boss Boardroom · CEO Dashboard"
      title={current.title}
      subtitle={current.sub}
      status={status}
      savedAt={savedAt}
      actions={
        <>
          <ActionButton icon="download" onClick={backup}>Save backup</ActionButton>
          <RestoreButton onFile={restore} />
        </>
      }
      footer={BOARDROOM_DISCLAIMER}
    >
      <TabBar label="Boardroom dashboard tabs" tabs={TABS} active={tab} onChange={setTab} />

      {tab === "snapshot" && (
        <>
          <Grid cols={3}>
            <Tile label="Monthly Revenue" value={money(snap.revenue)} />
            <Tile label="Operating Profit" value={money(snap.profit)} />
            <Tile label="Operating Margin" value={pct(snap.margin)} />
          </Grid>
          <Grid>
            <Panel title="Business Inputs">
              <NumField label="Monthly revenue" prefix="$" placeholder="Enter revenue" {...num("revenue")} />
              <NumField label="Cost of services / clinician COGS" prefix="$" placeholder="Enter cost of services" {...num("cogs")} />
              <NumField label="Operating expenses" prefix="$" placeholder="Enter operating expenses" {...num("opex")} />
              <NumField label="Cash on hand" prefix="$" placeholder="Enter cash on hand" {...num("cash")} />
            </Panel>
            <Panel title="Minimum Operating Profit Guardrail" intro="Choose your own planning threshold.">
              <NumField label="Minimum operating profit %" suffix="%" max={100} {...num("guardrailPct")} />
              <Line label="Guardrail amount" value={money(snap.guardrail)} />
              {snap.profit === null ? <Hint>{guardrailNote(state)}</Hint> : <Callout tone="sage">{guardrailNote(state)}</Callout>}
            </Panel>
          </Grid>
        </>
      )}

      {tab === "capacity" && (
        <>
          <Grid>
            <Panel title="EHR Report Setup">
              <SelectField label="Data source" value={state.dataSource} onChange={(v) => set("dataSource", v)} options={[{ value: "ehr", label: "EHR Report" }, { value: "manual", label: "Manual estimate" }] as const} />
              <SelectField label="Reporting period" value={state.period} onChange={(v) => set("period", v)} options={[{ value: "weekly", label: "Weekly" }, { value: "monthly", label: "Monthly" }, { value: "quarterly", label: "Quarterly" }] as const} />
              <SelectField label="Capacity level" value={state.level} onChange={(v) => set("level", v)} options={[{ value: "practice", label: "Entire Practice" }, { value: "single", label: "Single Clinician" }, { value: "group", label: "Clinician group" }] as const} />
              <NumField label="Number of clinicians included" placeholder="Enter clinicians" {...num("clinicians")} />
              <SelectField label="Capacity method" value={state.method} onChange={(v) => set("method", v)} options={[{ value: "sessions", label: "Sessions" }, { value: "hours", label: "Hours" }] as const} />
              <NumField label={`Target ${unit} for selected period`} placeholder="Enter target" {...num("capTarget")} />
              <NumField label={`Scheduled ${unit} for selected period`} placeholder="Enter scheduled" {...num("capScheduled")} />
              <NumField label={`Completed ${unit} for selected period`} placeholder="Enter completed" {...num("capCompleted")} />
            </Panel>
            <Panel title="Capacity Results">
              <NumField label="Clinical Capacity Guardrail %" suffix="%" max={100} {...num("capGuardrail")} />
              <div>
                <Line label="Booked / scheduled utilization" value={pct(cap.booked)} />
                <Line label="Compared with guardrail" value={versusGuardrail(cap.booked, cap.guard)} />
                <Line label="Completed utilization" value={pct(cap.completed)} />
                <Line label="Compared with guardrail" value={versusGuardrail(cap.completed, cap.guard)} />
                <Line label="Average completed / clinician" value={count(cap.perClinician)} />
              </div>
              {cap.booked === null && cap.completed === null && <Hint>Enter capacity data to calculate utilization.</Hint>}
            </Panel>
          </Grid>
          <Panel title="Use Existing Capacity Before Hiring">
            <Grid>
              <Tile label="Current completed utilization %" value={pct(capScenario.current)} hint="From your capacity results" />
              <NumField label="Scenario utilization %" suffix="%" max={100} placeholder="Enter %" {...num("scenarioUtil")} />
              <Tile label="Monthly revenue at current utilization" value={money(capScenario.revenue)} hint="From CEO Snapshot" />
              <Tile label="Modeled revenue at scenario utilization" value={money(capScenario.modeled)} emphasis />
            </Grid>
            <p className="text-xs text-orchid-dim">Simple proportional planning estimate only; not a revenue guarantee.</p>
          </Panel>
        </>
      )}

      {tab === "team" && (
        <>
          <Grid>
            <Panel>
              <NumField label="Monthly clinician collections" prefix="$" placeholder="Enter collections" {...num("teamCollections")} />
              <NumField label="Employer payroll taxes" prefix="$" placeholder="Enter payroll taxes" {...num("teamTaxes")} />
              <NumField label="Benefits" prefix="$" placeholder="Enter benefits" {...num("teamBenefits")} />
              <NumField label="Supervision" prefix="$" placeholder="Enter supervision" {...num("teamSupervision")} />
              <NumField label="Other clinician-specific cost" prefix="$" placeholder="Enter other cost" {...num("teamOther")} />
            </Panel>
            <Panel>
              <SelectField
                label="Compensation structure"
                value={state.compStructure}
                onChange={(v) => set("compStructure", v)}
                options={[
                  { value: "hourly", label: "Clinical + Nonclinical Hourly" },
                  { value: "session", label: "Per session" },
                  { value: "split", label: "Percentage split" },
                  { value: "salary", label: "Salary" },
                ] as const}
              />
              {state.compStructure === "hourly" && (
                <>
                  <NumField label="Clinical hourly rate" prefix="$" placeholder="Enter rate" {...num("clinRate")} />
                  <NumField label="Paid clinical hours / month" placeholder="Enter hours" {...num("clinHours")} />
                </>
              )}
              {state.compStructure === "session" && (
                <>
                  <NumField label="Pay per completed session" prefix="$" placeholder="Enter rate" {...num("sessionRate")} />
                  <NumField label="Paid sessions / month" placeholder="Enter sessions" {...num("sessionsPaid")} />
                </>
              )}
              {state.compStructure === "split" && (
                <NumField label="Clinician share of collections %" suffix="%" max={100} placeholder="Enter %" {...num("splitPct")} hint="Applied to monthly clinician collections." />
              )}
              {state.compStructure === "salary" && (
                <NumField label="Monthly salary" prefix="$" placeholder="Enter salary" {...num("salaryMonthly")} />
              )}
              {(state.compStructure === "hourly" || state.compStructure === "session") && (
                <>
                  <NumField label="Nonclinical hourly rate" prefix="$" placeholder="Enter rate" {...num("nonclinRate")} />
                  <NumField label="Paid nonclinical hours / month" placeholder="Enter hours" {...num("nonclinHours")} />
                </>
              )}
            </Panel>
          </Grid>
          <Grid cols={3}>
            <Tile label="Base Wages" value={money(team.wages)} />
            <Tile label="Total Employer Cost" value={money(team.total)} hint="Wages + taxes + benefits + supervision + other" />
            <Tile label="Contribution" value={money(team.contribution)} hint="Collections − total employer cost" emphasis />
          </Grid>
          {team.total === null && <Hint>Enter compensation and cost details to see total employer cost and contribution.</Hint>}
        </>
      )}

      {tab === "hiring" && (
        <>
          <Grid>
            <Panel>
              <NumField label="Target completed sessions / month" placeholder="Enter target" {...num("hireTarget")} />
              <NumField label="Average collected revenue / session" prefix="$" placeholder="Enter average collected" {...num("hireAvgRevenue")} />
              <NumField label="Monthly clinician cost at steady state" prefix="$" placeholder="Enter total cost" {...num("hireCost")} />
              <NumField label="Additional monthly overhead" prefix="$" placeholder="Enter overhead" {...num("hireOverhead")} />
            </Panel>
            <Panel>
              <NumField label="Month 1 utilization %" suffix="%" placeholder="Enter %" {...num("hireM1")} />
              <NumField label="Month 2 utilization %" suffix="%" placeholder="Enter %" {...num("hireM2")} />
              <NumField label="Month 3 utilization %" suffix="%" placeholder="Enter %" {...num("hireM3")} />
              <NumField label="Steady-state utilization %" suffix="%" placeholder="Enter %" {...num("hireSteady")} />
            </Panel>
          </Grid>
          {ramp ? (
            <Panel title="Ramp-up model">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[34rem] text-left text-sm">
                  <thead>
                    <tr className="border-b border-white/15 text-[0.7rem] uppercase tracking-[0.12em] text-gold/90">
                      <th className="py-2 pr-3 font-semibold">Period</th>
                      <th className="py-2 pr-3 text-right font-semibold">Sessions</th>
                      <th className="py-2 pr-3 text-right font-semibold">Revenue</th>
                      <th className="py-2 pr-3 text-right font-semibold">Cost</th>
                      <th className="py-2 pr-3 text-right font-semibold">Contribution</th>
                      <th className="py-2 text-right font-semibold">Cumulative</th>
                    </tr>
                  </thead>
                  <tbody className="font-body tabular-nums">
                    {ramp.rows.map((row) => (
                      <tr key={row.label} className="border-b border-white/10 last:border-0">
                        <td className="py-2.5 pr-3 text-orchid">
                          {row.label} <span className="text-xs text-orchid-dim">({count(row.utilization)}%)</span>
                        </td>
                        <td className="py-2.5 pr-3 text-right font-bold text-white">{count(row.sessions)}</td>
                        <td className="py-2.5 pr-3 text-right font-bold text-white">{money(row.revenue)}</td>
                        <td className="py-2.5 pr-3 text-right font-bold text-white">{money(row.cost)}</td>
                        <td className="py-2.5 pr-3 text-right font-bold text-white">{money(row.contribution)}</td>
                        <td className="py-2.5 text-right font-bold text-white">{row.cumulative === null ? "—" : money(row.cumulative)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Line label="Cumulative breakeven" value={ramp.breakeven} />
            </Panel>
          ) : (
            <Hint>Enter hiring assumptions to see the ramp-up model.</Hint>
          )}
        </>
      )}

      {tab === "owner" && (
        <>
          <Grid>
            <Panel>
              <SelectField
                label="How are you currently paying yourself?"
                value={state.payMethod}
                onChange={(v) => set("payMethod", v)}
                options={[
                  { value: "w2hourly", label: "W-2 Hourly" },
                  { value: "w2salary", label: "W-2 Salary" },
                  { value: "draw", label: "Owner's draw" },
                  { value: "distributions", label: "Distributions" },
                ] as const}
              />
              <NumField label="Current hourly rate" prefix="$" placeholder="Enter rate" {...num("ownerRate")} />
              <NumField label="Average hours / week" placeholder="Enter hours" {...num("ownerHours")} />
              <NumField label="Desired monthly owner compensation" prefix="$" placeholder="Enter desired compensation" {...num("ownerDesired")} />
            </Panel>
            <Panel title="Pay Increase Calculator">
              <div>
                <Line label="Current monthly compensation" value={money(owner.current)} />
                <Line label="Desired monthly compensation" value={money(owner.desired)} />
                <Line label="Additional monthly pay needed" value={money(owner.additional)} />
                <Line label="Hourly rate needed" value={money2(owner.rateNeeded)} />
                <Line label="Hourly increase needed" value={money2(owner.rateIncrease)} />
                <Line label="Projected operating profit" value={money(owner.projectedProfit)} />
                <Line label="Projected operating margin" value={pct(owner.projectedMargin)} />
              </div>
              {owner.projectedProfit === null && <Hint>Enter owner pay and business data to test the desired compensation level.</Hint>}
            </Panel>
          </Grid>
          <Panel title="Owner Clinical Role">
            <SelectField
              label="Do you currently maintain a clinical caseload?"
              value={state.ownerClinical}
              onChange={(v) => set("ownerClinical", v)}
              options={[{ value: "no", label: "No" }, { value: "yes", label: "Yes" }] as const}
            />
            <Callout tone="plum">
              Payroll, draws, and distributions may be treated differently depending on entity and tax structure. Confirm the appropriate method with a CPA or tax professional.
            </Callout>
          </Panel>
        </>
      )}

      {tab === "cash" && (
        <>
          <Grid>
            <Panel title="Cash Inputs">
              <Line label="Cash on hand (from CEO Snapshot)" value={money(state.cash)} />
              <NumField
                label="Monthly operating expenses"
                prefix="$"
                placeholder={cash.usingSnapshot && cash.expenses !== null ? `Using ${money(cash.expenses)} from CEO Snapshot` : "Enter monthly expenses"}
                hint="Leave blank to use cost of services + operating expenses from CEO Snapshot."
                {...num("cashExpenses")}
              />
              <NumField label="Target reserve months" placeholder="Enter months" {...num("cashReserveMonths")} />
              <NumField label="Monthly debt payments" prefix="$" placeholder="Optional" {...num("cashDebt")} />
            </Panel>
            <Panel title="Cash Results">
              <div>
                <Line label="Monthly cash outflow" value={money(cash.outflow)} />
                <Line label="Months of runway" value={cash.runway === null ? "—" : `${count(cash.runway)} months`} />
                <Line label="Reserve target" value={money(cash.target)} />
                <Line label="Gap to reserve" value={money(cash.gap)} />
                <Line label="Suggested monthly set-aside" value={money(cash.setAside)} />
              </div>
              {cash.runway === null && cash.target === null ? (
                <Hint>Enter cash on hand and monthly expenses to see your runway and reserve target.</Hint>
              ) : (
                <p className="text-xs text-orchid-dim">Set-aside spreads the reserve gap over 12 months. Planning estimate only.</p>
              )}
            </Panel>
          </Grid>
        </>
      )}

      {tab === "benefits" && (
        <Grid>
          <Panel>
            <NumField label="Eligible clinicians" placeholder="Enter clinicians" {...num("benClinicians")} />
            <NumField label="Health contribution / clinician / month" prefix="$" placeholder="Optional" {...num("benHealth")} />
            <NumField label="Retirement contribution / clinician / month" prefix="$" placeholder="Optional" {...num("benRetirement")} />
            <NumField label="PTO cost / clinician / month" prefix="$" placeholder="Optional" {...num("benPto")} />
            <NumField label="CEU allowance / clinician / month" prefix="$" placeholder="Optional" {...num("benCeu")} />
            <NumField label="Supervision cost / clinician / month" prefix="$" placeholder="Optional" {...num("benSupervision")} />
            <NumField label="Other benefits / clinician / month" prefix="$" placeholder="Optional" {...num("benOther")} />
          </Panel>
          <Panel title="Results">
            <div>
              <Line label="Per clinician / month" value={money(ben.perClinician)} />
              <Line label="Total monthly cost" value={money(ben.monthly)} />
              <Line label="Total annual cost" value={money(ben.annual)} />
              <Line label="Projected operating margin" value={pct(ben.projectedMargin)} />
            </div>
            {ben.projectedMargin === null && <Hint>Enter benefits and business data to test this scenario.</Hint>}
          </Panel>
        </Grid>
      )}

      {tab === "scenario" && (
        <>
          <Panel>
            <Grid>
              <NumField label="Additional monthly revenue" prefix="$" placeholder="Optional" {...num("scRevenue")} />
              <NumField label="Additional monthly operating cost" prefix="$" placeholder="Optional" {...num("scCost")} />
              <NumField label="Extra debt payment" prefix="$" placeholder="Optional" {...num("scDebt")} />
              <NumField label="Additional benefits cost" prefix="$" placeholder="Optional" {...num("scBenefits")} />
            </Grid>
          </Panel>
          <Grid>
            <Panel title="Before">
              <div>
                <Line label="Revenue" value={money(scenario.before.revenue)} />
                <Line label="Operating Profit" value={money(scenario.before.profit)} />
                <Line label="Operating Margin" value={pct(scenario.before.margin)} />
              </div>
            </Panel>
            <Panel title="After">
              <div>
                <Line label="Revenue" value={money(scenario.after?.revenue ?? null)} />
                <Line label="Operating Profit" value={money(scenario.after?.profit ?? null)} />
                <Line label="Operating Margin" value={pct(scenario.after?.margin ?? null)} />
              </div>
            </Panel>
          </Grid>
          {!scenario.after && <Hint>Enter your base financials and scenario assumptions to compare before and after.</Hint>}
        </>
      )}

      {tab === "report" && (
        <>
          {report.length === 0 ? (
            <Hint>Start entering information throughout the dashboard to build your CEO report.</Hint>
          ) : (
            <div className="flex flex-col gap-4">
              {report.map((sec) => (
                <Panel key={sec.title} title={sec.title}>
                  <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed text-orchid marker:text-gold">
                    {sec.lines.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </Panel>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <ActionButton icon="print" primary disabled={report.length === 0} onClick={() => printReport("CEO Summary Report", reportHtml())}>
              Print / Save PDF
            </ActionButton>
            <ActionButton
              icon="download"
              disabled={report.length === 0}
              onClick={() => downloadFile("Boardroom_CEO_Report.html", reportDocument("CEO Summary Report", reportHtml()), "text/html")}
            >
              Download report (.html)
            </ActionButton>
          </div>
        </>
      )}
    </DashboardFrame>
  );
}
