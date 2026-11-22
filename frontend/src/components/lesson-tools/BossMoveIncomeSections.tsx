import { useId, useState, type ReactNode } from "react";
import { AlertCircle, Check, ChevronDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/cn";
import { Callout, Grid, NumField, Panel, ProgressBar, Tile } from "./DashboardKit";
import type { ExitPlannerState, NumericKey } from "./exitPlanner";
import {
  CASH_RESERVE_EXPLANATION,
  NO_CONTRIBUTION,
  RESERVE_MONTH_OPTIONS,
  SNAPSHOT_DISCLAIMER,
  SNAPSHOT_PROMPT,
  cents,
  cleanAmount,
  count,
  dollars,
  gapLabel,
  monthYear,
  ptoWeeks,
  snapshotRows,
  workWeeksFromPto,
  type FreedomAmountKey,
  type FreedomFigures,
  type FreedomPlanState,
  type GoalStatus,
  type PlanMode,
  type SavingsResult,
} from "./incomePlanner";

/**
 * The row-238 sections of The Boss Move Dashboard: My Freedom Number, My Ideal
 * Work Schedule, My Revenue Roadmap, My Cash Reserve Plan and My Exit
 * Readiness Snapshot. Drawn with the same DashboardKit pieces as the rest of
 * the planner; the arithmetic is incomePlanner.ts.
 */

export interface IncomeSectionProps {
  state: ExitPlannerState;
  fig: FreedomFigures;
  setFreedom: <K extends keyof FreedomPlanState>(key: K, value: FreedomPlanState[K]) => void;
  setShared: (key: NumericKey) => (value: number | null) => void;
}

const amountSetter =
  (setFreedom: IncomeSectionProps["setFreedom"], key: FreedomAmountKey) => (value: number | null) =>
    setFreedom(key, cleanAmount(value));

/** Working weeks can never exceed the 52 a year holds, so weeks off stays consistent. */
const setWeeks = (setShared: IncomeSectionProps["setShared"]) => (value: number | null) =>
  setShared("workWeeks")(value === null ? null : Math.min(52, value));

/* ----------------------------------------------------------- small parts */

/** Progressive disclosure for the less common inputs. */
export function Disclosure({ title, hint, children, defaultOpen }: { title: string; hint?: string; children: ReactNode; defaultOpen?: boolean }) {
  // Opened state is decided once; after that the member's own toggling rules.
  const [initiallyOpen] = useState(Boolean(defaultOpen));
  return (
    <details className="group rounded-xl border border-white/10 bg-white/[0.02]" open={initiallyOpen}>
      <summary
        className={cn(
          "flex min-h-[2.75rem] cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm font-semibold text-white",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold [&::-webkit-details-marker]:hidden",
        )}
      >
        <span className="min-w-0">
          {title}
          {hint && <span className="mt-0.5 block text-xs font-normal text-orchid-dim">{hint}</span>}
        </span>
        <ChevronDown aria-hidden className="size-4 shrink-0 text-gold transition-transform duration-300 group-open:rotate-180" />
      </summary>
      <div className="flex flex-col gap-4 px-4 pb-4">{children}</div>
    </details>
  );
}

function Segmented<V extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: V;
  options: readonly { value: V; label: string; hint: string }[];
  onChange: (value: V) => void;
}) {
  const name = useId();
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="mb-2 text-[0.8rem] font-semibold text-white/90">{label}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <label
              key={option.value}
              className={cn(
                "flex min-h-[2.75rem] cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 text-sm transition-colors duration-300",
                "focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-gold",
                selected ? "border-gold/70 bg-gold/[0.12] text-white" : "border-white/12 bg-white/[0.03] text-orchid hover:border-gold/40",
              )}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={selected}
                onChange={() => onChange(option.value)}
                className="mt-0.5 size-4 shrink-0 accent-[#C9A46A]"
              />
              <span>
                <span className="block font-semibold">{option.label}</span>
                <span className="mt-0.5 block text-xs text-orchid-dim">{option.hint}</span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

const STATUS_STYLE: Record<GoalStatus["key"], string> = {
  reached: "border-[#547376]/60 bg-[#547376]/[0.18] text-white",
  progress: "border-gold/50 bg-gold/[0.12] text-white",
  review: "border-plum/50 bg-plum/[0.16] text-white",
};

export function StatusLabel({ status }: { status: GoalStatus }) {
  const Icon = status.key === "reached" ? Check : status.key === "progress" ? TrendingUp : AlertCircle;
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[0.7rem] font-bold", STATUS_STYLE[status.key])}>
      <Icon aria-hidden className="size-3.5" />
      {status.label}
    </span>
  );
}

