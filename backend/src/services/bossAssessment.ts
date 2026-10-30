import { z } from "zod";
import { env } from "../config/env";
import { pool } from "../db/pool";
import { sendMail } from "../email/mailer";
import { escapeHtml } from "../email/templates";
import { plainText } from "../utils/plainText";

/**
 * /boss-assessment, the server's half: the group practice self-assessment
 * "Are You Running Your Practice, or Is It Running You?".
 *
 * The page works the result out in the browser so nobody has to hand over an
 * address to see it. This file works it out again from the ten answers, because
 * "email my results" is a public endpoint that sends to whatever address it is
 * given. Nothing a visitor types reaches the email except the first word of a
 * first name, and that has to look like a name. The commitment box in particular
 * is kept on the reply and never mailed, and any total or result text a client
 * sends is thrown away.
 *
 * The words are the same as frontend/src/content/bossAssessment.ts;
 * bossAssessment.test.ts fails if the two drift apart.
 */

export const BOSS_ASSESSMENT_FORM_SLUG = "boss-assessment";

/** What the delivery log calls this email, and what the send caps below count. */
export const BOSS_ASSESSMENT_EMAIL_TOPIC = "boss_assessment_result";

/** Enough for a retake or two. A stranger cannot use this to flood one inbox. */
const MAX_SENDS_PER_ADDRESS_PER_DAY = 3;

/** Far above real traffic. A spread of addresses cannot burn the sending domain. */
const MAX_SENDS_PER_DAY = 500;

const MAX_FIRST_NAME_CHARS = 40;
const MAX_GREETING_CHARS = 30;
const MAX_COMMITMENT_CHARS = 2000;

interface BlockerArea {
  /** The form's hidden question that holds this area's score (migration 177). */
  key: string;
  title: string;
  description: string;
  action: string;
  questions: readonly [string, string];
}

export const BOSS_ASSESSMENT_AREAS: readonly BlockerArea[] = [
  {
    key: "leadership_dependency",
    title: "Leadership Dependency",
    description: "Leadership infrastructure may need strengthening so appropriate decisions no longer depend on you.",
    action: "Identify one recurring decision that can be delegated with clear ownership and decision boundaries.",
    questions: [
      "My team asks for my input or approval before making decisions they could reasonably make on their own.",
      "When I’m unavailable — out of the office, in a session, or on vacation — things slow down or fall apart.",
    ],
  },
  {
    key: "broken_pay_structure",
    title: "Broken Pay Structure",
    description: "Owner compensation may not be adequately reflected in your pricing and financial planning.",
    action: "Review collected revenue, payroll, overhead, taxes, and a realistic owner-pay target with your financial advisor.",
    questions: [
      "I know what my clinicians earn but I’m not consistently clear on what I should be paying myself.",
      "After covering payroll, overhead, and taxes, my take-home pay doesn’t reflect the volume of work moving through my practice.",
    ],
  },
  {
    key: "missing_systems",
    title: "Missing Systems",
    description: "Undocumented processes may be keeping everyday operations dependent on your personal knowledge.",
    action: "Choose one recurring process—intake, scheduling, billing, or onboarding—and document the steps and responsible owner.",
    questions: [
      "If a new clinician joined today, there is no documented onboarding process they could follow without my direct involvement.",
      "Key processes — intake, scheduling, billing, documentation review — depend on my personal knowledge rather than written systems.",
    ],
  },
  {
    key: "team_misalignment",
    title: "Team Misalignment",
    description: "Your team may need clearer expectations, leadership communication, and retention strategies.",
    action: "Schedule a team leadership check-in to clarify expectations, culture, ownership, and common friction points.",
    questions: [
      "My clinicians do good clinical work but don’t understand or actively participate in the culture and direction of the practice.",
      "Retaining clinicians is a recurring challenge — I spend significant time or money on turnover that disrupts the practice.",
    ],
  },
  {
    key: "no_exit_strategy",
    title: "No Exit Strategy",
    description: "The business may not have a documented plan to operate while you are unavailable.",
    action: "Map what happens during a two-week absence and identify the owner-dependent tasks that require backup coverage.",
    questions: [
      "I have not clearly defined what my role in this practice looks like when I am fully leading it — rather than operating in it daily.",
      "A real vacation, maternity leave, or extended time away would currently create a significant disruption to operations or revenue.",
    ],
  },
];

export const BOSS_ASSESSMENT_DISCLAIMER =
  "Scores are self-reported reflection tools, not a validated diagnostic measure or financial audit. Each domain has two responses from 1 to 5, so scores range from 2 to 10. Your highest score identifies the blocker to consider first. Ties are shown together.";

const BOARDROOM_COPY =
  "The Boss Clinician Boardroom is an executive advisory experience for practice owners ready to strengthen leadership, profitability, systems, and the structure behind the business.";
const BOARDROOM_FINE_PRINT = "Applying does not guarantee acceptance.";

export interface BossAssessmentResult {
  /** The five areas' scores, 2 to 10, in the order of BOSS_ASSESSMENT_AREAS. */
  totals: number[];
  /** 10 to 50. */
  sum: number;
  tierTitle: string;
  tierText: string;
  /** Indexes of the highest-scoring areas. More than one when they tie. */
  leaders: number[];
}

