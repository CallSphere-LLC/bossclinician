import { useState } from "react";
import { Link, useParams } from "react-router";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { usePlayerSource } from "@/components/player/playerSource";
import {
  ActionButton,
  AreaField,
  Callout,
  CheckRow,
  DashboardFrame,
  Grid,
  Panel,
  Pill,
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
  LIVING_PLAN_KEY,
  PLAN_GROUPS,
  REVIEW_TYPES,
  SIZE_WARNING_BYTES,
  addReview,
  backupDocument,
  fieldMax,
  keepHistory,
  livingPlanDefaults,
  normaliseLivingPlan,
  planBytes,
  planYear,
  restoreFromBackup,
  reviewedCount,
  rollYear,
  setReviewed,
  setValue,
  type AnnualPlan,
  type LivingPlanState,
  type PlanArchive,
  type PlanField,
  type ReviewType,
} from "./livingPlan";
import { DASHBOARD_LESSON } from "./snapshotRouting";
import { useVersionedToolState } from "./useVersionedToolState";

/**
 * "Meet Your Business Live Plan" (QA sheet row 159), directly below the
 * Practice Elevation dashboard in the orientation module: the owner's
 * standalone "My Living Business Plan" — Dashboard A, annual planning only —
 * ported natively onto the member's account.
 *
 * Her five pages (Overview, Edit annual plan, Strategic reviews, Yearly
 * archives, Export & backup), the Executive Summary plus ten sections with a
 * review checkmark each, dated quarterly / annual / major-change reviews, the
 * end-of-year rollover, her JSON backup and restore, and Print / Save as PDF of
 * the whole plan. Autosaves through the revision-checked tool state; reviews
 * and archives are append-only (livingPlan.ts keepHistory).
 */

type Page = "overview" | "editor" | "reviews" | "archive" | "exports";
const PAGES: readonly { id: Page; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "editor", label: "Edit annual plan" },
  { id: "reviews", label: "Strategic reviews" },
  { id: "archive", label: "Yearly archives" },
  { id: "exports", label: "Export & backup" },
];

const LOCKED = ["readonly", "conflict", "offline", "loading"];
/** A single step (rollover, restore) can add a whole plan; refuse one that would pass the server's 256 KB limit. */
const SAVE_LIMIT_BYTES = 250 * 1024;
const tooLarge = (state: LivingPlanState) => planBytes(state) > SAVE_LIMIT_BYTES;
const TOO_LARGE = "This would exceed what one account can save. Download a backup and shorten some long entries first.";
const today = () => new Date().toISOString().slice(0, 10);
const money = (v: string | undefined) =>
  v && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }) : "—";

/* ---------------------------------------------------------------- report */

function fieldText(field: PlanField, value: string | undefined): string {
  if (!value || !value.trim()) return "—";
  return field.type === "number" && field.label.includes("($)") ? money(value) : value;
}

function planHtml(plan: AnnualPlan, heading: string): string {
  return `<small>BOSS CLINICIAN LOUNGE · THE PRACTICE ELEVATION</small><h1>${escapeHtml(heading)}</h1><p class="muted">Plan year ${escapeHtml(
    plan.values.planYear,
  )} · ${reviewedCount(plan)} of ${PLAN_GROUPS.length} sections reviewed</p>${PLAN_GROUPS.map(
    (g) =>
      `<section><h2>${escapeHtml(g.title)}${plan.reviewed[g.id] ? " ✓" : ""}</h2><p class="muted">${escapeHtml(g.desc)}</p><table><tbody>${g.fields
        .map((field) => `<tr><th style="width:38%">${escapeHtml(field.label)}</th><td style="white-space:pre-wrap">${escapeHtml(fieldText(field, plan.values[field.key]))}</td></tr>`)
        .join("")}</tbody></table></section>`,
  ).join(
    "",
  )}<p class="note">A typed name is an acknowledgment only, not a verified digital signature. Financial values are user supplied and not independently verified; this is not a lender-ready certified statement.</p>`;
}

/* ----------------------------------------------------------------- pages */