const PRETAX_NOTE = "Pretax planning estimates. Practice revenue is money collected by the practice; it is not your owner income and not your after-tax take-home pay.";

/* ------------------------------------------------------ My Freedom Number */

export function FreedomSection({ state, fig, setFreedom, setShared }: IncomeSectionProps) {
  const f = state.freedom;
  const { income } = fig;
  const set = (key: FreedomAmountKey) => amountSetter(setFreedom, key);
  return (
    <Grid>
      <Panel title="Your annual income goal" intro="Start with the pretax income you want to pay yourself each year, then add what the practice must also cover.">
        <NumField label="Desired annual pretax owner income" prefix="$" step={1000} value={f.ownerIncome} onChange={set("ownerIncome")} placeholder="e.g. 100000" hint="What you want to earn before personal income taxes. Not take-home pay." />
        <NumField label="Estimated annual operating expenses" prefix="$" step={500} value={f.annualOpex} onChange={set("annualOpex")} placeholder="e.g. 30000" hint="Rent, EHR, insurance, marketing, fees, supplies." />
        <Disclosure
          title="Benefits and reserve contributions"
          hint="Only amounts not already counted in your expenses above"
          defaultOpen={Boolean(f.annualBenefits || f.annualReserve)}
        >
          <NumField label="Annual health insurance and other benefit replacement costs" prefix="$" step={500} value={f.annualBenefits} onChange={set("annualBenefits")} hint="Enter only what is not already in your operating expenses, so nothing is counted twice." />
          <NumField label="Planned annual contributions to business reserves" prefix="$" step={500} value={f.annualReserve} onChange={set("annualReserve")} hint="Leave blank if your reserve savings are already in your expenses." />
        </Disclosure>
        <Grid>
          <NumField label="Working weeks per year" min={0} max={52} value={state.workWeeks} onChange={setWeeks(setShared)} hint={`${count(ptoWeeks(state.workWeeks))} weeks off for vacation, holidays and sick time`} />
          <NumField label="Desired completed and paid sessions per week" value={state.sessions} onChange={setShared("sessions")} hint="Sessions that actually happen and are paid, not bookings." />
          <NumField label="Expected completed/paid appointment percentage" suffix="%" min={0} max={100} value={state.completion} onChange={setShared("completion")} hint="Of booked appointments, the share that are attended and paid." />
          <NumField label="Current average collections per paid session" prefix="$" value={state.avgFee} onChange={setShared("avgFee")} hint="What you actually collect on average, which may differ from your listed fee." />
        </Grid>
      </Panel>
      <Panel title="What your goal requires" intro={PRETAX_NOTE}>
        <Grid>
          <Tile emphasis label="Required annual practice revenue" value={dollars(income.requiredRevenue)} hint={income.requiredRevenue === null ? "Enter your desired owner income" : "Owner income + expenses + benefits + reserves"} />
          <Tile emphasis label="Required average collections per paid session" value={cents(income.requiredRate)} hint={income.requiredRate === null ? "Add income, weeks and sessions" : "Revenue ÷ annual paid sessions"} />
          <Tile label="Paid sessions per year" value={count(income.annualPaidSessions)} hint={`${count(income.weeklyPaidSessions)} per week × ${count(fig.weeks)} weeks`} />
          <Tile
            label="Weekly appointments to schedule"
            value={income.weeklyAppointments === null ? "—" : Math.ceil(income.weeklyAppointments - 1e-9).toLocaleString("en-US")}
            hint={income.weeklyAppointments === null ? "Add your completed/paid percentage" : `${count(income.weeklyAppointments)} after cancellations and unpaid sessions`}
          />
        </Grid>
        <Callout tone={income.difference !== null && income.difference < 0 ? "gold" : "sage"}>
          <span className="text-xs">Current projected revenue vs. your target</span>
          <p className="my-1.5 font-body text-2xl font-bold tabular-nums text-white">{gapLabel(income.difference)}</p>
          <span className="text-xs">
            {income.projectedRevenue === null
              ? "Add your current average collections per paid session to compare."
              : `${dollars(income.projectedRevenue)} a year at ${cents(fig.currentRate)} per paid session.`}
          </span>
        </Callout>
        <p className="text-xs leading-relaxed text-orchid-dim">
          Example: $100,000 owner income + $30,000 operating expenses = $130,000 practice revenue. At 20 paid sessions a week for 46 weeks (920 sessions), that is an average of $141.30 per paid session. The example leaves out benefits, reserve contributions and personal taxes, which would change the result. It is an illustration, not a guarantee of collections or readiness to leave a job.
        </p>
      </Panel>
    </Grid>
  );
}

