/**
 * "Are You Ready to Hire Your First Clinician?" — the hiring quiz at
 * /hiring-quiz and its sign-up form at /hire-form.
 *
 * Copied verbatim from bossclinician.com/hiring-quiz (the `questions` and
 * `results` objects in its inline script, and its markup) and from
 * bossclinician.com/hire-form (the Kajabi form in front of it). Kajabi's
 * absolute bossclinician.com links are replaced by this site's own routes;
 * `ctaUrl` is the address line printed under the button and stays as display
 * text only.
 *
 * Scoring, as the source does it: every answer is worth 3, 2, 1 or 0; the
 * total is divided by the maximum (7 × 3 = 21); 70% or more is "ready", 40% or
 * more is "almost", anything lower is "notYet".
 *
 * The two pages work as they did on Kajabi: /hire-form asks for name, email
 * and two practice questions, then sends the visitor to /hiring-quiz. The
 * Resource Hub links straight to /hiring-quiz too, so the quiz also works on
 * its own. When the visitor came through /hire-form, the result is filed for
 * them under the matching result form (migration 099) as soon as it is shown,
 * which tags the contact and emails them the result; otherwise an optional
 * "email me my result" form sits under the result.
 */

export type HiringResultKey = "ready" | "almost" | "notYet";

export interface HiringQuizAnswer {
  text: string;
  score: number;
}

export interface HiringQuizQuestion {
  text: string;
  answers: readonly HiringQuizAnswer[];
}

export const HIRING_QUIZ_QUESTIONS: readonly HiringQuizQuestion[] = [
  {
    text: "Your practice is consistently full — you're regularly turning away clients or have a waitlist.",
    answers: [
      { text: "Yes — I have a waitlist or regularly refer clients out", score: 3 },
      { text: "Most of the time — I'm pretty consistently full", score: 2 },
      { text: "Sometimes — my schedule has gaps but I'm working on it", score: 1 },
      { text: "Not yet — I'm still building my caseload", score: 0 },
    ],
  },
  {
    text: "You have a clear understanding of your monthly revenue and expenses, including what you'd need to cover a new hire's compensation.",
    answers: [
      { text: "Yes — I know my numbers clearly and have modeled what hiring would cost", score: 3 },
      { text: "Mostly — I have a general sense of my financials", score: 2 },
      { text: "Somewhat — I know my income but not a detailed breakdown", score: 1 },
      { text: "Not yet — my finances are not clearly organized", score: 0 },
    ],
  },
  {
    text: "Your practice has documented systems for client intake, scheduling, billing, and clinical onboarding that a new clinician could follow.",
    answers: [
      { text: "Yes — everything is documented and systemized", score: 3 },
      { text: "Some systems exist but they're not fully documented", score: 2 },
      { text: "A few basic processes but mostly in my head", score: 1 },
      { text: "No — most of my practice runs through me personally", score: 0 },
    ],
  },
  {
    text: "You have a consistent referral source or marketing system that generates more demand than you alone can handle.",
    answers: [
      { text: "Yes — I have consistent referrals and more demand than capacity", score: 3 },
      { text: "I have referral sources but demand fluctuates", score: 2 },
      { text: "I get occasional referrals but nothing consistent", score: 1 },
      { text: "No — I'm still figuring out my marketing and referral pipeline", score: 0 },
    ],
  },
  {
    text: "You have a clear vision of what type of clinician you want to hire, what specialty or population they would serve, and what their role would look like.",
    answers: [
      { text: "Yes — I know exactly who I need and what their role would be", score: 3 },
      { text: "I have a general idea but haven't defined the details", score: 2 },
      { text: "I know I need help but haven't figured out what kind", score: 1 },
      { text: "No — I'm not clear on this yet", score: 0 },
    ],
  },
  {
    text: "You understand the legal and financial requirements of hiring in your state — including whether you want a W2 employee or a 1099 contractor, and the compliance implications of each.",
    answers: [
      { text: "Yes — I've researched this and understand the differences", score: 3 },
      { text: "I have a general understanding and plan to research more", score: 2 },
      { text: "I've heard of the difference but don't understand the details", score: 1 },
      { text: "No — this is new territory for me", score: 0 },
    ],
  },
  {
    text: "You are prepared for the reality that a new hire will likely not be profitable in the first 60–90 days, and your current revenue can absorb that gap.",
    answers: [
      { text: "Yes — I have the financial cushion and have planned for this", score: 3 },
      { text: "Mostly — I have some cushion but it would be tight", score: 2 },
      { text: "Somewhat — I'd be stretching but could potentially manage", score: 1 },
      { text: "No — I need the hire to be profitable almost immediately", score: 0 },
    ],
  },
];

