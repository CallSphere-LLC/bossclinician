import { z } from "zod";
import { env } from "../config/env";
import { pool } from "../db/pool";
import { sendMail } from "../email/mailer";
import { escapeHtml } from "../email/templates";
import { brandEmailHtml } from "../email/brandShell";
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

const NL = String.fromCharCode(10);
export const BOSS_ASSESSMENT_FORM_SLUG = "boss-assessment";

/** What the delivery log calls this email, and what the send caps below count. */
export const BOSS_ASSESSMENT_EMAIL_TOPIC = "boss_assessment_result";

/** Enough for a retake or two. A stranger cannot use this to flood one inbox. */
const MAX_SENDS_PER_ADDRESS_PER_DAY = 3;

/** Far above real traffic. A spread of addresses cannot burn the sending domain. */
const MAX_SENDS_PER_DAY = 500;

const MAX_FIRST_NAME_CHARS = 40;
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

/**
 * The A0 result blocks (Group Practice Assessment Email Sequence doc), one per
 * area key. Every highest-scoring area gets its block, ties included.
 */
const RESULT_BLOCKS: Record<string, readonly string[]> = {
  leadership_dependency: [
    "You may be the person everyone checks with, even when the decision could reasonably be handled by someone else.",
    "Start with one question that keeps coming back to you. Write down who should own it, what they can decide, and when they need to involve you. Then discuss it with that person.",
    "The aim is to help your team move forward with clear boundaries, so an ordinary decision doesn’t have to wait until your next break between sessions.",
  ],
  broken_pay_structure: [
    "This label points to questions about owner pay; it doesn’t prove that your compensation model is broken.",
    "Pull together what the practice collected, what went to payroll and overhead, and what you paid yourself. Review those numbers alongside your tax planning and cash needs with your financial professional.",
    "Start by seeing what’s happening. That gives you a clearer basis for decisions than hoping the next busy month will feel different.",
  ],
  missing_systems: [
    "Some of the practice may still run on information only you know.",
    "Choose one recurring process, such as intake, billing, or onboarding, and capture its steps, responsible person, and what to do when something goes off track.",
    "Have the person using it walk through it with you. The goal is a process someone can actually follow, so you’re not explaining it from the beginning every time.",
  ],
  team_misalignment: [
    "Your answers suggest it may be useful to revisit expectations with your team. That doesn’t mean your clinicians don’t care.",
    "Pick one place where expectations feel unclear. Ask what the team understands, where they’re getting stuck, and what support is missing. Then agree on the responsibility and how you’ll follow up.",
    "A specific conversation gives you more to work with than wondering why people aren’t doing what you thought was understood.",
  ],
  no_exit_strategy: [
    "In this assessment, “exit” includes being able to step away temporarily. It doesn’t mean you need to sell or close your practice.",
    "Imagine you were unavailable for a week. Which routine tasks would stop or come back to you?",
    "Choose one and outline the owner, backup, and escalation plan. That gives you a practical starting point for time away that doesn’t depend on checking your phone all day.",
  ],
};

export const BOSS_ASSESSMENT_EMAIL_SUBJECT = "Your practice assessment results + where to start";
export const BOSS_ASSESSMENT_EMAIL_PREVIEW = "One area to look at first, without adding five projects to your week.";

const CLOSING_LINES = [
  "You don’t need to turn these results into five new projects. If more than one area tied, choose one recurring situation to start with.",
  "This is a snapshot of your answers, not a diagnosis or a review of your finances. A highest score is relative to your other scores; it doesn’t automatically mean something is seriously wrong.",
  "What’s one thing you’d like to stop carrying by yourself? Hit reply and tell me.",
];

/**
 * True only for a result that is whole: five area scores of 2 to 10, a total
 * that adds up, and highest areas that really are the highest. Anything else is
 * held rather than mailed with invented or missing numbers.
 */