/* ------------------------------------------------- My Ideal Work Schedule */

const MODE_OPTIONS: readonly { value: PlanMode; label: string; hint: string }[] = [
  { value: "income", label: "Start with my income goal", hint: "Estimate the rate, paid sessions and appointments it takes." },
  { value: "schedule", label: "Start with my preferred schedule", hint: "Estimate the average collections per paid session it needs." },
];

export function ScheduleSection({ state, fig, setFreedom, setShared }: IncomeSectionProps) {
  const f = state.freedom;
  const { income, schedule } = fig;
  const set = (key: FreedomAmountKey) => amountSetter(setFreedom, key);
  return (
    <>
      <Panel>
        <Segmented label="How would you like to plan?" value={f.mode} options={MODE_OPTIONS} onChange={(v) => setFreedom("mode", v)} />
      </Panel>
      <Grid>
        <Panel
          title={f.mode === "schedule" ? "Your preferred schedule" : "Your schedule inputs"}
          intro="Booked appointments and completed, paid sessions are counted separately: not every booking is attended and paid."
        >
          <Grid>
            {f.mode === "schedule" && (
              <>
                <NumField label="Days worked weekly" min={0} max={7} value={f.daysPerWeek} onChange={set("daysPerWeek")} placeholder="e.g. 4" />
                <NumField label="Appointments scheduled per day" value={f.sessionsPerDay} onChange={set("sessionsPerDay")} placeholder="e.g. 6" />
              </>
            )}
            {f.mode === "income" && (
              <NumField label="Desired completed and paid sessions per week" value={state.sessions} onChange={setShared("sessions")} />
            )}
            <NumField label="Working weeks per year" min={0} max={52} value={state.workWeeks} onChange={setWeeks(setShared)} />
            <NumField
              label="Or: planned PTO / vacation weeks"
              min={0}
              max={52}
              value={ptoWeeks(state.workWeeks)}
              onChange={(v) => setShared("workWeeks")(workWeeksFromPto(v))}
              hint="Working weeks and weeks off always add up to 52."
            />
            <NumField label="Expected completion / payment rate" suffix="%" min={0} max={100} value={state.completion} onChange={setShared("completion")} />
            <NumField label="Average collections per paid session" prefix="$" value={state.avgFee} onChange={setShared("avgFee")} />
          </Grid>
        </Panel>
        {f.mode === "schedule" ? (
          <Panel title="What this schedule produces" intro={PRETAX_NOTE}>
            <Grid>
              <Tile label="Booked appointments per week" value={count(schedule.weeklyScheduled)} hint="Days × appointments per day" />
              <Tile label="Projected paid sessions per week" value={count(schedule.weeklyPaidSessions)} hint="After the completion / payment rate" />
              <Tile label="Projected paid sessions per year" value={count(schedule.annualPaidSessions)} hint={`× ${count(fig.weeks)} working weeks`} />
              <Tile label="Annual practice gross collections" value={dollars(schedule.annualCollections)} hint="Paid sessions × average collections" />
              <Tile label="Difference from your annual target" value={gapLabel(schedule.difference)} hint={`Target ${dollars(income.requiredRevenue)} from My Freedom Number`} />
              <Tile emphasis label="Collections per paid session needed for this schedule" value={cents(schedule.requiredRate)} hint={`Current average ${cents(fig.currentRate)}`} />
            </Grid>
          </Panel>
        ) : (
          <Panel title="What your income goal asks of your week" intro={PRETAX_NOTE}>
            <Grid>
              <Tile emphasis label="Required average collections per paid session" value={cents(income.requiredRate)} />
              <Tile label="Paid sessions per week" value={count(income.weeklyPaidSessions)} hint={`${count(income.annualPaidSessions)} per year`} />
              <Tile label="Appointments to schedule per week" value={count(income.weeklyAppointments)} hint={`${count(income.annualAppointments)} per year`} />
              <Tile label="Difference from your annual target" value={gapLabel(income.difference)} hint={`At your current ${cents(fig.currentRate)} average`} />
            </Grid>
          </Panel>
        )}
      </Grid>
    </>
  );
}

