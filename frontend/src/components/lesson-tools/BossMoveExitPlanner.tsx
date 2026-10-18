import { useState } from "react";
import {
  ActionButton,
  AreaField,
  Callout,
  CheckRow,
  DashboardFrame,
  Grid,
  NumField,
  Panel,
  ProgressBar,
  RestoreButton,
  SelectField,
  TabBar,
  TextField,
  Tile,
  downloadFile,
  escapeHtml,
  printReport,
} from "./DashboardKit";
import {
  CHECK_GROUPS,
  EXIT_SECTIONS,
  PROGRESS_AREAS,
  areaPercent,
  ceil,
  exitDefaults,
  fixed,
  nextSteps,
  normaliseExit,
  numOf,
  pathTip,
  premiumDelta,
  runwayLabel,
  summarise,
  summaryLines,
  take,
  usd,
  type ExitPace,
  type ExitPath,
  type ExitPlannerState,
  type ExitSectionId,
  type NumericKey,
} from "./exitPlanner";
import { useToolState } from "./useToolState";

/**
 * The Boss Move — Private Practice Exit Planner (QA sheet row 102), on
 * "Lesson 0: Planning Your Exit Timeline". A native port of Yvette's
 * prototype: the same seven sections, inputs, wording and arithmetic
 * (exitPlanner.ts), saved to the member's account instead of the browser.
 */

export const EXIT_PLANNER_KEY = "boss-move-exit-planner";

const PATH_OPTIONS: readonly { value: ExitPath; label: string }[] = [
  { value: "agency", label: "Leaving an agency or employer" },
  { value: "platform", label: "Transitioning away from a platform" },
  { value: "rebuild", label: "Rebuilding or stabilizing a private practice" },
];

const PACE_OPTIONS: readonly { value: ExitPace; label: string }[] = [
  { value: "gradual", label: "Gradual transition" },
  { value: "full", label: "Full transition once milestones are met" },
  { value: "explore", label: "Still exploring options" },
];

