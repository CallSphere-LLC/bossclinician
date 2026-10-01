/**
 * The FlourisHealer Burnout Self-Assessment at /retreat-needed-quiz, and the
 * retreat reservation thank-you page at /retreat-thank-you-page.
 *
 * Both copied verbatim from the Kajabi pages of the same paths (the quiz from
 * its inline `questions` array and `showResults`). Kajabi's absolute
 * bossclinician.com links are replaced by this site's own routes: the retreat
 * page is /retreats, and the Retreat Terms go to /terms (the convention in
 * content/retreats.ts, where the redirect map also sends /retreatagreement).
 * The quiz says "Six days" and the thank-you page "five days"; both are the
 * live wording and are kept as they are.
 *
 * Scoring, as the source does it: answers are worth 1, 2 or 3; a click adds
 * the answer and moves straight on (no Next, no Back); a total of 14 or more
 * is The Depleted Pourer, 10 or more The Functional Giver, otherwise The
 * Replenished Woman.
 *
 * Kajabi asks for no email here and shows the result straight away. That is
 * kept. Under the result this site adds an optional "email me my result" form,
 * one per result (migration 099), which tags the contact and sends the result.
 */

export type RetreatResultKey = "depleted" | "functional" | "replenished";

export interface RetreatQuizAnswer {
  text: string;
  score: number;
}

export interface RetreatQuizQuestion {
  text: string;
  answers: readonly RetreatQuizAnswer[];
}

export const RETREAT_QUIZ_QUESTIONS: readonly RetreatQuizQuestion[] = [
  {
    text: "It is 9 PM. Clients are seen, family is handled, tasks are done. What happens next?",
    answers: [
      { text: "I finally do something just for me, and I do not feel guilty about it", score: 1 },
      { text: "I scroll or zone out until I fall asleep. That counts as rest, right?", score: 2 },
      { text: "More work. Notes, emails, or planning tomorrow. The day is not done until I collapse", score: 3 },
    ],
  },
  {
    text: "When was the last time someone else planned, prepared, and handled everything so you could just receive?",
    answers: [
      { text: "Recently. I intentionally build these experiences into my life", score: 1 },
      { text: "It has been a year or more. Maybe a special occasion someone arranged", score: 2 },
      { text: "I honestly cannot remember. I am always the one doing the planning", score: 3 },
    ],
  },
  {
    text: "Finish this sentence honestly. \"I will finally rest after...\"",
    answers: [
      { text: "Nothing. I rest now, because I stopped waiting for permission", score: 1 },
      { text: "This season calms down. It should slow down soon. Probably", score: 2 },
      { text: "The next milestone. And the one after that. The finish line keeps moving", score: 3 },
    ],
  },
  {
    text: "Your closest friendships and connections right now feel...",
    answers: [
      { text: "Nourishing. I have people who pour into me as much as I pour into them", score: 1 },
      { text: "Mutual, but I am usually the strong one, even with friends", score: 2 },
      { text: "Like one more place I hold space. Even my rest has a job", score: 3 },
    ],
  },
  {
    text: "When you imagine spending real money on your own restoration, the first voice in your head says...",
    answers: [
      { text: "You have earned this and you need it. Book it", score: 1 },
      { text: "Maybe when things are more stable. The timing never feels right", score: 2 },
      { text: "That is selfish. That money belongs to the practice, the family, everyone else", score: 3 },
    ],
  },
  {
    text: "Be honest. How are you actually doing?",
    answers: [
      { text: "Genuinely well. Full, steady, and still growing", score: 1 },
      { text: "Functioning. Everyone thinks I am fine. Some days I am", score: 2 },
      { text: "Tired in a way that sleep does not fix", score: 3 },
    ],
  },
];

export interface RetreatQuizResult {
  title: string;
  sub: string;
  body: string;
  /** The result form this result files under (migration 099). */
  formSlug: string;
}

export const RETREAT_QUIZ_RESULTS: Record<RetreatResultKey, RetreatQuizResult> = {
  depleted: {
    title: "The Depleted Pourer",
    sub: "Running on empty and still pouring",
    body: "You are the woman everyone counts on, and it is costing you more than anyone sees. You hold space all day, come home and hold more, and the version of rest you get still has a job attached. Here is the truth you already know as a clinician: you cannot keep giving from an empty cup, and no one is coming to fill it for you. You have to choose it. Six days where everything is handled and your only job is to receive is not a luxury for a woman in your season. It is the intervention.",
    formSlug: "retreat-quiz-depleted",
  },
  functional: {
    title: "The Functional Giver",
    sub: "Holding it together, quietly running low",
    body: "From the outside you are fine. Practice running, family handled, everyone taken care of. But you felt these questions land, which means some part of you knows the mask is doing more work than it used to. You do not need to hit empty before you choose yourself. The women who get ahead of burnout are the ones who rest BEFORE the breaking point. Six days of being fully poured into is how you protect everything you have built, including you.",
    formSlug: "retreat-quiz-functional",
  },
  replenished: {
    title: "The Replenished Woman",
    sub: "Pouring from a full cup",
    body: "You have done the work most women in this field never do. You rest without guilt, you invest in yourself, and you know restoration is a practice, not a reward. Women like you do not come to retreats to recover. You come to deepen, to connect with women on your level, and to experience the kind of luxury rest you cannot create alone. You would not just attend this sisterhood. You would elevate it.",
    formSlug: "retreat-quiz-replenished",
  },
};

