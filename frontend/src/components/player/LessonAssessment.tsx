import { useEffect, useRef, useState, type FormEvent } from "react";
import { memberRequest } from "@/lib/memberApi";
import type { Quiz, QuizOutcome } from "@/lib/quizApi";
import { LuxeButton } from "@/components/luxe/LuxeButton";

type Attempt = { id: number; percent: number; passed: boolean | null; completedAt: string; responses: { questionId: number; answerIds?: number[]; text?: string }[] };
export function LessonAssessment({ slug }: { slug: string }) {
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [answers, setAnswers] = useState<Record<number, number[]>>({});
  const [texts, setTexts] = useState<Record<number, string>>({});
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [outcome, setOutcome] = useState<QuizOutcome | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const startedAt = useRef(Date.now());
  const path = `/assessments/${encodeURIComponent(slug)}`;
  const refreshResults = () => memberRequest<Attempt[]>(`${path}/my-results`).then(setAttempts);
  useEffect(() => {
    startedAt.current = Date.now();
    setQuiz(null); setAnswers({}); setTexts({}); setOutcome(null); setError("");
    let active = true;
    void Promise.all([memberRequest<Quiz>(path), memberRequest<Attempt[]>(`${path}/my-results`)]).then(([definition, history]) => { if (active) { setQuiz(definition); setAttempts(history); } }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [path]);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!quiz) return; setBusy(true); setError("");
    try {
      const result = await memberRequest<QuizOutcome>(`${path}/submit`, { method: "POST", body: JSON.stringify({ responses: quiz.questions.map(question => ({ questionId: question.id, answerIds: answers[question.id] ?? [], text: texts[question.id] ?? "" })), elapsedMs: Date.now() - startedAt.current }) });
      setOutcome(result); await refreshResults();
      window.postMessage({ type: "boss-assessment-completed", passed: result.passed, slug }, window.location.origin);
    } catch (e) { setError(e instanceof Error ? e.message : "Your answers could not be saved."); }
    finally { setBusy(false); }
  }
  return <div className="space-y-6 rounded-2xl border border-white/10 p-5">
    {error && <p role="alert" className="text-red-300">{error}</p>}
    {!quiz && !error && <p>Loading assessment…</p>}
    {quiz && <><div><h2 className="text-xl font-semibold">{quiz.title}</h2><p className="mt-2 text-sm text-orchid">{quiz.kind === "survey" ? "Survey · no pass mark" : `Pass mark: ${quiz.passMark ?? 70}%. ${quiz.requirePass ? "A pass is required to complete this lesson." : "Submitting your answers completes this lesson."}`}</p>{quiz.introMd && <p className="mt-2 whitespace-pre-wrap text-sm text-orchid">{quiz.introMd}</p>}</div>
    <form onSubmit={submit} className="space-y-6">
      {quiz.questions.map((question, index) => <fieldset key={question.id} disabled={busy} className="space-y-3"><legend className="font-semibold">{index + 1}. {question.prompt}{question.required ? " *" : ""}</legend>{question.helpText && <p className="text-sm text-orchid">{question.helpText}</p>}
        {question.kind === "text" ? <textarea aria-label={question.prompt} required={question.required} maxLength={2000} value={texts[question.id] ?? ""} onChange={e => setTexts(current => ({...current,[question.id]:e.target.value}))} className="min-h-24 w-full rounded-lg border border-white/20 bg-white/5 p-3" /> : question.answers.map(answer => <label key={answer.id} className="flex cursor-pointer items-start gap-3 rounded-lg border border-white/10 p-3 text-sm"><input type={question.kind === "multiple" ? "checkbox" : "radio"} name={`question-${question.id}`} required={question.required && question.kind !== "multiple"} checked={(answers[question.id] ?? []).includes(answer.id)} onChange={e => setAnswers(current => ({...current,[question.id]:question.kind === "multiple" ? e.target.checked ? [...(current[question.id] ?? []),answer.id] : (current[question.id] ?? []).filter(id => id !== answer.id) : [answer.id]}))} className="mt-0.5" />{answer.label}</label>)}
      </fieldset>)}
      <LuxeButton type="submit" disabled={busy || quiz.questions.length === 0}>{busy ? "Saving…" : quiz.kind === "survey" ? "Submit survey" : "Submit answers"}</LuxeButton>
    </form>
    {outcome && <div role="status" className="rounded-lg border border-gold/30 p-4"><p className="font-semibold">{outcome.passed === null ? "Responses saved" : `${outcome.percent}% · ${outcome.passed ? "Passed" : "Not passed"}`}</p><p className="mt-2 text-sm">{outcome.message}</p>{outcome.feedback.filter(feedback => feedback.text).map(feedback => <p className="mt-2 text-sm" key={feedback.questionId}>{feedback.text}</p>)}</div>}
    <section aria-label="Your assessment results"><h3 className="font-semibold">Your results</h3>{attempts.length === 0 ? <p className="mt-2 text-sm text-orchid">No attempts yet.</p> : <ol className="mt-3 space-y-3">{attempts.map(attempt => <li key={attempt.id} className="rounded-lg border border-white/10 p-3"><p className="text-sm">{new Date(attempt.completedAt).toLocaleString()} · {attempt.passed === null ? "Submitted" : `${attempt.percent}% · ${attempt.passed ? "Passed" : "Not passed"}`}</p><details className="mt-2 text-sm"><summary className="cursor-pointer">Your answers</summary>{attempt.responses.map(response => {const question=quiz.questions.find(q=>q.id===response.questionId);return <p key={response.questionId} className="mt-2"><strong>{question?.prompt}</strong>: {response.text || question?.answers.filter(a=>response.answerIds?.includes(a.id)).map(a=>a.label).join(", ") || "No answer"}</p>;})}</details></li>)}</ol>}</section></>}
  </div>;
}
