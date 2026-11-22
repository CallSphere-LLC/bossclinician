/**
 * The public retreat pages added for Yvette's second reply of 22 Nov 2026,
 * item 6: the permanent /upcoming-retreats listing and the reusable
 * /retreat-interest announcement sign-up (backend: routes/public/retreatsPublic.ts,
 * migration 223).
 *
 * The listing's lede is her own Email 4 paragraph, so the alumni email and the
 * page it opens say the same thing. Nothing here offers "first access": she
 * asked for that phrase to go unless advance access is actually offered.
 */

export const UPCOMING_RETREATS_PATH = "/upcoming-retreats";
export const RETREAT_INTEREST_PATH = "/retreat-interest";

/**
 * Word-for-word the consent the API stores with each sign-up
 * (backend RETREAT_INTEREST_CONSENT). Change both together.
 */
export const RETREAT_INTEREST_CONSENT =
  "Yes, email me announcements about new FlourisHealer retreats. I can unsubscribe at any time.";

export const upcomingRetreats = {
  seo: {
    title: "Upcoming Retreats | FlourisHealer",
    description:
      "Upcoming FlourisHealer retreats hosted by Yvette Howard, LCSW, for women in mental health and wellness, with a sign-up to hear when new retreats are announced.",
  },
  hero: {
    brand: "FLOURISHEALER RETREATS",
    title: "Upcoming Retreats",
    // Yvette's Email 4 paragraph (item 6), verbatim.
    lede: "If an upcoming retreat catches your eye, you can explore the details and decide whether it fits your next chapter. If nothing is announced yet, you can sign up to hear when new retreats are available.",
  },
  listEyebrow: "NOW ANNOUNCED",
  cardCta: "Explore the Retreat",
  empty: {
    eyebrow: "NOTHING ANNOUNCED YET",
    title: "New retreats are on the way.",
    body: "There are no upcoming retreats published right now. Sign up to hear when new retreats are available.",
  },
  more: {
    title: "Hear about future retreats",
    body: "Sign up to hear when new retreats are available.",
    cta: "Sign Up for Retreat Announcements",
  },
  error: "We couldn’t load the retreat list just now. Please try again in a moment.",
} as const;

export const retreatInterest = {
  seo: {
    title: "Retreat Announcements | FlourisHealer",
    description:
      "Sign up to hear when new FlourisHealer retreats are announced. Announcement emails only; unsubscribe at any time.",
  },
  hero: {
    brand: "FLOURISHEALER RETREATS",
    title: "Hear When New Retreats Are Announced",
    lede: "Sign up to hear when new retreats are available.",
  },
  receiveTitle: "What you’ll receive",
  receive: [
    "Emails announcing new FlourisHealer retreats, sent when a retreat is announced.",
    "Signing up does not reserve a place or commit you to anything.",
    "You can unsubscribe at any time with the link in any email.",
  ],
  form: {
    firstNameLabel: "First name (optional)",
    emailLabel: "Email address",
    consentLabel: RETREAT_INTEREST_CONSENT,
    submit: "Sign Up for Retreat Announcements",
    submitting: "Signing you up…",
    consentRequired: "Please tick the box to confirm you’d like these emails.",
    emailRequired: "Please enter your email address.",
    privacyLead: "How we handle your details: ",
    privacyLink: "Privacy Policy",
    privacyHref: "/privacy-policy",
    genericError: "Something went wrong. Please try again in a moment.",
  },
  success: {
    title: "You’re on the list.",
    body: "We’ll email you when a new FlourisHealer retreat is announced.",
    cta: "See Upcoming Retreats",
  },
} as const;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

function parts(iso: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { y, m, d };
}

/**
 * "June 15–20, 2027" from two stored calendar dates. Deliberately string
 * arithmetic, never `new Date()`: a date-only string parsed as UTC and shown in
 * Pacific time would read one day early (June 14–19).
 */
export function formatRetreatDates(start: string, end: string): string {
  const a = parts(start);
  const b = parts(end);
  if (!a || !b) return "";
  const ma = MONTHS[a.m - 1];
  const mb = MONTHS[b.m - 1];
  if (a.y === b.y && a.m === b.m) {
    return a.d === b.d ? `${ma} ${a.d}, ${a.y}` : `${ma} ${a.d}–${b.d}, ${a.y}`;
  }
  if (a.y === b.y) return `${ma} ${a.d} – ${mb} ${b.d}, ${a.y}`;
  return `${ma} ${a.d}, ${a.y} – ${mb} ${b.d}, ${b.y}`;
}