function Field({ field, plan, disabled, onChange }: { field: PlanField; plan: AnnualPlan; disabled: boolean; onChange: (key: string, value: string) => void }) {
  const value = plan.values[field.key] ?? "";
  const set = (v: string) => !disabled && onChange(field.key, v.slice(0, fieldMax(field)));
  if (typeof field.type === "object") {
    return <SelectField label={field.label} value={value} onChange={set} placeholder="Select" options={field.type.select.map((o) => ({ value: o, label: o }))} />;
  }
  if (field.type === "textarea") {
    return (
      <div className="sm:col-span-2">
        <AreaField label={field.label} value={value} onChange={set} rows={4} />
      </div>
    );
  }
  if (field.type === "number") {
    // Kept as text, as in her plan; the save cleans it to a number or blank.
    return <TextField label={field.label} value={value} onChange={(v) => set(v.replace(/[^0-9.]/g, ""))} placeholder={field.label.includes("($)") ? "0" : undefined} />;
  }
  return <TextField label={field.label} value={value} onChange={set} type={field.type === "date" ? "date" : "text"} />;
}

function Editor({
  state,
  locked,
  onChange,
  groupId,
  setGroupId,
}: {
  state: LivingPlanState;
  locked: boolean;
  onChange: (next: LivingPlanState) => void;
  groupId: string;
  setGroupId: (id: string) => void;
}) {
  const index = Math.max(0, PLAN_GROUPS.findIndex((g) => g.id === groupId));
  const group = PLAN_GROUPS[index];
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="font-display text-xl text-white">My Annual Business Plan</h3>
        <p className="mt-1 text-sm text-orchid">Complete and verify each section. All entries can be revised throughout the year.</p>
      </div>
      <TabBar tabs={PLAN_GROUPS.map((g) => ({ id: g.id, label: `${state.annual.reviewed[g.id] ? "✓ " : ""}${g.title}` }))} active={group.id} onChange={setGroupId} label="Business plan sections" />
      <Panel title={group.title} intro={group.desc}>
        <Grid cols={2}>
          {group.fields.map((field) => (
            <Field key={field.key} field={field} plan={state.annual} disabled={locked} onChange={(key, value) => onChange(setValue(state, key, value))} />
          ))}
        </Grid>
        <Callout tone="plum">Review for accuracy before relying on this section externally. This planner does not replace accounting records or professional advice.</Callout>
        <CheckRow checked={!!state.annual.reviewed[group.id]} onChange={(checked) => !locked && onChange(setReviewed(state, group.id, checked))}>
          I have reviewed this section for the current plan year.
        </CheckRow>
      </Panel>
      <div className="flex flex-wrap justify-between gap-2">
        <ActionButton disabled={index === 0} onClick={() => setGroupId(PLAN_GROUPS[index - 1].id)}>
          Previous section
        </ActionButton>
        <ActionButton primary disabled={index === PLAN_GROUPS.length - 1} onClick={() => setGroupId(PLAN_GROUPS[index + 1].id)}>
          Next section
        </ActionButton>
      </div>
    </div>
  );
}