/* -------------------------------------------------- My Revenue Roadmap */

export function RoadmapSection({ state, fig, children }: IncomeSectionProps & { children?: ReactNode }) {
  const { income, model } = fig;
  const weeks = fig.weeks;
  const per = (v: number | null, d: number) => (v === null || d <= 0 ? null : v / d);
  const pct = model.projectedRevenue !== null && income.requiredRevenue ? (model.projectedRevenue / income.requiredRevenue) * 100 : 0;
  return (
    <>
      <Panel
        title="From annual goal to monthly and weekly targets"
        intro={`Using ${state.freedom.mode === "schedule" ? "your preferred schedule" : "your income goal"} as the proposed practice model. ${PRETAX_NOTE}`}
      >
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[30rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-xs text-orchid-dim">
                <th className="px-1 py-2 font-semibold">Practice revenue</th>
                <th className="px-1 py-2 text-right font-semibold">Per year</th>
                <th className="px-1 py-2 text-right font-semibold">Per month</th>
                <th className="px-1 py-2 text-right font-semibold">Per working week</th>
              </tr>
            </thead>
            <tbody className="text-orchid">
              {(
                [
                  ["Required", income.requiredRevenue],
                  ["Projected", model.projectedRevenue],
                  ["Gap (−) or surplus (+)", model.difference],
                ] as const
              ).map(([label, v]) => (
                <tr key={label} className="border-b border-white/5 last:border-0">
                  <td className="px-1 py-2.5">{label}</td>
                  {[v, per(v, 12), per(v, weeks)].map((x, i) => (
                    <td key={i} className="px-1 py-2.5 text-right font-body font-bold tabular-nums text-white">
                      {x === null ? "—" : `${label.startsWith("Gap") && x > 0 ? "+" : ""}${dollars(x)}`}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between gap-3 text-sm">
          <b className="text-white">Projected revenue toward target</b>
          <span className="font-body font-bold tabular-nums text-orchid">{income.requiredRevenue ? `${Math.round(pct)}%` : "—"}</span>
        </div>
        <ProgressBar percent={pct} label="Projected revenue toward target" />
        <Grid cols={3}>
          <Tile label="Required per paid session" value={cents(model.requiredRate)} />
          <Tile label="Current average per paid session" value={cents(fig.currentRate)} />
          <Tile label="Paid sessions per week in this model" value={count(model.weeklyPaid)} hint={`Book about ${count(model.weeklyBooked)} appointments`} />
        </Grid>
      </Panel>
      {children}
    </>
  );
}

/* ---------------------------------------------------- My Cash Reserve Plan */

function SavingsSummary({ result, label }: { result: SavingsResult; label: string }) {
  return (
    <>
      <Grid>
        <Tile emphasis label={`${label} target`} value={dollars(result.target)} />
        <Tile label="Saved so far" value={dollars(result.saved)} />
        <Tile label="Remaining to save" value={dollars(result.remaining)} />
        <Tile
          label="Time to target"
          value={
            result.target === null
              ? "—"
              : result.monthsToTarget === 0
                ? "Target reached"
                : result.monthsToTarget === null
                  ? "—"
                  : `${result.monthsToTarget} months`
          }
          hint={
            result.target === null
              ? undefined
              : result.monthsToTarget === null
                ? NO_CONTRIBUTION
                : result.monthsToTarget > 0
                  ? `About ${monthYear(result.targetDate)} at your monthly contribution`
                  : undefined
          }
        />
      </Grid>
      <div className="flex items-center justify-between gap-3 text-sm">
        <b className="text-white">Percentage achieved</b>
        <span className="font-body font-bold tabular-nums text-orchid">{result.percent === null ? "—" : `${Math.round(result.percent)}%`}</span>
      </div>
      <ProgressBar percent={result.percent ?? 0} label={`${label} percentage achieved`} />
    </>
  );
}

export function ReserveSection({ state, fig, setFreedom, children }: IncomeSectionProps & { children?: ReactNode }) {
  const f = state.freedom;
  const set = (key: FreedomAmountKey) => amountSetter(setFreedom, key);
  return (
    <>
      <Callout tone="sage">{CASH_RESERVE_EXPLANATION}</Callout>
      <Grid>
        <Panel title="Business reserve" intro="For the practice: essential business bills during a slow or interrupted stretch.">
          <NumField label="Essential monthly business operating expenses" prefix="$" value={f.reserveExpenses} onChange={set("reserveExpenses")} placeholder="e.g. 2500" hint="Only the bills that must be paid to keep the practice open." />
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-[0.8rem] font-semibold text-white/90">Reserve target</legend>
            <div className="flex flex-wrap gap-2">
              {RESERVE_MONTH_OPTIONS.map((m) => (
                <label
                  key={m}
                  className={cn(
                    "inline-flex min-h-[2.5rem] cursor-pointer items-center gap-2 rounded-full border px-4 text-[0.8rem] font-semibold transition-colors duration-300",
                    "focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-gold",
                    f.reserveMonths === m ? "border-gold/70 bg-gold/[0.16] text-white" : "border-white/15 bg-white/[0.03] text-orchid hover:border-gold/40",
                  )}
                >
                  <input type="radio" className="sr-only" name="reserve-months" checked={f.reserveMonths === m} onChange={() => setFreedom("reserveMonths", m)} />
                  {m} months
                </label>
              ))}
            </div>
          </fieldset>
          <Grid>
            <NumField label="Current reserve balance" prefix="$" value={f.reserveSaved} onChange={set("reserveSaved")} />
            <NumField label="Planned monthly savings contribution" prefix="$" value={f.reserveMonthly} onChange={set("reserveMonthly")} />
          </Grid>
          <SavingsSummary result={fig.reserve} label="Business reserve" />
          <p className="text-xs leading-relaxed text-orchid-dim">
            The 3–6 month business reserve is a planning guideline, not a rule or proof that you can resign.
          </p>
        </Panel>
        <Panel
          title="Personal transition savings"
          intro="For your household: cash reserved for living expenses and for replacing employee benefits while you move into independent practice. Kept separate from the business reserve, with its own totals."
        >
          <Grid>
            <NumField label="Monthly household living expenses" prefix="$" value={f.personalLiving} onChange={set("personalLiving")} />
            <NumField label="Monthly employee-benefit replacement costs" prefix="$" value={f.personalBenefits} onChange={set("personalBenefits")} hint="Health insurance, retirement and other benefits you will pay yourself." />
            <NumField label="Months to cover" value={f.personalMonths} onChange={set("personalMonths")} placeholder="e.g. 6" />
            <NumField label="Saved so far" prefix="$" value={f.personalSaved} onChange={set("personalSaved")} />
            <NumField label="Planned monthly savings contribution" prefix="$" value={f.personalMonthly} onChange={set("personalMonthly")} />
          </Grid>
          <SavingsSummary result={fig.personal} label="Personal transition savings" />
        </Panel>
      </Grid>
      {children}
    </>
  );
}

/* ----------------------------------------------- My Exit Readiness Snapshot */

export function SnapshotSection({ state, fig }: Pick<IncomeSectionProps, "state" | "fig">) {
  const rows = snapshotRows(state, fig);
  return (
    <>
      <Panel title="Your plan at a glance" intro={SNAPSHOT_DISCLAIMER}>
        <ul className="flex flex-col">
          {rows.map((row) => (
            <li key={row.label} className="flex flex-col gap-2 border-b border-white/10 py-3.5 last:border-0 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white">{row.label}</p>
                <p className="mt-1 font-body text-sm font-bold tabular-nums text-orchid">{row.value}</p>
                {row.note && <p className="mt-1 text-xs leading-snug text-orchid-dim">{row.note}</p>}
              </div>
              {row.status && <StatusLabel status={row.status} />}
            </li>
          ))}
        </ul>
      </Panel>
      <Callout tone="plum">{SNAPSHOT_PROMPT}</Callout>
    </>
  );
}