/** The page around the quiz and the fixed lines of the result, from the source. */
export const RETREAT_QUIZ_PAGE = {
  brand: "FlourisHealer Retreats",
  title: "Burnout Self-Assessment",
  titleAccent: "for Women Mental Health Professionals",
  intro: [
    "You check on everyone. Your clients. Your family. Your team. This is the check-in that is just for you.",
    "Six honest questions about how you are actually doing — not how you tell everyone you are doing. Because the woman who holds space for others deserves to know when her own cup is running low, before it runs empty.",
  ],
  time: "2 minutes. Just you and the truth.",
  resultEyebrow: "Your Assessment Results",
  triad: "Release. Restore. Reconnect.",
  retreatLine:
    "June 15-20, 2027 · Ubud, Bali · A private luxury villa for women mental health professionals. Six days where you are not responsible for anyone but yourself.",
  retreatCta: "Discover the Retreat",
  retreatHref: "/retreats",
  disclaimer: "This is a reflective self-assessment, not a clinical diagnostic tool.",
} as const;

/** The optional email step under the result. Not on the source. */
export const RETREAT_QUIZ_EMAIL = {
  heading: "Keep your results",
  sub: "Enter your name and email and we will send your assessment results to your inbox, along with the retreat details.",
  submit: "Email My Results",
  sent: "Sent. Check your inbox, and your spam folder just in case.",
  disclaimer:
    "By submitting this form you agree to receive emails from Boss Clinician, LLC. You can unsubscribe anytime.",
} as const;

export function scoreRetreatQuiz(total: number): RetreatResultKey {
  if (total >= 14) return "depleted";
  if (total >= 10) return "functional";
  return "replenished";
}

/** /retreat-thank-you-page, verbatim from the Kajabi page. */
export const RETREAT_THANK_YOU = {
  brand: "FlourisHealer Retreats",
  backLabel: "Back to Retreats →",
  backHref: "/retreats",
  eyebrow: "Reservation Confirmed",
  strip: "FlourisHealer Retreat  ·  Bali 2027",
  titleLead: "Hey Flourisher,",
  titleAccent: "you’re in.",
  paragraphs: [
    "Your spot in the Release. Restore. Reconnect. retreat is officially reserved. Welcome to something you have been putting off for far too long — five days in Bali that belong entirely to you.",
    "This is the beginning of a transformational experience filled with luxury, sisterhood, and genuine rest. You said yes to yourself today. That matters more than you know.",
  ],
  inboxNote:
    "Check your inbox — a confirmation email is on its way to you from retreats@bossclinician.com. Save that address now so every update reaches you safely.",
  /** The address in `inboxNote` is a mail link on the source. */
  inboxLink: { text: "retreats@bossclinician.com", href: "mailto:retreats@bossclinician.com" },
  stepsHeading: "Your Next Steps",
  steps: [
    {
      title: "Check Your Email",
      body: "A full confirmation and booking details are headed to your inbox right now. Add retreats@bossclinician.com to your contacts so nothing goes to spam.",
      link: { text: "retreats@bossclinician.com", href: "mailto:retreats@bossclinician.com" },
    },
    {
      title: "Sign Your Trip Agreement",
      body: "All participants must read and sign the FlourisHealer Retreat Trip Agreement before the retreat begins. Please complete this as soon as possible — click the button below to sign now.",
      cta: { label: "✍ Sign My Trip Agreement Now", href: "https://form.jotform.com/262157127017048" },
    },
    {
      title: "Get Travel Insurance",
      body: "Because all payments are non-refundable, travel insurance is strongly recommended. We suggest Trawick International — visit trawickinternational.com to explore coverage options before booking your flights.",
      link: { text: "Trawick International", href: "https://trawickinternational.com/" },
    },
    {
      title: "Book Your Flights",
      body: "Book your flights to I Gusti Ngurah Rai International Airport (DPS), Bali. Aim to arrive on June 15, 2027 and depart on June 20, 2027. Group shuttle transfers are included from the airport.",
    },
    {
      title: "Follow & Stay Close",
      body: "Follow @profitwithyvette on Instagram for retreat updates, behind-the-scenes content, and announcements. More details will be shared in the months ahead.",
      link: { text: "@profitwithyvette", href: "https://instagram.com/profitwithyvette" },
    },
  ],
  datesHeading: "Important Dates to Save",
  dates: [
    { date: "June 8, 2027", body: "Final payment deadline. All balances must be paid in full by this date or your spot will be forfeited with no refund." },
    { date: "June 15, 2027", body: "Arrival day. Fly into DPS. Group luxury shuttle to the villa. Your retreat begins." },
    { date: "June 15–20", body: "The retreat. Five days of release, restoration, and reconnection in Ubud, Bali." },
    { date: "June 20, 2027", body: "Departure day. Group shuttle back to DPS. You leave different than you arrived." },
  ],
  quote: "“You have spent years showing up for everyone else. This is your turn to be held.”",
  quoteBy: "— Yvette Howard, LCSW  ·  FlourisHealer Retreats",
  signName: "Yvette Howard",
  signRole: "LCSW  ·  Founder, FlourisHealer Retreats & Boss Clinician, LLC",
  questions: "Questions? We are here.",
  email: "retreats@bossclinician.com",
  instagram: { text: "@profitwithyvette", href: "https://instagram.com/profitwithyvette" },
  /** The source's footer line names the site; here it is this site's home page. */
  siteLabel: "bossclinician.com",
  siteHref: "/",
  footer: "© 2026 Boss Clinician, LLC  ·  FlourisHealer Retreats  ·  Bali, June 15–20, 2027",
  legal: [
    { label: "Privacy Policy", href: "/privacy-policy" },
    { label: "Retreat Terms", href: "/terms" },
    { label: "Disclaimer", href: "/disclaimer" },
  ],
} as const;