export function BossMoveExitPlanner() {
  const { state, setState, status, ready, savedAt } = useToolState(EXIT_PLANNER_KEY, exitDefaults, normaliseExit);
  const [tab, setTab] = useState<ExitSectionId>("dashboard");
  const section = EXIT_SECTIONS.find((s) => s.id === tab) ?? EXIT_SECTIONS[0];

  const set = <K extends keyof ExitPlannerState>(key: K, value: ExitPlannerState[K]) =>
    setState((prev) => ({ ...prev, [key]: value }));
  const setNum = (key: NumericKey) => (value: number | null) => set(key, Math.max(0, Number(value) || 0));
  const n = (key: NumericKey) => numOf(state, key);

  const sum = summarise(state);
  const p = sum.projectedRevenue;
  const target = sum.target;
  const resT = sum.reserveTarget;
  const resPct = resT ? Math.min(100, (n("reserves") / resT) * 100) : 100;

  const backup = () =>
    downloadFile(
      "Boss_Move_Exit_Planner_Backup.json",
      JSON.stringify({ version: 1, createdAt: new Date().toISOString(), data: state }, null, 2),
      "application/json",
    );

  const restore = (obj: unknown) => {
    const candidate =
      obj && typeof obj === "object" ? ((obj as { data?: unknown }).data ?? obj) : undefined;
    if (!candidate || typeof candidate !== "object" || !("path" in candidate)) {
      window.alert("This does not appear to be a valid Boss Move planner backup.");
      return;
    }
    if (!window.confirm("Restore the backup and replace your current planner entries?")) return;
    setState(normaliseExit(candidate));
  };

  const print = () =>
    printReport(
      "My Boss Move Exit Plan",
      `<small>THE BOSS MOVE • INTERACTIVE WORKBOOK</small><h1>My Private Practice Exit Plan</h1>${summaryLines(state)
        .map((line) => (line === "" ? "<br>" : /^[A-Z ]+$/.test(line) ? `<h2>${escapeHtml(line)}</h2>` : `<div>${escapeHtml(line)}</div>`))
        .join("")}`,
    );

  if (!ready) {
    return (
      <DashboardFrame eyebrow="The Boss Move • Interactive Workbook" title="Your Exit Dashboard" status={status}>
        <p className="text-sm text-orchid-dim">Loading your planner…</p>
      </DashboardFrame>
    );
  }

  return (
    <DashboardFrame
      eyebrow="The Boss Move • Interactive Workbook"
      title={section.title}
      subtitle={section.sub}
      status={status}
      savedAt={savedAt}
      actions={
        <>
          <ActionButton icon="download" onClick={backup}>Save backup</ActionButton>
          <RestoreButton onFile={restore} />
          <ActionButton icon="print" primary onClick={print}>Print / Save PDF</ActionButton>
        </>
      }
      footer="Boss Clinician • The Boss Move. Planning assumptions require verification. Expenses and income are estimates; changes to coverage, contracts, and collections can materially change outcomes."
    >
      <Callout tone="plum">
        Your exit date should follow your finances, benefits arrangements, professional obligations, and actual client demand. This tool does not determine whether quitting is safe or advisable.
      </Callout>

      <TabBar
        label="Exit planner sections"
        tabs={EXIT_SECTIONS.map((s) => ({ id: s.id, label: s.id === "dashboard" ? "⌂ Overview" : s.label }))}
        active={tab}
        onChange={setTab}
      />

      {tab === "dashboard" && (
        <>
          <Grid cols={4}>
            <Tile label="Monthly take-home goal" value={usd(take(state))} hint="Personal target after taxes" />
            <Tile label="Required gross collections / month" value={usd(target)} hint="Planning estimate with deductions" />
            <Tile label="Available savings runway" value={runwayLabel(state, "No cash draw")} hint="At projected cash shortfall" />
            <Tile label="Business readiness milestones" value={`${Math.round(sum.percentage)}%`} hint="Completed checklist items" />
          </Grid>
          <Grid>
            <Panel title="Choose your transition" intro="This changes which questions and checklist tasks are emphasized.">
              <SelectField label="My current situation" value={state.path} onChange={(v) => set("path", v)} options={PATH_OPTIONS} />
              <TextField label="Practice name (optional)" value={state.practiceName} onChange={(v) => set("practiceName", v)} placeholder="My Future Practice" />
              <Callout tone="sage">{pathTip(state.path)}</Callout>
            </Panel>
            <Panel title="Where are you on your journey?" intro="Your dashboard summarizes planning information—not a pass/fail assessment.">
              {PROGRESS_AREAS.map((area) => {
                const pct = areaPercent(state, area.items);
                return (
                  <div key={area.key} className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between gap-3 text-sm text-orchid">
                      <span>{area.label}</span>
                      <b className="font-body tabular-nums text-white">{Math.round(pct)}%</b>
                    </div>
                    <ProgressBar percent={pct} label={area.label} />
                  </div>
                );
              })}
              <Callout tone="sage">
                {sum.done} of {sum.counted} milestones marked complete. This progress indicator is self-reported and cannot certify that you are ready to resign.
              </Callout>
            </Panel>
          </Grid>
          <Grid>
            <Panel title="Your next best moves">
              {nextSteps(state).length ? (
                <ul className="flex flex-col">
                  {nextSteps(state).map((step) => (
                    <li key={step} className="border-b border-white/10 py-2.5 text-sm text-orchid last:border-0">
                      ↗ {step}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-orchid">
                  Your checklist is complete. Confirm your assumptions with the relevant professionals and plan your next milestone.
                </p>
              )}
            </Panel>
            <Panel title="How this fits with Ramp-Up Rate">
              <p className="text-sm leading-relaxed text-orchid">
                This planner uses your <b className="text-white">average collected session amount</b> to assess the feasibility of a transition. Your standalone <b className="text-white">Ramp-Up Rate</b> course teaches you how to choose and communicate your rate.
              </p>
              <p className="text-sm leading-relaxed text-orchid">
                Complete Ramp-Up Rate whenever you need to establish or reconsider your pricing, then bring that number back here.
              </p>
            </Panel>
          </Grid>
        </>
      )}

      {tab === "income" && (
        <Grid>
          <Panel title="1 • Your personal freedom number" intro="Start with the actual money your household needs—not a social-media income goal.">
            <Grid>
              <NumField label="Monthly personal living costs ($)" step={50} value={state.living} onChange={setNum("living")} hint="Housing, food, childcare, debt, transportation, personal needs" />
              <NumField label="Additional monthly personal savings ($)" step={50} value={state.personalSavings} onChange={setNum("personalSavings")} />
              <NumField label="Other reliable household income available ($/month)" step={50} value={state.householdIncome} onChange={setNum("householdIncome")} hint="Count only income reliably available toward these needs" />
              <NumField label="Desired extra monthly flexibility ($)" step={50} value={state.cushion} onChange={setNum("cushion")} />
            </Grid>
            <Callout tone="sage">
              <span className="text-xs">Monthly personal income the practice needs to supply</span>
              <p className="my-1.5 font-body text-2xl font-bold tabular-nums text-white">{usd(take(state))}</p>
              <span className="text-xs">Does not yet include taxes or business expenses; those are handled in the revenue plan.</span>
            </Callout>
          </Panel>
          <Panel title="2 • How work supports you today" intro="Know what you are replacing—and which benefits you actually want to keep.">
            <Grid>
              <NumField label="Current take-home from job / platforms ($ per month)" value={state.existingIncome} onChange={setNum("existingIncome")} />
              <NumField label="Other reliable practice collections ($ per month)" value={state.existingPracticeCollections} onChange={setNum("existingPracticeCollections")} hint="Gross collections from your own practice, not take-home pay" />
              <TextField type="date" label="Target transition date" value={state.exitDate} onChange={(v) => set("exitDate", v)} />
              <SelectField label="My proposed transition approach" value={state.pace} onChange={(v) => set("pace", v)} options={PACE_OPTIONS} />
            </Grid>
            <Callout tone="sage">
              You can keep a phased approach even if you eventually want to leave entirely. Revenue consistency and transition costs matter more than a perfect date.
            </Callout>
          </Panel>
        </Grid>
      )}

      {tab === "benefits" && (
        <Panel
          title="3 • Replace the benefits you actually need"
          intro={
            <>
              Enter estimated <b className="text-white">monthly costs you would personally pay after leaving</b>. Use actual quotes when possible. Employer benefits may have tax treatment and coverage differences; this is a budgeting tool, not an equivalence calculation.
            </>
          }
        >
          <Grid>
            <NumField label="Health insurance premium ($/month)" value={state.health} onChange={setNum("health")} hint="Consider household coverage, potential marketplace assistance, COBRA, or a spouse/partner plan." />
            <NumField label="Dental / vision premium ($/month)" value={state.dental} onChange={setNum("dental")} />
            <NumField label="Disability insurance ($/month)" value={state.disability} onChange={setNum("disability")} />
            <NumField label="Life insurance ($/month)" value={state.life} onChange={setNum("life")} />
            <NumField label="Retirement contribution ($/month)" value={state.retirement} onChange={setNum("retirement")} hint="Choose your own savings target; this is not automatically the employer match amount." />
            <NumField label="Other benefit replacements ($/month)" value={state.otherBenefits} onChange={setNum("otherBenefits")} hint="Licensing, CEUs, professional dues, wellness, etc. Avoid duplicate business expenses." />
            <NumField label="Employer 401(k) match / contribution ($/month)" value={state.employerMatch} onChange={setNum("employerMatch")} hint="Reference only; helps show what you would be leaving behind. Not added to costs automatically." />
            <NumField label="Current employee premium payments ($/month)" value={state.employeePremium} onChange={setNum("employeePremium")} hint="Reference only. A replacement plan may cost more or less." />
          </Grid>
          <Grid cols={4}>
            <Tile label="Monthly benefit replacement budget" value={usd(sum.benefitTotal)} hint="Includes selected premiums and savings goals" />
            <Tile label="Annual benefit replacement budget" value={usd(sum.benefitTotal * 12)} hint="Monthly estimate × 12" />
            <Tile label="Employer retirement contribution at risk" value={usd(n("employerMatch") * 12)} hint="Current annual employer contribution, for comparison" />
            <Tile
              label="Monthly premium difference"
              value={`${premiumDelta(state) >= 0 ? "+" : ""}${usd(premiumDelta(state))}`}
              hint="New health/dental vs. current premiums"
            />
          </Grid>
          <Callout tone="plum">
            Important: Health insurance quotes, policy exclusions, deductibles, coverage start dates, marketplace eligibility, and retirement choices require separate research. Paid leave is modeled through <b className="text-white">weeks worked per year</b> in the revenue section, so vacation revenue is not counted twice.
          </Callout>
          <p className="text-sm text-orchid">
            Research:{" "}
            <a className="font-semibold text-gold underline-offset-2 hover:underline" target="_blank" rel="noopener noreferrer" href="https://www.healthcare.gov/">HealthCare.gov</a>
            {" · "}
            <a className="font-semibold text-gold underline-offset-2 hover:underline" target="_blank" rel="noopener noreferrer" href="https://www.dol.gov/agencies/ebsa/laws-and-regulations/laws/cobra">COBRA guidance</a>
            {" · "}
            <a className="font-semibold text-gold underline-offset-2 hover:underline" target="_blank" rel="noopener noreferrer" href="https://www.irs.gov/retirement-plans">IRS retirement plans</a>
          </p>
        </Panel>
      )}

      {tab === "runway" && (
        <Grid>
          <Panel title="4 • Build your exit runway" intro="Model cash reserves for slower months, delays in claims, and early client-growth uncertainty.">
            <Grid>
              <NumField label="Available cash reserves ($)" value={state.reserves} onChange={setNum("reserves")} />
              <NumField label="Target reserve months" min={1} max={36} value={state.months} onChange={setNum("months")} />
              <NumField label="One-time practice setup / exit costs ($)" value={state.startup} onChange={setNum("startup")} />
              <NumField label="Reliable monthly cash income during transition ($)" value={state.transitionCash} onChange={setNum("transitionCash")} hint="After taxes, available for expenses; exclude uncertain referrals or projected unpaid claims." />
            </Grid>
            <Callout tone="sage">
              <span className="text-xs">Monthly shortfall to be covered by reserves</span>
              <p className="my-1.5 font-body text-2xl font-bold tabular-nums text-white">{usd(sum.monthlyGap)}</p>
              <span className="text-xs">Personal costs + selected benefits + monthly business expenses − reliable monthly cash income.</span>
            </Callout>
          </Panel>
          <Panel title="Your runway at a glance">
            <Grid>
              <Tile label="Reserve target + startup" value={usd(resT)} />
              <Tile label="Remaining target gap" value={usd(Math.max(0, resT - n("reserves")))} />
              <Tile label="Usable reserves after setup" value={usd(sum.usable)} />
              <Tile label="Estimated cash runway" value={sum.monthlyGap > 0 ? `${fixed(sum.usable / sum.monthlyGap)} months` : "No modeled cash draw"} />
            </Grid>
            <div className="flex items-center justify-between gap-3 text-sm">
              <b className="text-white">Progress toward reserve target</b>
              <span className="font-body font-bold tabular-nums text-orchid">{resT ? `${Math.round(resPct)}%` : "Covered"}</span>
            </div>
            <ProgressBar percent={resPct} label="Progress toward reserve target" />
            <p className="text-sm leading-relaxed text-orchid">
              The reserve calculation assumes your monthly cash shortfall stays constant; it does not forecast insurance credentialing timelines, claim denials, or market demand.
            </p>
          </Panel>
        </Grid>
      )}

      {tab === "revenue" && (
        <Grid>
          <Panel
            title="5 • Reverse-engineer your private practice"
            intro={
              <>
                Use the <b className="text-white">average amount you realistically collect per completed session</b>—which may be different from your advertised fee.
              </>
            }
          >
            <Grid>
              <NumField label="Average collected revenue / completed session ($)" value={state.avgFee} onChange={setNum("avgFee")} />
              <NumField label="Planned completed sessions / week" value={state.sessions} onChange={setNum("sessions")} />
              <NumField label="Weeks worked each year" min={1} max={52} value={state.workWeeks} onChange={setNum("workWeeks")} hint="Exclude vacation, holidays, sick days, and breaks." />
              <NumField label="Completion rate (0–100%)" min={1} max={100} value={state.completion} onChange={setNum("completion")} hint="To estimate scheduled appointment slots needed." />
              <NumField label="Monthly operating / admin expenses ($)" value={state.opex} onChange={setNum("opex")} hint="Do not double count personal benefit premiums." />
              <NumField label="Monthly clinical / contractor payroll ($)" value={state.payroll} onChange={setNum("payroll")} hint="Leave at 0 for a solo clinician without staff." />
              <NumField label="Tax planning reserve (% of net business earnings)" max={70} value={state.taxRate} onChange={setNum("taxRate")} hint="Illustrative planning reserve—not a tax calculation. Check with a CPA." />
              <NumField label="Desired extra business profit / month ($)" value={state.profit} onChange={setNum("profit")} hint="Business retained earnings beyond owner pay." />
            </Grid>
          </Panel>
          <Panel title="Can my proposed schedule support the transition?">
            <Grid>
              <Tile label="Target gross collections / month" value={usd(target)} />
              <Tile label="Projected collections / month" value={usd(p)} />
              <Tile label="Required completed sessions / week" value={Number.isFinite(sum.required) ? ceil(sum.required) : "Set a fee"} />
              <Tile
                label="Suggested scheduled slots / week"
                value={Number.isFinite(sum.required) && n("completion") > 0 ? ceil(sum.required / (n("completion") / 100)) : "—"}
              />
            </Grid>
            <Callout tone="sage">
              {p >= target ? (
                <>
                  <b className="text-white">Projected surplus: {usd(p - target)}/month.</b> Your assumptions show enough gross collections to fund these modeled costs, not a guarantee of financial readiness.
                </>
              ) : (
                <>
                  <b className="text-white">Projected revenue gap: {usd(target - p)}/month.</b> Consider reviewing your costs, expected collections, session capacity, and transition timeline.
                </>
              )}
            </Callout>
            <p className="text-xs leading-relaxed text-orchid-dim">
              Calculation includes selected benefits, business expenses, a modeled tax reserve, and your personal after-tax goal. Retirement contributions are included in benefits budgeting. This model deliberately does not treat your gross collections as take-home pay.
            </p>
          </Panel>
        </Grid>
      )}

      {tab === "readiness" && (
        <Panel
          title="6 • Your readiness milestones"
          intro="Based on your original Exit Timeline Planner: financial preparation, legal setup, credentialing/billing, marketing, support, and contingency planning. Checking boxes tracks your own reported progress, not regulatory verification."
        >
          {CHECK_GROUPS.map((group) => (
            <div key={group.title} className="flex flex-col gap-3">
              <h4 className="text-sm font-semibold text-white">{group.title}</h4>
              <Grid>
                {group.items.map(([key, text]) => (
                  <CheckRow
                    key={key}
                    checked={Boolean(state.checks[key])}
                    onChange={(checked) => setState((prev) => ({ ...prev, checks: { ...prev.checks, [key]: checked } }))}
                  >
                    {text}
                  </CheckRow>
                ))}
              </Grid>
            </div>
          ))}
        </Panel>
      )}

      {tab === "plan" && (
        <Grid>
          <Panel title="7 • Your transition action plan">
            <Grid>
              <AreaField label="My most important next milestone" value={state.nextAction} onChange={(v) => set("nextAction", v)} placeholder="e.g., obtain family health insurance quotes and confirm effective dates" />
              <AreaField label="My biggest barrier or unknown" value={state.barrier} onChange={(v) => set("barrier", v)} placeholder="e.g., I do not know my reimbursement timeline" />
              <AreaField label="My referral / client acquisition strategy" value={state.referralPlan} onChange={(v) => set("referralPlan", v)} placeholder="e.g., outreach to 3 referral partners weekly" />
              <AreaField label="My contingency plan if demand is slower than expected" value={state.contingency} onChange={(v) => set("contingency", v)} placeholder="e.g., extend part-time work and revisit expenses" />
              <TextField type="date" label="My first action deadline" value={state.firstDeadline} onChange={(v) => set("firstDeadline", v)} />
              <TextField label="My preferred graduation goal" value={state.milestoneGoal} onChange={(v) => set("milestoneGoal", v)} placeholder="e.g., consistent client flow before giving notice" />
            </Grid>
          </Panel>
          <Panel title="Download your personal plan" intro="Export a readable summary, print to PDF, or save a backup of every input you entered.">
            <div className="flex flex-wrap gap-2">
              <ActionButton
                icon="download"
                primary
                onClick={() => downloadFile("My_Boss_Move_Exit_Plan.txt", summaryLines(state).join("\n"), "text/plain;charset=utf-8")}
              >
                Download Exit Plan (.txt)
              </ActionButton>
              <ActionButton icon="download" onClick={backup}>Download Data (.json)</ActionButton>
            </div>
            <Callout tone="sage">
              <b className="text-white">Privacy & saving:</b> Your entries save to your Boss Clinician account automatically, so they follow you to any device you sign in on. Do not use this planner for confidential client information. Download a backup any time you want your own copy.
            </Callout>
            <p className="text-xs text-orchid-dim">
              This planner is for educational business planning and is not legal, investment, tax, employee benefits, or financial advice.
            </p>
            <div>
              <ActionButton
                tone="warn"
                onClick={() => {
                  if (window.confirm("Delete all saved planner inputs and restore example values?")) setState(exitDefaults());
                }}
              >
                Reset all my planner data
              </ActionButton>
            </div>
          </Panel>
        </Grid>
      )}
    </DashboardFrame>
  );
}