export interface HiringQuizResult {
  eyebrow: string;
  headline: string;
  sub: string;
  p1: string;
  p2: string;
  steps: readonly string[];
  ctaCopy: string;
  ctaBtn: string;
  /** This site's route in place of the source's absolute bossclinician.com link. */
  ctaLink: string;
  /** The address line printed under the button on the source. Display text only. */
  ctaUrl: string;
  /** The result form this result files under (migration 099). */
  formSlug: string;
  /** "Ready" / "Almost Ready" / "Not Yet" — the label stored on the reply and in the email subject. */
  label: string;
}

export const HIRING_QUIZ_RESULTS: Record<HiringResultKey, HiringQuizResult> = {
  ready: {
    eyebrow: "Your Result",
    headline: "You're Ready — Let's Build This Right.",
    sub: "Your practice has the foundation to support a new hire.",
    p1: "Based on your answers, your practice has the core elements in place to make hiring a success — consistent demand, financial clarity, systems, and a real vision for growth. You're not hiring out of desperation. You're hiring from a position of strength. That's exactly the right foundation.",
    p2: "The work now is about doing this strategically — finding the right clinician, structuring compensation correctly, onboarding them well, and building a team culture that actually sticks. That's exactly what the Boss Clinician Boardroom helps you navigate.",
    steps: [
      "Define your ideal hire — specialty, population, schedule, and compensation structure",
      "Confirm your W2 vs. 1099 decision with a legal or HR professional before posting",
      "Create an onboarding packet before you start interviewing",
      "Build a credentialing timeline so the new hire is billing as quickly as possible",
      "Join the Boss Clinician Boardroom for peer-level support through the hiring process",
    ],
    ctaCopy: "The Boss Clinician Boardroom is for group practice owners who are ready to grow — and want to do it right. Get peer-level strategy, CEO leadership development, and a room full of practice owners navigating exactly what you're navigating.",
    ctaBtn: "Apply for the Boss Clinician Boardroom",
    ctaLink: "/boardroom",
    ctaUrl: "bossclinician.com/boardroom",
    formSlug: "hiring-quiz-ready",
    label: "Ready",
  },
  almost: {
    eyebrow: "Your Result",
    headline: "Almost Ready — A Few Gaps to Close First.",
    sub: "Strong foundation with a few important areas to strengthen before hiring.",
    p1: "Your practice is on the right track, but your quiz results point to a few gaps that could make hiring harder than it needs to be — whether that's financial clarity, referral consistency, or systems that don't yet exist on paper. Hiring before these are solid can create more chaos than relief.",
    p2: "The good news: these gaps are completely fixable, and closing them before you hire protects both you and any clinician you bring on. Here's where to focus first.",
    steps: [
      "Identify your lowest-scoring area and focus there for 30–60 days before hiring",
      "If your systems aren't documented — start there. Document your intake, billing, and scheduling process",
      "If your financials aren't clear — build a simple P&L and model what hiring would look like monthly",
      "If your referral pipeline isn't consistent — shore that up before adding overhead",
      "Download the Group Practice Self-Assessment for a deeper diagnostic on your specific blockers",
    ],
    ctaCopy: "The Boss Clinician Boardroom helps group practice owners close exactly these gaps — with peer support, expert strategy, and real accountability. It's designed for clinicians in exactly this season.",
    ctaBtn: "Apply for the Boss Clinician Boardroom",
    ctaLink: "/boardroom",
    ctaUrl: "bossclinician.com/boardroom",
    formSlug: "hiring-quiz-almost",
    label: "Almost Ready",
  },
  notYet: {
    eyebrow: "Your Result",
    headline: "Not Yet — But That's Honest, and That's Good.",
    sub: "Your practice needs a stronger solo foundation before adding a team member.",
    p1: "Based on your answers, your practice isn't quite ready for a hire — and that's actually the most important thing to know before you bring someone on. Hiring before the foundation is solid is one of the most common and costly mistakes group practice owners make.",
    p2: "The work right now is building the practice that makes hiring possible — consistent income, real systems, and a referral pipeline that generates demand beyond what you alone can serve. That's not a setback. That's strategy.",
    steps: [
      "Focus on reaching and maintaining a full, consistent caseload for 3+ consecutive months",
      "Build and document your core systems — intake, scheduling, billing, clinical onboarding",
      "Create a simple referral system that generates consistent new inquiries",
      "Get clear on your financials — know your monthly revenue, expenses, and profit margin",
      "Start with the free Practice Reset Audit to identify exactly what needs restructuring first",
    ],
    ctaCopy: "The Boss Clinician Lounge is your next step — a monthly membership for established clinicians ready to strengthen their structure, stabilize their income, and build toward sustainable growth, including a future team.",
    ctaBtn: "Join the Boss Clinician Lounge",
    ctaLink: "/lounge",
    ctaUrl: "bossclinician.com/lounge",
    formSlug: "hiring-quiz-not-yet",
    label: "Not Yet",
  },
};

