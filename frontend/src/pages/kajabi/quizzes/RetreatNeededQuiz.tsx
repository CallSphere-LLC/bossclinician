import { useId, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useReducedMotion } from "motion/react";
import { Seo } from "@/components/Seo";
import { useHoneypot } from "@/components/forms/useHoneypot";
import { api } from "@/lib/api";
import {
  RETREAT_QUIZ_EMAIL,
  RETREAT_QUIZ_PAGE,
  RETREAT_QUIZ_QUESTIONS,
  RETREAT_QUIZ_RESULTS,
  scoreRetreatQuiz,
} from "@/content/retreatQuiz";
import { EMAIL_PATTERN, answersAsData, scrollToEl, submitErrorMessage, useAlive, useFocusOnChange } from "./shared";
import "../../retreats.css";
import "./retreatQuiz.css";

/**
 * /retreat-needed-quiz — the FlourisHealer Burnout Self-Assessment, rebuilt
 * from the Kajabi page of the same path (content/retreatQuiz.ts), in the
 * retreat page's palette.
 *
 * As on the source: six questions, "QUESTION n OF 6"; a click on an answer
 * counts it and moves straight to the next question (there is no Next and no
 * Back); after the sixth the result shows at once, with the retreat panel and
 * the "not a clinical diagnostic tool" line. Nothing is asked for first. The
 * optional "keep your results" form under the result is this site's addition.
 */

const TOTAL = RETREAT_QUIZ_QUESTIONS.length;
const MAX_SCORE = TOTAL * 3;

