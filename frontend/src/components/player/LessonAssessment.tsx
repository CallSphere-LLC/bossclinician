import { useEffect, useRef, useState, type FormEvent } from "react";
import { CheckCircle2, RotateCcw, XCircle } from "lucide-react";
import { usePlayerSource, type QuizAttempt } from "@/components/player/playerSource";
import type { Quiz, QuizOutcome } from "@/lib/quizApi";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { cn } from "@/lib/cn";

type Attempt = QuizAttempt;

/**
 * A graded (or survey) assessment inside a lesson.
 *
 * Grading is server-side; the definition fetched here carries no answer key.
 * After a submission the form locks to show what was answered, each question
 * is marked right or wrong from the server's per-question feedback, and
 * "Retake" clears the form for another attempt.
 *
 * The three calls go through the player's source: a member's own session, or —
 * in the admin's "Preview as student" — an endpoint that marks the answers with
 * the same scorer and stores nothing, so there is no history and no completion.
 */
export function LessonAssessment({ slug }: { slug: string }) {
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [answers, setAnswers] = useState<Record<number, number[]>>({});
  const [texts, setTexts] = useState<Record<number, string>>({});
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [outcome, setOutcome] = useState<QuizOutcome | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const startedAt = useRef(Date.now());
  const resultRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const { quiz: quizApi, preview } = usePlayerSource();
  const refreshResults = () => quizApi.results(slug).then(setAttempts);
  useEffect(() => {
    startedAt.current = Date.now();
    setQuiz(null); setAnswers({}); setTexts({}); setOutcome(null); setError("");
    let active = true;
    void Promise.all([quizApi.get(slug), quizApi.results(slug)]).then(([definition, history]) => { if (active) { setQuiz(definition); setAttempts(history); } }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [quizApi, slug]);
  useEffect(() => { if (outcome) resultRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [outcome]);

  async function submit(event: FormEvent) {
    event.preventDefault(); if (!quiz || outcome) return; setBusy(true); setError("");
    try {
      const result = await quizApi.submit(slug, { responses: quiz.questions.map(question => ({ questionId: question.id, answerIds: answers[question.id] ?? [], text: texts[question.id] ?? "" })), elapsedMs: Date.now() - startedAt.current });
      setOutcome(result); await refreshResults();
      // Tells the player to re-read progress — of which a preview has none.
      if (!preview) window.postMessage({ type: "boss-assessment-completed", passed: result.passed, slug }, window.location.origin);
    } catch (e) { setError(e instanceof Error ? e.message : "Your answers could not be saved."); }
    finally { setBusy(false); }
  }

  function retake() {
    setAnswers({}); setTexts({}); setOutcome(null); setError("");
    startedAt.current = Date.now();
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const verdict = new Map((outcome?.feedback ?? []).map(item => [item.questionId, item]));
  const graded = quiz?.kind === "graded";
  const wrongCount = outcome && graded ? outcome.feedback.filter(item => !item.correct).length : 0;
  const everPassed = attempts.some(attempt => attempt.passed === true);
  const locked = busy || outcome !== null;

  return <div className="space-y-6 rounded-2xl border border-white/10 p-5">
    {error && <p role="alert" className="text-red-300">{error}</p>}
    {!quiz && !error && <p>Loading assessment…</p>}
    {quiz && <><div><h2 className="text-xl font-semibold">{quiz.title}</h2><p className="mt-2 text-sm text-orchid">{quiz.kind === "survey" ? "No pass mark · submitting your answers completes this lesson." : `Pass mark: ${quiz.passMark ?? 70}%. ${quiz.requirePass ? "A pass is required to complete this lesson." : "Submitting your answers completes this lesson."}`}{quiz.questions.length > 0 && ` · ${quiz.questions.length} question${quiz.questions.length === 1 ? "" : "s"}`}</p>{everPassed && !outcome && <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-emerald-300"><CheckCircle2 aria-hidden className="size-4" />You have passed this assessment. You can retake it any time.</p>}{quiz.introMd && <p className="mt-2 whitespace-pre-wrap text-sm text-orchid">{quiz.introMd}</p>}</div>
    <form ref={formRef} onSubmit={submit} className="space-y-6">
      {quiz.questions.map((question, index) => {
        const mark = verdict.get(question.id);
        const showMark = outcome !== null && graded && mark !== undefined;
        return <fieldset key={question.id} disabled={locked} className={cn("space-y-3 rounded-xl p-3 -m-3", showMark && mark && (mark.correct ? "bg-emerald-400/[0.06] ring-1 ring-emerald-400/30" : "bg-red-400/[0.06] ring-1 ring-red-400/40"))}>
          <legend className="font-semibold">{index + 1}. {question.prompt}{question.required ? " *" : ""}</legend>
          {showMark && mark && <p className={cn("flex items-center gap-1.5 text-sm font-semibold", mark.correct ? "text-emerald-300" : "text-red-300")}>{mark.correct ? <CheckCircle2 aria-hidden className="size-4" /> : <XCircle aria-hidden className="size-4" />}{mark.correct ? "Correct" : "Incorrect"}</p>}
          {question.helpText && <p className="text-sm text-orchid">{question.helpText}</p>}
          {question.kind === "multiple" && <p className="text-xs text-orchid-dim">Select all that apply.</p>}
          {question.kind === "text" ? <textarea aria-label={question.prompt} required={question.required} maxLength={2000} value={texts[question.id] ?? ""} onChange={e => setTexts(current => ({...current,[question.id]:e.target.value}))} className="min-h-24 w-full rounded-lg border border-white/20 bg-white/5 p-3" /> : question.answers.map(answer => <label key={answer.id} className="flex cursor-pointer items-start gap-3 rounded-lg border border-white/10 p-3 text-sm"><input type={question.kind === "multiple" ? "checkbox" : "radio"} name={`question-${question.id}`} required={question.required && question.kind !== "multiple"} checked={(answers[question.id] ?? []).includes(answer.id)} onChange={e => setAnswers(current => ({...current,[question.id]:question.kind === "multiple" ? e.target.checked ? [...(current[question.id] ?? []),answer.id] : (current[question.id] ?? []).filter(id => id !== answer.id) : [answer.id]}))} className="mt-0.5" />{answer.label}</label>)}
          {outcome && mark?.text && <p className="text-sm text-orchid">{mark.text}</p>}
        </fieldset>;
      })}
      {!outcome && <LuxeButton type="submit" disabled={busy || quiz.questions.length === 0}>{busy ? "Saving…" : quiz.kind === "survey" ? "Submit survey" : "Submit answers"}</LuxeButton>}
    </form>
    {outcome && <div ref={resultRef} role="status" className={cn("rounded-lg border p-4", outcome.passed === false ? "border-red-400/40" : "border-gold/30")}>
      <p className="font-body text-lg font-bold tabular-nums">{outcome.passed === null ? "Thanks! Here's your snapshot" : `${outcome.score} of ${outcome.maxScore} correct · ${outcome.percent}% · ${outcome.passed ? "Passed" : "Not passed"}`}</p>
      {outcome.passed === null ? <ul className="mt-3 space-y-2 text-sm">{quiz.questions.map(question => { const chosen = question.kind === "text" ? (texts[question.id] ?? "") : question.answers.filter(answer => (answers[question.id] ?? []).includes(answer.id)).map(answer => answer.label).join(", "); return <li key={question.id}><span className="text-orchid">{question.prompt}</span><br /><strong>{chosen || "No answer"}</strong></li>; })}</ul> : outcome.message && <p className="mt-2 text-sm">{outcome.message}</p>}
      {outcome.passed === null && !preview && <p className="mt-3 text-sm text-orchid">This lesson is now complete. Your answers are saved below.</p>}
      {preview && <p className="mt-3 text-sm text-orchid">Preview only — this attempt was not saved and does not complete the lesson.</p>}
      {graded && wrongCount > 0 && <p className="mt-2 text-sm text-orchid">{wrongCount} question{wrongCount === 1 ? " is" : "s are"} marked incorrect above.</p>}
      <div className="mt-4"><LuxeButton type="button" onClick={retake}><RotateCcw aria-hidden className="mr-2 inline size-4" />Retake</LuxeButton></div>
    </div>}
    {!preview && <section aria-label="Your assessment results"><h3 className="font-semibold">Your results</h3>{attempts.length === 0 ? <p className="mt-2 text-sm text-orchid">No attempts yet.</p> : <ol className="mt-3 space-y-3">{attempts.map(attempt => <li key={attempt.id} className="rounded-lg border border-white/10 p-3"><p className="text-sm tabular-nums">{new Date(attempt.completedAt).toLocaleString()} · {attempt.passed === null ? "Submitted" : `${attempt.percent}% · ${attempt.passed ? "Passed" : "Not passed"}`}</p><details className="mt-2 text-sm"><summary className="cursor-pointer">Your answers</summary>{attempt.responses.map(response => {const question=quiz.questions.find(q=>q.id===response.questionId);return <p key={response.questionId} className="mt-2"><strong>{question?.prompt}</strong>: {response.text || question?.answers.filter(a=>response.answerIds?.includes(a.id)).map(a=>a.label).join(", ") || "No answer"}</p>;})}</details></li>)}</ol>}</section>}</>}
  </div>;
}