/** The page around the quiz, from the source's markup. */
export const HIRING_QUIZ_PAGE = {
  backLabel: "← Back to Resource Hub",
  backHref: "/resource-hub",
  eyebrow: "Free Quiz · Boss Clinician",
  title: "Are You Ready to Hire Your First Clinician?",
  titleAccent: "Let's find out.",
  sub: "7 questions. 5 minutes. A clear, personalized answer — and an action plan no matter where you land.",
  meta: "Free · Takes 5 minutes",
  progressLabel: "Your Progress",
  next: "Next Question →",
  last: "See My Results →",
  back: "← Back",
  complete: "Complete!",
  stepsLabel: "Your Next Steps",
  retake: "Take the quiz again",
} as const;

/** The optional email step under the result, for a visitor who skipped /hire-form. Not on the source. */
export const HIRING_QUIZ_EMAIL = {
  eyebrow: "Keep Your Result",
  heading: "Want your action plan in your inbox?",
  sub: "Enter your name and email and we will send you your result and your next steps.",
  submit: "EMAIL MY RESULT",
  sent: "Sent — check your inbox (and your spam folder, just in case).",
  /** Shown instead of the form when the visitor came through /hire-form. */
  onItsWay: "Your result and next steps are on their way to",
} as const;

/** /hire-form, verbatim from the Kajabi page. */
export const HIRE_FORM = {
  eyebrow: "Free Quiz · Boss Clinician",
  title: "Are You Ready to Hire Your First Clinician?",
  titleAccent: "Let's find out.",
  sub: "7 questions. 5 minutes. A clear, personalized answer — and an action plan no matter where you land.",
  lead: "Enter your name and email to get your results!",
  firstName: "First Name",
  email: "Email",
  lastName: "Last Name",
  practiceYears: {
    label: "How Long Have You Been In Practice",
    options: ["0-1 year", "2-3 years", "4-5+ years"],
  },
  groupOwnerYears: {
    label: "How Long Have You Been A Group Practice Owner",
    options: ["I haven't hired just yet, but feel ready", "1-2 years", "3-4 years", "5-10+ years"],
  },
  submit: "I WANT TO KNOW IF I AM READY!",
  disclaimer:
    "By submitting this form you agree to receive emails from Boss Clinician, LLC. This resource is educational only and is not legal, financial, or clinical advice. You can unsubscribe anytime. See our Privacy Policy and Terms.",
  formSlug: "hire-form",
} as const;

/** Where /hire-form leaves the visitor's name and email for /hiring-quiz to find. */
export const HIRING_CONTACT_STORAGE_KEY = "bc.hiringQuiz.contact";

export interface HiringContact {
  firstName: string;
  lastName: string;
  email: string;
}

export const HIRING_QUIZ_MAX_SCORE = HIRING_QUIZ_QUESTIONS.length * 3;

/** The source's thresholds: 70% and 40% of the maximum score. */
export function scoreHiringQuiz(picks: readonly (number | null)[]): {
  result: HiringResultKey;
  total: number;
} {
  let total = 0;
  HIRING_QUIZ_QUESTIONS.forEach((question, qi) => {
    const pick = picks[qi];
    if (pick === null || pick === undefined) return;
    total += question.answers[pick]?.score ?? 0;
  });
  const pct = total / HIRING_QUIZ_MAX_SCORE;
  const result: HiringResultKey = pct >= 0.7 ? "ready" : pct >= 0.4 ? "almost" : "notYet";
  return { result, total };
}