export default function RetreatNeededQuiz() {
  const reduce = useReducedMotion();
  const { arm, focusOnMount } = useFocusOnChange();
  const quizRef = useRef<HTMLDivElement>(null);
  const [picks, setPicks] = useState<number[]>([]);

  const index = picks.length;
  const done = index >= TOTAL;
  const total = picks.reduce((sum, pick, qi) => sum + (RETREAT_QUIZ_QUESTIONS[qi]?.answers[pick]?.score ?? 0), 0);
  const resultKey = done ? scoreRetreatQuiz(total) : null;
  const question = RETREAT_QUIZ_QUESTIONS[index];

  function choose(answerIndex: number) {
    arm();
    setPicks((prev) => [...prev, answerIndex]);
    if (index + 1 >= TOTAL) scrollToEl(quizRef.current, reduce);
  }

  return (
    <>
      <Seo
        title="Burnout Self-Assessment for Women Mental Health Professionals | FlourisHealer Retreats"
        description="Six honest questions about how you are actually doing — not how you tell everyone you are doing. 2 minutes. Just you and the truth."
        canonicalPath="/retreat-needed-quiz"
      />
      <div className="retreat-page">
        <section className="retreat-hero">
          <div className="retreat-container">
            <p className="retreat-eyebrow">{RETREAT_QUIZ_PAGE.brand}</p>
            <h1>
              {RETREAT_QUIZ_PAGE.title}
              <em>{RETREAT_QUIZ_PAGE.titleAccent}</em>
            </h1>
            <div className="rq-hero-intro">
              {RETREAT_QUIZ_PAGE.intro.map((line) => (
                <p key={line}>{line}</p>
              ))}
              <p className="rq-time">{RETREAT_QUIZ_PAGE.time}</p>
            </div>
          </div>
        </section>

        <section className="retreat-band retreat-light" aria-label="Burnout Self-Assessment">
          <div className="rq-narrow" ref={quizRef}>
            {!done && question && (
              <>
                <p className="rq-progress" aria-live="polite">
                  QUESTION {index + 1} OF {TOTAL}
                </p>
                <h2 id="rq-question" className="rq-question" ref={focusOnMount} tabIndex={-1}>
                  {question.text}
                </h2>
                <div className="rq-answers" role="group" aria-labelledby="rq-question">
                  {question.answers.map((answer, ai) => (
                    <button key={answer.text} type="button" className="rq-answer" onClick={() => choose(ai)}>
                      {answer.text}
                    </button>
                  ))}
                </div>
              </>
            )}

            {done && resultKey && (
              <>
                <div className="rq-result">
                  <p className="rq-eyebrow">{RETREAT_QUIZ_PAGE.resultEyebrow}</p>
                  <h2 ref={focusOnMount} tabIndex={-1}>
                    {RETREAT_QUIZ_RESULTS[resultKey].title}
                  </h2>
                  <p className="rq-sub">{RETREAT_QUIZ_RESULTS[resultKey].sub}</p>
                  <p className="rq-body">{RETREAT_QUIZ_RESULTS[resultKey].body}</p>
                  <div className="rq-offer">
                    <p className="rq-triad">{RETREAT_QUIZ_PAGE.triad}</p>
                    <p>{RETREAT_QUIZ_PAGE.retreatLine}</p>
                    <Link to={RETREAT_QUIZ_PAGE.retreatHref} className="rq-button">
                      {RETREAT_QUIZ_PAGE.retreatCta}
                    </Link>
                  </div>
                  <p className="rq-disclaimer">{RETREAT_QUIZ_PAGE.disclaimer}</p>
                </div>
                <RetreatResultEmail
                  formSlug={RETREAT_QUIZ_RESULTS[resultKey].formSlug}
                  data={() => ({
                    result: RETREAT_QUIZ_RESULTS[resultKey].title,
                    score: `${total} of ${MAX_SCORE}`,
                    ...answersAsData(RETREAT_QUIZ_QUESTIONS, picks),
                  })}
                />
              </>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

function RetreatResultEmail({ formSlug, data }: { formSlug: string; data: () => Record<string, unknown> }) {
  const alive = useAlive();
  const errorId = useId();
  const firstId = useId();
  const lastId = useId();
  const emailId = useId();
  const [honeypot, honeypotField] = useHoneypot();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = RETREAT_QUIZ_EMAIL;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending) return;
    const first = firstName.trim();
    const last = lastName.trim();
    const address = email.trim().toLowerCase();
    if (!first || !last) {
      setError("Please enter your first and last name.");
      return;
    }
    if (!EMAIL_PATTERN.test(address)) {
      setError("Please enter a valid email address.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      await api.submitForm(formSlug, { first_name: first, last_name: last, email: address, ...data() }, address, honeypot());
      if (alive.current) setSent(true);
    } catch (err) {
      if (alive.current) setError(submitErrorMessage(err));
    } finally {
      if (alive.current) setSending(false);
    }
  }

  return (
    <div className="rq-form">
      <h3>{copy.heading}</h3>
      {sent ? (
        <p role="status">{copy.sent}</p>
      ) : (
        <form onSubmit={handleSubmit} noValidate style={{ position: "relative" }}>
          {honeypotField}
          <p>{copy.sub}</p>
          <div className="rq-row">
            <div>
              <label htmlFor={firstId}>First Name</label>
              <input
                id={firstId}
                name="first_name"
                type="text"
                autoComplete="given-name"
                required
                value={firstName}
                onChange={(e) => {
                  setFirstName(e.target.value);
                  setError(null);
                }}
              />
            </div>
            <div>
              <label htmlFor={lastId}>Last Name</label>
              <input
                id={lastId}
                name="last_name"
                type="text"
                autoComplete="family-name"
                required
                value={lastName}
                onChange={(e) => {
                  setLastName(e.target.value);
                  setError(null);
                }}
              />
            </div>
            <div>
              <label htmlFor={emailId}>Email</label>
              <input
                id={emailId}
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                required
                value={email}
                aria-describedby={error ? errorId : undefined}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError(null);
                }}
              />
            </div>
          </div>
          {error && (
            <p id={errorId} role="alert" className="rq-error">
              {error}
            </p>
          )}
          <button type="submit" className="rq-submit" disabled={sending}>
            {sending ? "Sending…" : copy.submit}
          </button>
          <p className="rq-small">{copy.disclaimer}</p>
        </form>
      )}
    </div>
  );
}