export function isCompleteBossAssessmentResult(result: BossAssessmentResult | null | undefined): result is BossAssessmentResult {
  if (!result || !Array.isArray(result.totals) || !Array.isArray(result.leaders)) return false;
  if (result.totals.length !== BOSS_ASSESSMENT_AREAS.length) return false;
  if (!result.totals.every((t) => Number.isInteger(t) && t >= 2 && t <= 10)) return false;
  if (result.sum !== result.totals.reduce((a, b) => a + b, 0)) return false;
  const max = Math.max(...result.totals);
  const expected = result.totals.flatMap((t, i) => (t === max ? [i] : []));
  return expected.length === result.leaders.length && expected.every((i, n) => result.leaders[n] === i);
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

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
  practice_stage: z.enum(["not_launched", "first_hire", "existing_team"]).optional(),
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
    ...(parsed.data.practice_stage ? { practice_stage: parsed.data.practice_stage } : {}),
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
 * The results email (A0 in the Group Practice Assessment Email Sequence doc).
 * Takes the computed result and nothing else, so nothing a visitor typed can end
 * up in it; the greeting is the doc's "Hey!", not the name. Returns null for an
 * incomplete result, which is then held rather than sent. No promotional buttons or links.
 */
export function bossAssessmentEmail(input: {
  firstName: string;
  result: BossAssessmentResult;
  siteUrl: string;
}): { subject: string; preheader: string; text: string; html: string } | null {
  const { result } = input;
  if (!isCompleteBossAssessmentResult(result)) return null;
  const leaders = result.leaders.map((i) => BOSS_ASSESSMENT_AREAS[i]);
  const highest = joinNames(leaders.map((area) => area.title));
  const intro = `Here are your results from “Are You Running Your Practice, or Is It Running You?”`;
  const explain = `Higher scores mean you reported these situations more often. Your highest-scoring area or areas: ${highest}.`;
  const blocks = leaders.map((area) => RESULT_BLOCKS[area.key] ?? []);

  const text = [
    `Hey!`,
    ``,
    intro,
    ``,
    `Your total score: ${result.sum} / 50`,
    ``,
    ...BOSS_ASSESSMENT_AREAS.map((area, i) => `${area.title}: ${result.totals[i]} / 10`),
    ``,
    explain,
    ``,
    ...blocks.flatMap((block) => block.flatMap((line) => [line, ``])),
    ...CLOSING_LINES.flatMap((line) => [line, ``]),
    `Yvette`,
  ].join(NL);

  const scoreRows = BOSS_ASSESSMENT_AREAS.map(
    (area, i) =>
      `<tr><th scope="row" style="padding:12px 16px;text-align:left;font-weight:400;border-bottom:1px solid #e9e2d8">${escapeHtml(area.title)}</th>` +
      `<td style="padding:12px 16px;text-align:right;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap;border-bottom:1px solid #e9e2d8">${result.totals[i]} / 10</td></tr>`,
  ).join("");

  const html = [
    `<p>Hey!</p>`,
    `<p>${escapeHtml(intro)}</p>`,
    `<p>Your total score: <strong style="font-variant-numeric:tabular-nums">${result.sum} / 50</strong></p>`,
    `<table aria-label="Assessment area scores" width="100%" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 24px;border-collapse:collapse;background-color:#f6f2ec;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1e1828">${scoreRows}</table>`,
    `<p>${escapeHtml(explain)}</p>`,
    ...blocks.flatMap((block) => block.map((line) => `<p>${escapeHtml(line)}</p>`)),
    ...CLOSING_LINES.map((line) => `<p>${escapeHtml(line)}</p>`),
    `<p>Yvette</p>`,
  ].join(NL);

  return {
    subject: BOSS_ASSESSMENT_EMAIL_SUBJECT,
    preheader: BOSS_ASSESSMENT_EMAIL_PREVIEW,
    text,
    html: brandEmailHtml({
      html, text, subject: BOSS_ASSESSMENT_EMAIL_SUBJECT,
      preheader: BOSS_ASSESSMENT_EMAIL_PREVIEW,
      siteUrl: input.siteUrl,
      tableIsContent: true,
      receiptReason: "You requested your practice assessment results from",
    }),
  };
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

  const email = bossAssessmentEmail({ firstName: input.firstName, result: input.result, siteUrl: env.publicSiteUrl });
  if (!email) {
    // Held, not sent: never mail missing or invented scores.
    // eslint-disable-next-line no-console
    console.error(`[boss-assessment] result email held for submission ${input.submissionId}: incomplete result data`);
    return false;
  }

  const outcome = await sendMail({
    to: input.email,
    ...email,
    topic: BOSS_ASSESSMENT_EMAIL_TOPIC,
    sourceId: input.submissionId,
    contactId: input.contactId,
  });
  return outcome.sent;
}