/** The source page's arithmetic. `answers` is ten whole numbers from 1 to 5. */
export function scoreBossAssessment(answers: readonly number[]): BossAssessmentResult {
  const totals = BOSS_ASSESSMENT_AREAS.map((_, i) => answers[2 * i] + answers[2 * i + 1]);
  const sum = totals.reduce((a, b) => a + b, 0);
  const max = Math.max(...totals);
  const leaders = totals.flatMap((value, i) => (value === max ? [i] : []));
  const [tierTitle, tierText] =
    sum <= 24
      ? ["Focus on your highest blocker", "Your foundation shows some strength. Focus your energy on the blocker with the highest score."]
      : sum <= 39
        ? ["Focus on your top priorities", "Several structural gaps may be costing you time or money. Start with the highest priorities."]
        : ["Consider a structural reset", "Several areas are creating significant dependency on your daily involvement. A structured operational reset may help."];
  return { totals, sum, tierTitle, tierText, leaders };
}

const submissionSchema = z.object({
  first_name: z.string().max(200),
  email: z.string().trim().email().max(254),
  answers: z.array(z.number().int().min(1).max(5)).length(BOSS_ASSESSMENT_AREAS.length * 2),
  marketing_consent: z.boolean().optional(),
  commitment: z.string().max(MAX_COMMITMENT_CHARS).optional(),
});