function Reviews({ state, locked, onChange }: { state: LivingPlanState; locked: boolean; onChange: (next: LivingPlanState) => void }) {
  const [date, setDate] = useState(today);
  const [type, setType] = useState<ReviewType>(REVIEW_TYPES[0]);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const save = () => {
    const next = addReview(state, { date, type, notes }, new Date().toISOString());
    if (!next) {
      setError("Enter a date and review notes.");
      return;
    }
    setError("");
    setNotes("");
    onChange(next);
  };
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="font-display text-xl text-white">Strategic Reviews</h3>
        <p className="mt-1 text-sm text-orchid">Record quarterly, annual, and major-change reviews without restarting your annual plan.</p>
      </div>
      <Panel>
        <Grid cols={2}>
          <TextField label="Review date" type="date" value={date} onChange={setDate} />
          <SelectField<ReviewType> label="Review type" value={type} onChange={setType} options={REVIEW_TYPES.map((t) => ({ value: t, label: t }))} />
        </Grid>
        <AreaField label="What changed? What needs to happen next?" value={notes} onChange={(v) => setNotes(v.slice(0, 4000))} rows={4} />
        {error && (
          <p role="alert" className="text-sm font-semibold text-rose-400">
            {error}
          </p>
        )}
        <div>
          <ActionButton primary onClick={save} disabled={locked}>
            Save strategic review
          </ActionButton>
        </div>
      </Panel>
      <Panel title="Review history">
        {state.reviews.length ? (
          <ul className="flex flex-col gap-3">
            {[...state.reviews].reverse().map((r) => (
              <li key={`${r.savedAt}|${r.notes.slice(0, 20)}`} className="border-b border-white/10 pb-3 last:border-0">
                <p className="text-sm">
                  <strong className="font-semibold text-white">{r.type}</strong> <span className="font-body font-bold tabular-nums text-orchid-dim">· {r.date}</span>
                </p>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-orchid">{r.notes}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-orchid-dim">No reviews saved yet.</p>
        )}
      </Panel>
    </div>
  );
}

function Archives({ state, locked, onChange }: { state: LivingPlanState; locked: boolean; onChange: (next: LivingPlanState) => void }) {
  const year = planYear(state.annual);
  const [error, setError] = useState("");
  const roll = () => {
    const next = rollYear(state, new Date().toISOString());
    if (tooLarge(next)) {
      setError(TOO_LARGE);
      return;
    }
    if (!window.confirm(`Archive the ${year} business plan and start ${year + 1}?`)) return;
    setError("");
    onChange(next);
  };
  const exportArchive = (a: PlanArchive) => downloadFile(`annual-business-plan-${a.year}.json`, JSON.stringify(a, null, 2), "application/json");
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="font-display text-xl text-white">Annual Plan Versions</h3>
        <p className="mt-1 text-sm text-orchid">Save a historical copy of the completed year and carry forward your business foundation.</p>
      </div>
      <Panel title="End-of-year rollover" intro="When you finish your annual review, archive this version. The new year retains editable strategy fields but resets review checkmarks and CEO acknowledgment.">
        <div>
          <ActionButton primary onClick={roll} disabled={locked}>
            Archive current year and start the next
          </ActionButton>
        </div>
        {error && (
          <p role="alert" className="text-sm font-semibold text-rose-400">
            {error}
          </p>
        )}
      </Panel>
      <Panel title="Prior years" intro="Archived years are kept permanently and cannot be edited.">
        {state.archives.length ? (
          <ul className="flex flex-col gap-3">
            {state.archives.map((a) => (
              <li key={`${a.year}|${a.archivedAt}`} className="flex flex-wrap items-center gap-3 border-b border-white/10 pb-3 last:border-0">
                <span className="font-body text-base font-bold tabular-nums text-white">{a.year}</span>
                <span className="text-sm text-orchid-dim">archived {a.archivedAt.slice(0, 10)}</span>
                <span className="flex flex-wrap gap-2">
                  <ActionButton icon="print" onClick={() => printReport(`My ${a.year} Business Plan`, planHtml(a.plan, `My ${a.year} Annual Business Plan (archived)`))}>
                    Print / PDF
                  </ActionButton>
                  <ActionButton icon="download" onClick={() => exportArchive(a)}>
                    Download archive
                  </ActionButton>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-orchid-dim">No annual archives yet.</p>
        )}
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------------------ tool */

export function LivingBusinessPlan() {
  const tool = useVersionedToolState(LIVING_PLAN_KEY, livingPlanDefaults, normaliseLivingPlan);
  const { state, status, savedAt, ready } = tool;
  const locked = LOCKED.includes(status);
  const [page, setPage] = useState<Page>("overview");
  const [notice, setNotice] = useState("");
  const [groupId, setGroupId] = useState(PLAN_GROUPS[0].id);
  const params = useParams();
  const source = usePlayerSource();
  // Every write keeps what was already archived or reviewed.
  const update = (next: LivingPlanState) => tool.setState(keepHistory(state, next));
  const reviewed = reviewedCount(state.annual);
  const bytes = planBytes(state);
  const exportBackup = () => downloadFile("boss-clinician-annual-plan-backup.json", JSON.stringify(backupDocument(state), null, 2), "application/json");
  const printPlan = () => printReport("My Living Business Plan", planHtml(state.annual, `My ${planYear(state.annual)} Annual Business Plan`));
  const restore = (file: unknown) => {
    const next = restoreFromBackup(state, file);
    if (!next) {
      setNotice("Cannot restore backup: Incorrect backup file.");
      return;
    }
    if (tooLarge(next)) {
      setNotice(TOO_LARGE);
      return;
    }
    if (!window.confirm("Replace your current annual plan with this backup? Your archived years and strategic reviews are kept and the backup's are added.")) return;
    update(next);
    setNotice("Backup restored.");
    setPage("overview");
  };

  return (
    <DashboardFrame
      eyebrow="Boss Clinician Lounge · The Practice Elevation"
      title="My Living Business Plan"
      subtitle="Your annual vision, financial strategy, and CEO-level business foundation."
      status={status}
      savedAt={savedAt}
      actions={
        <ActionButton icon="download" onClick={exportBackup}>
          Download backup
        </ActionButton>
      }
      footer={
        <>
          Your entries save privately to your member account and sync across devices. Financial values are user supplied and not independently verified; this is not a lender-ready certified statement. A typed name is only an acknowledgment, not a verified digital signature.
        </>
      }
    >
      {status === "conflict" && (
        <div role="alert" className="flex flex-wrap gap-3">
          <ActionButton icon="download" onClick={() => downloadFile("living-business-plan-local-copy.json", JSON.stringify(backupDocument(state), null, 2), "application/json")}>
            Download my local copy
          </ActionButton>
          <ActionButton
            onClick={() => {
              if (window.confirm("Load the latest saved version? Download your local copy first if you need to keep these unsaved edits.")) void tool.reload();
            }}
          >
            Load latest saved version
          </ActionButton>
        </div>
      )}
      {status === "offline" && <ActionButton onClick={() => void tool.reload()}>Retry loading my plan</ActionButton>}
      {bytes > SIZE_WARNING_BYTES && (
        <Callout tone="gold">Your plan is close to the most one account can save. Download a backup, then shorten some long entries so new changes keep saving.</Callout>
      )}

      {!ready ? (
        <p className="text-sm text-orchid-dim">Loading your business plan…</p>
      ) : (
        <>
          <TabBar tabs={PAGES} active={page} onChange={setPage} label="Living Business Plan pages" />

          {page === "overview" && (
            <div className="flex flex-col gap-4">
              <div>
                <Pill>Annual business plan</Pill>
                <h3 className="mt-3 font-display text-xl text-white">Your Annual Business Strategy</h3>
                <p className="mt-1 text-sm text-orchid">Your 12-month strategy is a separate workspace from your 30-Day Growth Dashboard.</p>
              </div>
              <Grid cols={3}>
                <Tile label="Plan year" value={state.annual.values.planYear || "—"} />
                <Tile label="Annual revenue target" value={money(state.annual.values.annualTarget)} emphasis />
                <Tile label="Sections reviewed" value={`${reviewed} of ${PLAN_GROUPS.length}`} />
              </Grid>
              <Panel
                title="Complete your plan over time"
                intro="The Annual Business Plan includes the Executive Summary plus ten planning sections from your original workbook. Review it once a year and update it when you make meaningful structural changes."
              >
                <ProgressBar percent={(reviewed / PLAN_GROUPS.length) * 100} label="Sections reviewed" />
                <p className="text-xs text-orchid-dim">
                  <span className="font-body font-bold tabular-nums">{reviewed}</span> of {PLAN_GROUPS.length} sections reviewed
                </p>
                <div>
                  <ActionButton primary onClick={() => setPage("editor")}>
                    Continue my annual business plan
                  </ActionButton>
                </div>
              </Panel>
              <Panel
                title="Connected to your separate 30-Day Growth Plan"
                intro="Use your annual business plan for strategy and yearly goals. Use your Practice Elevation Dashboard for the Practice Reset Snapshot results, monthly implementation, and progress tracking."
              >
                <div>
                  <Link
                    to={source.lessonPath(params.productSlug ?? "", DASHBOARD_LESSON.slug)}
                    className={cn(
                      "inline-flex min-h-[2.5rem] items-center gap-2 rounded-full border border-white/20 bg-white/[0.03] px-4 text-[0.8rem] font-semibold text-white/90 transition-colors duration-300 hover:border-gold/50 hover:text-white",
                      "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold print:hidden",
                    )}
                  >
                    Open my Practice Elevation Dashboard
                    <ArrowRight aria-hidden className="size-4" />
                  </Link>
                </div>
                <Callout tone="sage">Do not enter client-identifying information, tax IDs, banking account numbers, or insurance policy numbers.</Callout>
              </Panel>
            </div>
          )}

          {page === "editor" && <Editor state={state} locked={locked} onChange={update} groupId={groupId} setGroupId={setGroupId} />}
          {page === "reviews" && <Reviews state={state} locked={locked} onChange={update} />}
          {page === "archive" && <Archives state={state} locked={locked} onChange={update} />}

          {page === "exports" && (
            <div className="flex flex-col gap-4">
              <h3 className="font-display text-xl text-white">Export Your Business Plan</h3>
              <Panel intro="Use Print / Save as PDF to create a readable business-plan document. Download the JSON backup to preserve editable data, and restore it here at any time. Your plan also stays saved in your member account.">
                <div className="flex flex-wrap gap-2">
                  <ActionButton primary icon="print" onClick={printPlan}>
                    Print full annual plan / Save as PDF
                  </ActionButton>
                  <ActionButton icon="download" onClick={exportBackup}>
                    Download editable data backup
                  </ActionButton>
                  {!locked && <RestoreButton onFile={restore}>Restore my backup</RestoreButton>}
                </div>
                {notice && (
                  <p role="status" className="text-sm text-orchid">
                    {notice}
                  </p>
                )}
              </Panel>
            </div>
          )}
        </>
      )}
    </DashboardFrame>
  );
}
