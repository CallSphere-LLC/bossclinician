import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useMember } from "@/hooks/useMember";
import { usePlayerSource } from "@/components/player/playerSource";
import { memberRequest } from "@/lib/memberApi";
import { ActionButton, DashboardFrame, downloadFile } from "./DashboardKit";
import { useVersionedToolState } from "./useVersionedToolState";
import { CEO_ASSESSMENT_KEY, CEO_CHOICES, CEO_DOMAINS, ceoReportText, completeCeoResponses, earlierQuarterReport, emptyCeoDraft, normaliseCeoDraft, previewCeoReport, type CeoReport, type CeoWorkspace } from "./ceoAssessment";

const control = "min-h-11 rounded-xl border border-white/20 bg-white/[0.04] px-4 py-2 text-sm text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold disabled:opacity-50";
const emptyWorkspace: CeoWorkspace = { reports: [], links: { dashboard: null, plan: null }, timezone: "UTC" };
function signedDelta(value: number) { return `${value > 0 ? "+" : ""}${value}`; }

export function BoardroomCeoAssessment() {
  const { member } = useMember();
  return <CeoAssessmentSession key={member?.id ?? "preview"} />;
}

function CeoAssessmentSession() {
  const { member } = useMember();
  const { preview } = usePlayerSource();
  const tool = useVersionedToolState(CEO_ASSESSMENT_KEY, emptyCeoDraft, normaliseCeoDraft);
  const [workspace, setWorkspace] = useState<CeoWorkspace>(emptyWorkspace);
  const [historyError, setHistoryError] = useState("");
  const [historyLoading, setHistoryLoading] = useState(!preview);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewReport, setPreviewReport] = useState<CeoReport | null>(null);
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const alive = useRef(true), busy = useRef(false), historySerial = useRef(0);
  const attempt = useRef<{ signature: string; requestId: string } | null>(null);
  const formRef = useRef<HTMLFormElement>(null), reportRef = useRef<HTMLElement>(null);
  const id = useId();
  const blocked = !tool.ready || ["loading", "offline", "readonly", "conflict"].includes(tool.status);
  const answered = tool.state.responses.filter(v => v >= 1 && v <= 4).length;
  const report = preview ? previewReport : workspace.reports.find(r => r.id === selectedId) ?? workspace.reports[0] ?? null;
  const earlier = report ? earlierQuarterReport(report, workspace.reports) : null;
  const comparable = earlier && report && earlier.assessmentVersion === report.assessmentVersion;
  const domain = CEO_DOMAINS[step];

  const refreshHistory = useCallback(async () => {
    if (preview || !member?.id) return;
    const serial = ++historySerial.current;
    setHistoryLoading(true);
    try {
      const result = await memberRequest<CeoWorkspace>("/member/boardroom-assessment");
      if (!alive.current || serial !== historySerial.current) return;
      setWorkspace(result); setHistoryError("");
    } catch (e) {
      if (alive.current && serial === historySerial.current) setHistoryError(e instanceof Error ? e.message : "Your saved reports could not be loaded.");
    } finally {
      if (alive.current && serial === historySerial.current) setHistoryLoading(false);
    }
  }, [preview, member?.id]);

  useEffect(() => {
    alive.current = true;
    void refreshHistory();
    const focus = () => void refreshHistory();
    window.addEventListener("focus", focus);
    return () => { alive.current = false; historySerial.current++; window.removeEventListener("focus", focus); };
  }, [refreshHistory]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (blocked || busy.current || (!preview && tool.status !== "saved" && tool.status !== "idle")) return;
    const responses = [...tool.state.responses];
    if (!completeCeoResponses(responses)) {
      setError("Answer all 12 questions to save your baseline report.");
      setStep(Math.floor(responses.findIndex(v => !v) / 2));
      return;
    }
    setError("");
    if (preview) { setPreviewReport(previewCeoReport(responses)); return; }
    const signature = JSON.stringify(responses);
    if (attempt.current?.signature !== signature) attempt.current = { signature, requestId: crypto.randomUUID() };
    busy.current = true; setSubmitting(true);
    try {
      const result = await memberRequest<{ report: CeoReport }>("/member/boardroom-assessment", { method: "POST", body: JSON.stringify({ responses, requestId: attempt.current!.requestId, expectedMemberId: member!.id }) });
      if (!alive.current) return;
      historySerial.current++;
      setHistoryLoading(false); setHistoryError("");
      setWorkspace(old => ({ ...old, reports: [result.report, ...old.reports.filter(r => r.id !== result.report.id)].sort((a, b) => b.completedAt.localeCompare(a.completedAt)) }));
      setSelectedId(result.report.id);
      // Retry the same failed request idempotently, but permit a later retake
      // with unchanged answers (including the next quarter) to create a report.
      attempt.current = null;
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : "Your report was not saved. Please try again.");
    } finally {
      busy.current = false;
      if (alive.current) setSubmitting(false);
    }
  }

  useEffect(() => { if (selectedId || previewReport) reportRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }, [selectedId, previewReport]);

  return <DashboardFrame eyebrow="Boss Clinician · The Boardroom" title="Your CEO Assessment" subtitle="Twelve questions to establish your strategic baseline and prepare your next advisory conversation." status={tool.status} savedAt={tool.savedAt} footer="This is a self-reported coaching baseline. Review it with your advisor and business metrics; it does not establish financial viability, regulatory compliance or hiring readiness.">
    {tool.status === "conflict" && <div className="flex flex-wrap gap-3"><ActionButton onClick={() => downloadFile("ceo-assessment-unsaved-answers.json", JSON.stringify(tool.state, null, 2), "application/json")}>Download my unsaved answers</ActionButton><ActionButton onClick={() => void tool.reload()}>Reload saved answers</ActionButton></div>}
    {tool.status === "offline" && <ActionButton onClick={() => void tool.reload()}>Retry loading my answers</ActionButton>}
    {historyLoading && <p role="status" className="text-sm text-orchid">Loading your saved baseline reports…</p>}
    {historyError && <div role="alert" className="space-y-2 text-sm text-orchid"><p>{historyError}</p><ActionButton onClick={() => void refreshHistory()}>Retry loading reports</ActionButton></div>}
    {report && <section ref={reportRef} aria-label="Your CEO Strategic Baseline Report" className="scroll-mt-24 space-y-5 rounded-xl border border-gold/30 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><h3 className="font-display text-xl text-white">Your CEO Strategic Baseline Report</h3><p className="mt-2 text-sm text-orchid">{preview ? "Preview report. Nothing is saved." : `Saved ${new Date(report.completedAt).toLocaleString(undefined, { timeZone: workspace.timezone })} · ${report.quarter}`}</p></div><ActionButton icon="download" onClick={() => downloadFile(`ceo-baseline-${report.quarter}.txt`, ceoReportText(report), "text/plain;charset=utf-8")}>Download report</ActionButton></div>
      <div><p className="text-sm text-orchid">Overall baseline</p><p className="font-body text-4xl font-bold tabular-nums text-gold">{report.overallScore}<span className="text-xl"> / 100</span></p></div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{report.domains.map(d => <div key={d.id} className="rounded-xl border border-white/15 p-4"><h4 className="text-sm font-semibold text-white">{d.name}</h4><p className="mt-2 font-body text-2xl font-bold tabular-nums text-white">{d.score}<span className="text-base text-orchid"> / 8</span></p></div>)}</div>
      <div><h4 className="font-semibold text-white">Three suggested priorities</h4><ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-orchid">{report.priorities.map(d => <li key={d.id}>{d.name}</li>)}</ol></div>
      <div><h4 className="font-semibold text-white">Recommended first action</h4><p className="mt-2 text-sm leading-relaxed text-orchid">{report.firstAction}</p></div>
      <p className="text-xs leading-relaxed text-orchid-dim">Lower domain scores guide these suggestions. Ties follow the listed domain order. Choose priorities with your advisor; your existing goals and Living Business Plan are not changed.</p>
      {!preview && <section aria-label="Quarterly comparison" className="border-t border-white/15 pt-4"><h4 className="font-semibold text-white">Quarterly comparison</h4>{!earlier ? <p className="mt-2 text-sm text-orchid">No earlier quarter has a saved baseline yet. Complete the assessment in a later quarter to compare your results.</p> : !comparable ? <p className="mt-2 text-sm text-orchid">Your {earlier.quarter} baseline used a different assessment version. Both reports are available below; their scores are not directly comparable.</p> : <><p className="mt-2 text-sm text-orchid">Compared with your last saved baseline in {earlier.quarter}: <strong className="text-white">{signedDelta(report.overallScore - earlier.overallScore)} points overall</strong>.</p><ul className="mt-3 grid gap-2 text-sm text-orchid sm:grid-cols-2">{report.domains.map(d => { const prior = earlier.domains.find(v => v.id === d.id); return <li key={d.id}>{d.name}: {prior ? `${signedDelta(d.score - prior.score)} points` : "No earlier score"}</li>; })}</ul><p className="mt-3 text-xs text-orchid-dim">Changes reflect your self-reported answers, not a verified change in business performance.</p></>}</section>}
      <div className="flex flex-wrap gap-3">{Object.entries(workspace.links).map(([key, link]) => link && <Link key={key} to={link.href} className={control}>{key === "dashboard" ? "Open my CEO Dashboard" : "Open my Living Business Plan"}</Link>)}<ActionButton onClick={() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>Review my answers</ActionButton></div>
    </section>}
    {!preview && workspace.reports.length > 0 && <div><label htmlFor={`${id}-history`} className="block text-sm font-semibold text-white">Saved baseline history</label><p className="mt-1 text-xs text-orchid-dim">Each saved report keeps its original answers and scores. Dates use {workspace.timezone}.</p><select id={`${id}-history`} className={`${control} mt-2 w-full min-w-0`} value={report?.id ?? ""} onChange={e => setSelectedId(e.target.value)}>{workspace.reports.map(r => <option key={r.id} value={r.id}>{r.quarter} · {new Date(r.completedAt).toLocaleString(undefined, { timeZone: workspace.timezone })} · {r.overallScore}/100</option>)}</select></div>}
    <form ref={formRef} onSubmit={submit} className="scroll-mt-24 space-y-5" aria-label="CEO assessment answers">
      <div><h3 className="font-display text-xl text-white">{report ? "Your current answers" : "Establish your baseline"}</h3><p className="mt-2 text-sm text-orchid">Choose the statement that best reflects your practice today. {answered} of 12 answered.</p></div>
      <div className="flex flex-wrap gap-2" aria-label="Assessment sections">{CEO_DOMAINS.map((d, i) => <button key={d.id} type="button" aria-current={step === i ? "step" : undefined} className={`${control} ${step === i ? "border-gold/60 bg-gold/10" : ""}`} onClick={() => setStep(i)}>{i + 1}. {d.name}</button>)}</div>
      <p className="text-sm font-semibold text-gold">Section {step + 1} of 6 · {domain.name}</p>
      {domain.questions.map((question, offset) => { const index = step * 2 + offset; return <fieldset key={index} disabled={blocked || submitting} className="min-w-0 space-y-3 rounded-xl border border-white/15 p-4 sm:p-5"><legend className="px-1 text-sm font-semibold leading-relaxed text-white">{index + 1}. {question}</legend>{CEO_CHOICES.map((choice, i) => <label key={choice} className={`flex min-h-12 cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm leading-relaxed ${tool.state.responses[index] === i + 1 ? "border-gold/60 bg-gold/10 text-white" : "border-white/15 text-orchid"}`}><input type="radio" name={`${id}-question-${index}`} value={i + 1} checked={tool.state.responses[index] === i + 1} onChange={() => { const responses = [...tool.state.responses]; responses[index] = i + 1; tool.setState({ responses }); setError(""); }} className="mt-1 size-4 shrink-0 accent-[#c8a25c]" /><span>{choice}</span></label>)}</fieldset>; })}
      {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
      <div className="flex flex-wrap items-center gap-3"><button type="button" className={control} disabled={step === 0} onClick={() => setStep(s => s - 1)}>Previous section</button>{step < 5 ? <button type="button" className={`${control} border-gold/60`} onClick={() => setStep(s => s + 1)}>Next section</button> : <button type="submit" className={`${control} border-gold/60 bg-gold/10 font-semibold`} disabled={blocked || submitting || (!preview && !["saved", "idle"].includes(tool.status))}>{submitting ? "Saving baseline…" : preview ? "Preview my baseline" : "Save baseline report"}</button>}</div>
      {step === 5 && tool.status === "saving" && <p className="text-xs text-orchid" role="status">Waiting for your latest answers to finish saving…</p>}
    </form>
  </DashboardFrame>;
}