/** Letters, and the punctuation names use. No digits, no slashes, no @. */
const NAME_SHAPE = /^\p{L}[\p{L}\p{M}'’.\- ]*$/u;
/** "evil.com" reads as a link in most mail clients; "J.R." does not. */
const LINK_SHAPE = /\.\p{L}{2,}/u;

export interface BossAssessmentSubmission {
  email: string;
  firstName: string;
  marketingConsent: boolean;
  result: BossAssessmentResult;
  /** The reply as stored: built here, so no client-sent score or result survives. */
  data: Record<string, unknown>;
}

/**
 * Checks a reply and rebuilds it from its ten answers. Pure, so the abuse rules
 * can be pinned by a test with no database in front of them.
 */
export function readBossAssessmentSubmission(raw: unknown): BossAssessmentSubmission | { problem: string } {
  const parsed = submissionSchema.safeParse(raw);
  if (!parsed.success) {
    const fields = parsed.error.flatten().fieldErrors;
    if (fields.email) return { problem: "Please enter a valid email address." };
    if (fields.first_name) return { problem: "Please enter your first name." };
    return { problem: "Please answer all ten statements before sending your results." };
  }

  const firstName = parsed.data.first_name.trim().replace(/\s+/g, " ");
  if (!firstName) return { problem: "Please enter your first name." };
  if (firstName.length > MAX_FIRST_NAME_CHARS || !NAME_SHAPE.test(firstName) || LINK_SHAPE.test(firstName)) {
    return { problem: "Please enter just your first name." };
  }

  const email = parsed.data.email.toLowerCase();
  const marketingConsent = parsed.data.marketing_consent === true;
  const result = scoreBossAssessment(parsed.data.answers);

  const data: Record<string, unknown> = {
    first_name: firstName,
    email,
    marketing_consent: marketingConsent,
    total: result.sum,
    tier: result.tierTitle,
    highest_blockers: result.leaders.map((i) => BOSS_ASSESSMENT_AREAS[i].title).join(", "),
    commitment: plainText(parsed.data.commitment ?? "").trim(),
  };
  BOSS_ASSESSMENT_AREAS.forEach((area, i) => {
    data[area.key] = result.totals[i];
  });
  parsed.data.answers.forEach((answer, i) => {
    data[`q${i + 1}`] = answer;
  });

  return { email, firstName, marketingConsent, result, data };
}

/**
 * The results email. Takes the name and the computed result and nothing else, so
 * nothing else a visitor sent can end up in it. The greeting uses only the first
 * word of the name, which leaves no room for a sentence.
 */
export function bossAssessmentEmail(input: {
  firstName: string;
  result: BossAssessmentResult;
  siteUrl: string;
}): { subject: string; text: string; html: string } {
  const { result } = input;
  const greeting = (input.firstName.split(" ")[0] ?? "").slice(0, MAX_GREETING_CHARS);
  const leaders = result.leaders.map((i) => BOSS_ASSESSMENT_AREAS[i]);
  const priority = leaders.map((area) => area.title).join(" + ");
  const priorityText = leaders.map((area) => area.description).join(" ");
  const nextAction = `Try this first: ${leaders.map((area) => area.action).join(" ")}`;
  const boardroomUrl = `${input.siteUrl}/boardroom`;

  const text = [
    `Hi ${greeting},`,
    ``,
    `Here are your results from the group practice self-assessment, "Are You Running Your Practice—or Is It Running You?"`,
    ``,
    `Total blocker score: ${result.sum} / 50`,
    result.tierTitle,
    result.tierText,
    ``,
    `Your five blockers`,
    ...BOSS_ASSESSMENT_AREAS.map((area, i) => `${area.title}: ${result.totals[i]}/10`),
    ``,
    `Your starting point: ${priority}`,
    priorityText,
    nextAction,
    ``,
    BOSS_ASSESSMENT_DISCLAIMER,
    ``,
    `You don't have to lead alone.`,
    BOARDROOM_COPY,
    `Explore The Boardroom: ${boardroomUrl}`,
    BOARDROOM_FINE_PRINT,
    ``,
    `To your success,`,
    `Yvette`,
  ].join("\n");

  const scoreRows = BOSS_ASSESSMENT_AREAS.map(
    (area, i) =>
      `<tr><td style="padding:6px 16px 6px 0">${escapeHtml(area.title)}</td>` +
      `<td style="padding:6px 0;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap">${result.totals[i]}/10</td></tr>`,
  ).join("");

  const html = [
    `<p>Hi ${escapeHtml(greeting)},</p>`,
    `<p>Here are your results from the group practice self-assessment, “Are You Running Your Practice—or Is It Running You?”</p>`,
    `<p>Total blocker score: <strong style="font-variant-numeric:tabular-nums">${result.sum} / 50</strong><br>`,
    `<strong>${escapeHtml(result.tierTitle)}</strong><br>`,
    `${escapeHtml(result.tierText)}</p>`,
    `<p><strong>Your five blockers</strong></p>`,
    `<table role="presentation" cellpadding="0" cellspacing="0">${scoreRows}</table>`,
    `<p><strong>Your starting point: ${escapeHtml(priority)}</strong><br>`,
    `${escapeHtml(priorityText)}</p>`,
    `<p><strong>${escapeHtml(nextAction)}</strong></p>`,
    `<p style="font-size:13px">${escapeHtml(BOSS_ASSESSMENT_DISCLAIMER)}</p>`,
    `<p><strong>You don't have to lead alone.</strong><br>${escapeHtml(BOARDROOM_COPY)}</p>`,
    `<p><a href="${escapeHtml(boardroomUrl)}">Explore The Boardroom</a><br>`,
    `<span style="font-size:13px">${escapeHtml(BOARDROOM_FINE_PRINT)}</span></p>`,
    `<p>To your success,<br>Yvette</p>`,
  ].join("\n");

  return { subject: "Your Group Practice Self-Assessment results", text, html };
}

/**
 * The opt-in box on the page is unticked by default, and this form's words make
 * it the only consent asked for. A contact starts out `subscribed`, so a new one
 * who left it unticked is moved to `never_subscribed`, which every marketing gate
 * refuses. A tick lifts `never_subscribed` and nothing else: an opt-out, a bounce
 * or a complaint stays exactly as it is, and an existing contact is never
 * unsubscribed by leaving a box empty.
 */
export async function applyBossAssessmentConsent(contactId: number, created: boolean, consented: boolean): Promise<void> {
  if (consented) {
    await pool.query(
      `UPDATE contacts SET email_marketing_status = 'subscribed', updated_at = now()
        WHERE id = $1 AND email_marketing_status = 'never_subscribed'`,
      [contactId],
    );
  } else if (created) {
    await pool.query(
      `UPDATE contacts SET email_marketing_status = 'never_subscribed', updated_at = now()
        WHERE id = $1 AND email_marketing_status = 'subscribed'`,
      [contactId],
    );
  }
}

/**
 * Sends one reply its results, and says truthfully whether it went.
 *
 * Refuses an address on the suppression list and stops at the caps above. The
 * caps count the delivery log rather than memory, so they hold across replicas
 * and restarts. A reply that hits one is still saved; the page tells the visitor
 * the email did not go, and the results are already on their screen.
 */
export async function sendBossAssessmentResults(input: {
  email: string;
  firstName: string;
  result: BossAssessmentResult;
  submissionId: number;
  contactId: number | null;
}): Promise<boolean> {
  const suppressed = await pool.query(`SELECT 1 FROM email_suppressions WHERE email = $1`, [input.email]);
  if (suppressed.rows[0]) return false;

  const sends = await pool.query<{ to_address: string; total: string }>(
    `SELECT count(*) FILTER (WHERE to_email = $1)::text AS to_address, count(*)::text AS total
       FROM email_messages
      WHERE topic = $2 AND created_at > now() - interval '24 hours'`,
    [input.email, BOSS_ASSESSMENT_EMAIL_TOPIC],
  );
  const counts = sends.rows[0];
  if (Number(counts?.to_address ?? 0) >= MAX_SENDS_PER_ADDRESS_PER_DAY) return false;
  if (Number(counts?.total ?? 0) >= MAX_SENDS_PER_DAY) {
    // eslint-disable-next-line no-console
    console.error(`[boss-assessment] the daily ceiling of ${MAX_SENDS_PER_DAY} result emails was reached`);
    return false;
  }

  const outcome = await sendMail({
    to: input.email,
    ...bossAssessmentEmail({ firstName: input.firstName, result: input.result, siteUrl: env.publicSiteUrl }),
    topic: BOSS_ASSESSMENT_EMAIL_TOPIC,
    sourceId: input.submissionId,
    contactId: input.contactId,
  });
  return outcome.sent;
}
