import crypto from "crypto";
import { z } from "zod";
import { env } from "../config/env";
import { pool } from "../db/pool";
import { sendMail } from "../email/mailer";
import { renderMarkdown, renderTokens, sendEmail } from "../email/provider";
import { PRIORITY, enqueue } from "../jobs/queue";
import { grantOfferAccess, revokeOfferAccess } from "../services/access";
import { applyTags, recordActivity, upsertContact } from "../services/contacts";
import { enrollContact, exitContact } from "../services/sequences";

/**
 * The automation engine, second edition: When → If → Then.
 *
 * Three things separate this from `automations/engine.ts`, which it supersedes
 * and which is left running until the mount is switched.
 *
 * It is about a *contact*, not an email address. The old engine created a
 * `members` row for anybody an automation touched, which is how a person who
 * downloaded a PDF ends up in the member list.
 *
 * A delay is a scheduled job, not a held promise. An action set to run three
 * days later cannot be a `setTimeout` in a web process that gets redeployed on
 * Thursday.
 *
 * And it counts its own runs. An automation that adds a tag whose own
 * automation adds the first tag back is not a hypothetical: it is the second
 * rule anybody writes, and without a per-contact ceiling it fills the queue
 * until the database is the thing that stops it.
 */

/* ----------------------------------------------------------------- triggers */

export const TRIGGER_TYPES = [
  "form_submitted",
  "offer_purchased",
  "sequence_completed",
  "tag_added",
  "tag_removed",
  "subscription_cancelled",
  "payment_failed",
  "event_registered",
  "event_attended",
  "assessment_completed",
  "assessment_passed",
  "lesson_completed",
  "course_completed",
  "community_post_created",
  "contact_created",
  "date_anniversary",
  "abandoned_checkout",
] as const;

export type TriggerV2 = (typeof TRIGGER_TYPES)[number];

export function isTriggerV2(value: string): value is TriggerV2 {
  return (TRIGGER_TYPES as readonly string[]).includes(value);
}

/**
 * How each trigger reads in a sentence, and what it can be narrowed to.
 *
 * `subjectKey` is the field in `automations.trigger_config` that pins the
 * trigger to one particular form, offer or tag; an empty key means the trigger
 * fires for everyone and cannot be narrowed. `subjectSource` tells the builder
 * which list of names to offer, so Yvette picks "the Offer Quiz" rather than
 * typing an id.
 */
export interface TriggerDescriptor {
  type: TriggerV2;
  /** Reads after the word "When". */
  label: string;
  subjectKey: string;
  subjectSource: "" | "forms" | "offers" | "sequences" | "tags" | "events" | "assessments" | "courses" | "communities" | "plans";
  subjectLabel: string;
}

export const TRIGGER_DESCRIPTORS: TriggerDescriptor[] = [
  { type: "form_submitted", label: "someone submits a form", subjectKey: "formId", subjectSource: "forms", subjectLabel: "Which form" },
  { type: "offer_purchased", label: "someone buys an offer", subjectKey: "offerId", subjectSource: "offers", subjectLabel: "Which offer" },
  { type: "sequence_completed", label: "someone finishes an email sequence", subjectKey: "sequenceId", subjectSource: "sequences", subjectLabel: "Which sequence" },
  { type: "tag_added", label: "a tag is added to someone", subjectKey: "tagId", subjectSource: "tags", subjectLabel: "Which tag" },
  { type: "tag_removed", label: "a tag is removed from someone", subjectKey: "tagId", subjectSource: "tags", subjectLabel: "Which tag" },
  { type: "subscription_cancelled", label: "someone cancels a subscription", subjectKey: "planId", subjectSource: "plans", subjectLabel: "Which plan" },
  { type: "payment_failed", label: "a payment fails", subjectKey: "", subjectSource: "", subjectLabel: "" },
  { type: "event_registered", label: "someone registers for an event", subjectKey: "eventId", subjectSource: "events", subjectLabel: "Which event" },
  { type: "event_attended", label: "someone attends an event", subjectKey: "eventId", subjectSource: "events", subjectLabel: "Which event" },
  { type: "assessment_completed", label: "someone finishes a quiz", subjectKey: "assessmentId", subjectSource: "assessments", subjectLabel: "Which quiz" },
  { type: "assessment_passed", label: "someone passes a quiz", subjectKey: "assessmentId", subjectSource: "assessments", subjectLabel: "Which quiz" },
  { type: "lesson_completed", label: "someone completes a lesson", subjectKey: "lessonId", subjectSource: "courses", subjectLabel: "Which course" },
  { type: "course_completed", label: "someone completes a course", subjectKey: "courseId", subjectSource: "courses", subjectLabel: "Which course" },
  { type: "community_post_created", label: "someone posts in the community", subjectKey: "communityId", subjectSource: "communities", subjectLabel: "Which community" },
  { type: "contact_created", label: "a new person joins your list", subjectKey: "", subjectSource: "", subjectLabel: "" },
  { type: "date_anniversary", label: "it is someone's anniversary", subjectKey: "", subjectSource: "", subjectLabel: "" },
  { type: "abandoned_checkout", label: "someone leaves without paying", subjectKey: "offerId", subjectSource: "offers", subjectLabel: "Which offer" },
];

/* ------------------------------------------------------------------ actions */

export const ACTION_TYPES = [
  "send_email",
  "subscribe_sequence",
  "unsubscribe_sequence",
  "add_tag",
  "remove_tag",
  "grant_offer",
  "revoke_offer",
  "register_event",
  "create_task",
  "fire_webhook",
  "wait",
  "branch",
] as const;

export type ActionV2 = (typeof ACTION_TYPES)[number];

export interface ActionDescriptor {
  type: ActionV2;
  /** Reads after the word "then". */
  label: string;
}

export const ACTION_DESCRIPTORS: ActionDescriptor[] = [
  { type: "send_email", label: "send them an email" },
  { type: "subscribe_sequence", label: "start them on an email sequence" },
  { type: "unsubscribe_sequence", label: "take them off an email sequence" },
  { type: "add_tag", label: "add a tag" },
  { type: "remove_tag", label: "remove a tag" },
  { type: "grant_offer", label: "give them access to an offer" },
  { type: "revoke_offer", label: "take away access to an offer" },
  { type: "register_event", label: "register them for an event" },
  { type: "create_task", label: "make a note for you to follow up" },
  { type: "fire_webhook", label: "notify another app" },
  { type: "wait", label: "wait a while" },
  { type: "branch", label: "only carry on if" },
];

/* --------------------------------------------------------------- conditions */

/**
 * A structured "only if", stored as data rather than as an expression.
 *
 * The legacy shape — a flat map of payload key to expected value — is still
 * accepted, because every automation created before this phase is stored that
 * way and silently ignoring their conditions would make each of them fire for
 * everybody.
 */
const conditionRuleSchema = z.object({
  field: z.string(),
  op: z.string(),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
});

const conditionsSchema = z.object({
  match: z.enum(["all", "any"]).default("all"),
  rules: z.array(conditionRuleSchema).default([]),
});

export type ConditionRule = z.infer<typeof conditionRuleSchema>;

export interface RunContext {
  trigger: TriggerV2;
  contactId: number | null;
  email: string;
  name: string;
  /** The id of the thing the trigger was about: the form, the offer, the tag. */
  subjectId: number | null;
  /** Everything else the trigger knew, for templating and for field conditions. */
  facts: Record<string, string | number | boolean | null>;
}

/** Evaluates one rule. Anything it does not recognise is false, never true. */
async function evaluateRule(rule: ConditionRule, context: RunContext): Promise<boolean> {
  const value = rule.value ?? "";
  const contactId = context.contactId;

  switch (rule.field) {
    case "tag": {
      if (contactId === null) return rule.op === "not_has";
      const res = await pool.query(
        `SELECT 1 FROM contact_tags WHERE contact_id = $1 AND tag_id = $2`,
        [contactId, Number(value)]
      );
      const has = (res.rowCount ?? 0) > 0;
      return rule.op === "not_has" ? !has : has;
    }

    case "customer": {
      if (contactId === null) return false;
      const res = await pool.query<{ order_count: number }>(
        `SELECT order_count FROM contacts WHERE id = $1`,
        [contactId]
      );
      const isCustomer = (res.rows[0]?.order_count ?? 0) > 0;
      return rule.op === "is_not" ? !isCustomer : isCustomer;
    }

    case "in_sequence": {
      if (contactId === null) return rule.op === "not_has";
      const res = await pool.query(
        `SELECT 1 FROM sequence_subscriptions
          WHERE contact_id = $1 AND sequence_id = $2 AND status = 'active'`,
        [contactId, Number(value)]
      );
      const inIt = (res.rowCount ?? 0) > 0;
      return rule.op === "not_has" ? !inIt : inIt;
    }

    case "owns_offer": {
      if (contactId === null) return rule.op === "not_has";
      const res = await pool.query(
        `SELECT 1 FROM access_grants g
           JOIN members m ON m.id = g.member_id
          WHERE m.contact_id = $1 AND g.offer_id = $2 AND g.status = 'active'`,
        [contactId, Number(value)]
      );
      const owns = (res.rowCount ?? 0) > 0;
      return rule.op === "not_has" ? !owns : owns;
    }

    case "lifetime_value": {
      if (contactId === null) return false;
      const res = await pool.query<{ lifetime_value_cents: number }>(
        `SELECT lifetime_value_cents FROM contacts WHERE id = $1`,
        [contactId]
      );
      const cents = res.rows[0]?.lifetime_value_cents ?? 0;
      return rule.op === "lte" ? cents <= Number(value) : cents >= Number(value);
    }

    default: {
      // Anything else is a fact the trigger carried: source, form answer, plan
      // name. String comparison, case-insensitive, because "Apply" and "apply"
      // are the same answer typed by two different screens.
      const actual = String(context.facts[rule.field] ?? "").toLowerCase();
      const expected = String(value).toLowerCase();
      if (rule.op === "is_not") return actual !== expected;
      if (rule.op === "contains") return actual.includes(expected);
      if (rule.op === "is_set") return actual !== "";
      return actual === expected;
    }
  }
}

/** Whether an automation's or an action's "only if" holds right now. */
export async function evaluateConditions(
  raw: unknown,
  context: RunContext
): Promise<boolean> {
  if (raw === null || raw === undefined || typeof raw !== "object") return true;

  const parsed = conditionsSchema.safeParse(raw);
  if (parsed.success) {
    const { match, rules } = parsed.data;
    if (rules.length === 0) return true;
    for (const rule of rules) {
      const holds = await evaluateRule(rule, context);
      if (match === "all" && !holds) return false;
      if (match === "any" && holds) return true;
    }
    return match === "all";
  }

  // Legacy flat map: {"source": "apply"}, AND-ed, ignoring empty expectations.
  for (const [field, expected] of Object.entries(raw as Record<string, unknown>)) {
    if (expected === "" || expected === null || expected === undefined) continue;
    const actual = String(context.facts[field] ?? "").toLowerCase();
    if (actual !== String(expected).toLowerCase()) return false;
  }
  return true;
}

/* ------------------------------------------------------------ action configs */

const sendEmailConfig = z.object({
  subject: z.string().default(""),
  bodyMd: z.string().default(""),
  fromName: z.string().default(""),
  fromEmail: z.string().default(""),
  topic: z.string().default("marketing"),
});

const sequenceConfig = z.object({ sequenceId: z.coerce.number().int().positive() });
const tagConfig = z.object({ tagId: z.coerce.number().int().positive() });
const offerConfig = z.object({ offerId: z.coerce.number().int().positive() });
const eventConfig = z.object({ eventId: z.coerce.number().int().positive() });
const taskConfig = z.object({
  title: z.string().default("Follow up"),
  note: z.string().default(""),
});
const webhookConfig = z.object({
  url: z.string().url(),
  secret: z.string().default(""),
});
const waitConfig = z.object({
  minutes: z.coerce.number().int().min(0).default(0),
  days: z.coerce.number().int().min(0).default(0),
});

/* ------------------------------------------------------------------- running */

interface ActionRow {
  id: number;
  action_type: string;
  config: Record<string, unknown>;
  delay_minutes: number;
  conditions: Record<string, unknown>;
  sort: number;
}

export interface RunResult {
  runId: number;
  status: "success" | "partial" | "failed" | "skipped" | "waiting";
  log: string[];
}

/** The member behind a contact, for the actions that grant or revoke access. */
async function memberIdFor(contactId: number | null): Promise<number | null> {
  if (contactId === null) return null;
  const res = await pool.query<{ id: number }>(
    `SELECT id FROM members WHERE contact_id = $1 ORDER BY id LIMIT 1`,
    [contactId]
  );
  return res.rows[0]?.id ?? null;
}

async function tagSlug(tagId: number): Promise<string | null> {
  const res = await pool.query<{ slug: string }>(`SELECT slug FROM tags WHERE id = $1`, [tagId]);
  return res.rows[0]?.slug ?? null;
}

/** How long a webhook is given before the automation gives up on it. */
const WEBHOOK_TIMEOUT_MS = 10_000;

/**
 * Performs one action and returns the line it writes in the run log.
 *
 * Every branch returns a sentence rather than throwing on a missing bit of
 * configuration: a half-configured action is a thing to see in the run log, not
 * a reason to abandon the four actions after it.
 */
async function performAction(
  action: ActionRow,
  context: RunContext,
  automationId: number,
  isTest: boolean
): Promise<{ log: string; stop: boolean }> {
  const config = action.config ?? {};
  const contactId = context.contactId;

  switch (action.action_type) {
    case "send_email": {
      const parsed = sendEmailConfig.safeParse(config);
      if (!parsed.success) return { log: "Email: not set up yet", stop: false };
      if (contactId === null || !context.email) {
        return { log: "Email: skipped, no contact to send to", stop: false };
      }

      const values = {
        firstName: context.name.split(" ")[0] || "there",
        name: context.name || context.email,
        email: context.email,
      };
      const body = renderTokens(parsed.data.bodyMd, values);

      if (isTest) return { log: `Email: would send "${parsed.data.subject}"`, stop: false };

      const result = await sendEmail({
        to: context.email,
        subject: renderTokens(parsed.data.subject, values),
        text: body,
        html: renderMarkdown(body),
        contactId,
        sourceType: "automation",
        sourceId: automationId,
        topic: parsed.data.topic,
        fromName: parsed.data.fromName,
        fromEmail: parsed.data.fromEmail,
      });
      return {
        log:
          result.outcome === "suppressed"
            ? `Email: not sent — ${result.suppressedReason}`
            : `Email sent to ${context.email}`,
        stop: false,
      };
    }

    case "subscribe_sequence": {
      const parsed = sequenceConfig.safeParse(config);
      if (!parsed.success) return { log: "Sequence: none chosen", stop: false };
      if (contactId === null) return { log: "Sequence: skipped, no contact", stop: false };
      if (isTest) return { log: "Sequence: would start them on it", stop: false };

      const result = await enrollContact(parsed.data.sequenceId, contactId, {
        reason: `automation ${automationId}`,
      });
      return { log: `Sequence: ${result.outcome.replace(/_/g, " ")}${result.reason ? ` — ${result.reason}` : ""}`, stop: false };
    }

    case "unsubscribe_sequence": {
      const parsed = sequenceConfig.safeParse(config);
      if (!parsed.success) return { log: "Sequence: none chosen", stop: false };
      if (contactId === null) return { log: "Sequence: skipped, no contact", stop: false };
      if (isTest) return { log: "Sequence: would take them off it", stop: false };

      const removed = await exitContact(parsed.data.sequenceId, contactId, {
        reason: `automation ${automationId}`,
      });
      return { log: removed ? "Taken off the sequence" : "They were not on that sequence", stop: false };
    }

    case "add_tag": {
      const parsed = tagConfig.safeParse(config);
      if (!parsed.success) return { log: "Tag: none chosen", stop: false };
      if (contactId === null) return { log: "Tag: skipped, no contact", stop: false };

      const slug = await tagSlug(parsed.data.tagId);
      if (!slug) return { log: "Tag: that tag no longer exists", stop: false };
      if (isTest) return { log: `Tag: would add "${slug}"`, stop: false };

      await applyTags(contactId, [slug], `automation:${automationId}`);
      return { log: `Tag added: ${slug}`, stop: false };
    }

    case "remove_tag": {
      const parsed = tagConfig.safeParse(config);
      if (!parsed.success) return { log: "Tag: none chosen", stop: false };
      if (contactId === null) return { log: "Tag: skipped, no contact", stop: false };
      if (isTest) return { log: "Tag: would remove it", stop: false };

      const res = await pool.query(
        `DELETE FROM contact_tags WHERE contact_id = $1 AND tag_id = $2`,
        [contactId, parsed.data.tagId]
      );
      return { log: (res.rowCount ?? 0) > 0 ? "Tag removed" : "They did not have that tag", stop: false };
    }

    case "grant_offer": {
      const parsed = offerConfig.safeParse(config);
      if (!parsed.success) return { log: "Offer: none chosen", stop: false };
      const memberId = await memberIdFor(contactId);
      if (memberId === null) {
        return { log: "Offer: skipped, they have no account yet", stop: false };
      }
      if (isTest) return { log: "Offer: would give them access", stop: false };

      const products = await grantOfferAccess({
        memberId,
        offerId: parsed.data.offerId,
        source: "automation",
      });
      return { log: `Access given to ${products.length} item(s)`, stop: false };
    }

    case "revoke_offer": {
      const parsed = offerConfig.safeParse(config);
      if (!parsed.success) return { log: "Offer: none chosen", stop: false };
      const memberId = await memberIdFor(contactId);
      if (memberId === null) return { log: "Offer: skipped, they have no account", stop: false };
      if (isTest) return { log: "Offer: would take access away", stop: false };

      const revoked = await revokeOfferAccess({
        memberId,
        offerId: parsed.data.offerId,
        reason: `automation ${automationId}`,
      });
      return { log: `Access removed from ${revoked} item(s)`, stop: false };
    }

    case "register_event": {
      const parsed = eventConfig.safeParse(config);
      if (!parsed.success) return { log: "Event: none chosen", stop: false };
      if (contactId === null || !context.email) {
        return { log: "Event: skipped, no contact", stop: false };
      }
      if (isTest) return { log: "Event: would register them", stop: false };

      const eventRes = await pool.query<{
        starts_at: Date | null;
        evergreen_interval_minutes: number | null;
      }>(`SELECT starts_at, evergreen_interval_minutes FROM events WHERE id = $1`, [
        parsed.data.eventId,
      ]);
      const event = eventRes.rows[0];
      if (!event) return { log: "Event: that event no longer exists", stop: false };

      // An evergreen event has no fixed start; the registrant's own session
      // begins at the next interval boundary after they registered.
      const sessionAt =
        event.starts_at ??
        new Date(Date.now() + (event.evergreen_interval_minutes ?? 15) * 60_000);

      await pool.query(
        `INSERT INTO event_registrations (event_id, contact_id, email, name, session_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (event_id, email) DO NOTHING`,
        [parsed.data.eventId, contactId, context.email, context.name, sessionAt]
      );
      return { log: "Registered for the event", stop: false };
    }

    case "create_task": {
      const parsed = taskConfig.safeParse(config);
      const title = parsed.success ? parsed.data.title : "Follow up";
      const note = parsed.success ? parsed.data.note : "";
      if (isTest) return { log: `Note: would remind you to "${title}"`, stop: false };

      // There is no task table on this platform, so the follow-up lands in the
      // two places somebody will actually see it: the contact's own timeline,
      // and Yvette's inbox.
      if (contactId !== null) {
        await recordActivity({
          contactId,
          kind: "task",
          title,
          body: note,
          subjectType: "automation",
          subjectId: String(automationId),
        });
      }
      if (env.notifyEmail) {
        await sendMail({
          to: env.notifyEmail,
          subject: `Follow up: ${title}`,
          text: [`${title}`, ``, note, ``, `About: ${context.email || "someone"}`].join("\n"),
        });
      }
      return { log: `Follow-up noted: ${title}`, stop: false };
    }

    case "fire_webhook": {
      const parsed = webhookConfig.safeParse(config);
      if (!parsed.success) return { log: "Notify: no web address set", stop: false };
      if (isTest) return { log: `Notify: would call ${parsed.data.url}`, stop: false };

      const body = JSON.stringify({
        trigger: context.trigger,
        contactId: context.contactId,
        email: context.email,
        name: context.name,
        facts: context.facts,
        automationId,
        firedAt: new Date().toISOString(),
      });
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (parsed.data.secret) {
        headers["X-Bossclinician-Signature"] = `sha256=${crypto
          .createHmac("sha256", parsed.data.secret)
          .update(body)
          .digest("hex")}`;
      }

      const response = await fetch(parsed.data.url, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      });
      return { log: `Notified ${parsed.data.url} (${response.status})`, stop: false };
    }

    case "branch": {
      const holds = await evaluateConditions(config.conditions ?? {}, context);
      return {
        log: holds ? "Condition held — carrying on" : "Condition did not hold — stopped here",
        stop: !holds,
      };
    }

    case "wait":
      // Handled before this function is reached: a wait is a scheduled
      // resumption, not something to perform.
      return { log: "Waiting", stop: true };

    default:
      return { log: `${action.action_type}: not something this platform can do`, stop: false };
  }
}

async function appendLog(runId: number, lines: string[]): Promise<void> {
  await pool.query(
    `UPDATE automation_runs SET log = COALESCE(log, '[]'::jsonb) || $2::jsonb WHERE id = $1`,
    [runId, JSON.stringify(lines)]
  );
}

/**
 * Writes one line to the run log as it happens, and keeps the in-memory copy.
 *
 * Batched at the end is what it used to be, and the batch was lost whenever the
 * job died between the last action and the write — so a run that had actually
 * sent an email showed an empty log. Logging must never be the thing that fails
 * a job either, so a write that throws is swallowed: the line is a record of
 * work that has already happened, not the work itself.
 */
async function noteLog(runId: number, lines: string[], line: string): Promise<void> {
  lines.push(line);
  try {
    await appendLog(runId, [line]);
  } catch {
    // Deliberately ignored — see above.
  }
}

/**
 * Takes the one and only permit to perform this action for this run.
 *
 * The reason this exists is the resume job. A delayed `send_email` runs inside a
 * job whose payload is fixed at the moment the delay was scheduled, so anything
 * that fails the job *after* the provider has accepted the message — a database
 * blip on the next statement, a SIGKILL, a lease that lapsed while the send was
 * in flight — puts the identical job back on the queue with `delayServed` still
 * true. It then walks the same action again and emails the same person a second
 * time, up to `maxAttempts` times. There is no un-sending a mailshot, so the
 * guard cannot be "make the job not fail"; it has to be a mark that outlives the
 * job and is taken before the send, not after it.
 *
 * `UPDATE … WHERE NOT (marker @> id) RETURNING` is one statement, so the row
 * lock makes it a real claim: two workers racing on the same run leave exactly
 * one with a row returned. The mark lives in `automation_runs.trigger_payload`
 * under a reserved key because that column is written once and read nowhere —
 * no screen shows it and no query filters on it — which makes it the one place
 * a marker can go in this pass without a schema change. A dedicated
 * `automation_action_receipts` table is the better home and is noted in
 * docs/bugs/backend-growth.md as the follow-up.
 *
 * The trade this makes is deliberate: a crash in the window between claiming and
 * sending loses that one email. At-most-once is the right side to fail on for a
 * marketing send.
 */
const CLAIM_KEY = "_performedActionIds";

async function claimAction(runId: number, actionId: number): Promise<boolean> {
  const res = await pool.query(
    `UPDATE automation_runs
        SET trigger_payload = jsonb_set(
              COALESCE(trigger_payload, '{}'::jsonb),
              $3::text[],
              COALESCE(trigger_payload -> $2::text, '[]'::jsonb) || to_jsonb($4::int)
            )
      WHERE id = $1
        AND NOT (COALESCE(trigger_payload -> $2::text, '[]'::jsonb) @> to_jsonb($4::int))
      RETURNING id`,
    [runId, CLAIM_KEY, [CLAIM_KEY], actionId]
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * The dedupe key a resumption is queued under.
 *
 * The `delayServed` half is load-bearing, and its absence is what stopped a
 * whole shape of automation dead. A `wait` step resumes at the *next* action and
 * queues itself as `…:<i+1>:step`; if the action at `i + 1` carries a
 * `delay_minutes` of its own — which the builder allows on every step type — the
 * job that resumes at `i + 1` has to queue a second resumption for that same
 * index. Under the old key that second enqueue collided with the key the running
 * job was still holding, `enqueue` answered "already going to happen", and the
 * run parked on `waiting` for good: no error, nothing in the dead-letter list,
 * the email simply never sent. The two resumptions are different pieces of work —
 * "arrive at step i+1" and "step i+1's own delay has now been served" — so they
 * are keyed differently, while a genuine duplicate of either still collapses.
 */
export function resumeDedupeKey(
  runId: number,
  resumeIndex: number,
  delayServed: boolean
): string {
  return `automation-resume:${runId}:${resumeIndex}:${delayServed ? "action" : "step"}`;
}

export interface RunAutomationInput {
  automationId: number;
  context: RunContext;
  /** Set when resuming a run that was waiting on a delay. */
  runId?: number;
  fromIndex?: number;
  /**
   * True when the delay on the action at `fromIndex` has already been served.
   *
   * Without it a resumption lands back on the same action, reads its
   * `delay_minutes` again and tries to schedule the same wait a second time —
   * and because the resume job is still running with that dedupe key, the
   * enqueue collapses into nothing and the run sits at `waiting` forever with
   * the action never performed.
   */
  delayServed?: boolean;
  isTest?: boolean;
}

/**
 * Runs one automation's actions from `fromIndex` onwards.
 *
 * Splitting on index rather than on a continuation closure is what lets a
 * three-day wait survive a deploy: the resumption is a row in the jobs table
 * naming an automation, a run and a position, and any worker can pick it up.
 */
export async function runAutomation(input: RunAutomationInput): Promise<RunResult> {
  const { automationId, context } = input;
  const isTest = input.isTest ?? false;
  const fromIndex = input.fromIndex ?? 0;

  let runId = input.runId ?? 0;
  if (!runId) {
    const created = await pool.query<{ id: number }>(
      `INSERT INTO automation_runs
         (automation_id, status, subject_email, log, contact_id, trigger_payload, is_test)
       VALUES ($1, 'running', $2, '[]'::jsonb, $3, $4, $5)
       RETURNING id`,
      [
        automationId,
        context.email,
        context.contactId,
        JSON.stringify({ trigger: context.trigger, subjectId: context.subjectId, ...context.facts }),
        isTest,
      ]
    );
    runId = created.rows[0].id;
  }

  const actionsRes = await pool.query<ActionRow>(
    `SELECT id, action_type, config, delay_minutes, conditions, sort
       FROM automation_actions WHERE automation_id = $1 ORDER BY sort, id`,
    [automationId]
  );
  const actions = actionsRes.rows;

  const log: string[] = [];
  let failures = 0;
  let attempted = 0;

  for (let index = fromIndex; index < actions.length; index += 1) {
    const action = actions[index];

    // A delay is honoured before the action's own condition is evaluated: the
    // point of "wait three days then check they still have not bought" is that
    // the check happens in three days, not now.
    const waitMinutes =
      action.action_type === "wait"
        ? (() => {
            const parsed = waitConfig.safeParse(action.config ?? {});
            return parsed.success ? parsed.data.minutes + parsed.data.days * 1440 : 0;
          })()
        : action.delay_minutes;

    // A `wait` resumes at the *next* action, so its delay is behind it either
    // way. A per-action delay resumes at the same index, and only the flag the
    // resumption carries can tell "three days have passed" from "three days
    // have yet to pass".
    const delayAlreadyServed = index === fromIndex && (input.delayServed ?? false);

    if (waitMinutes > 0 && !isTest && !delayAlreadyServed) {
      const resumeIndex = action.action_type === "wait" ? index + 1 : index;
      const resumeDelayServed = action.action_type !== "wait";
      await enqueue({
        kind: "automation.runAction",
        payload: {
          automationId,
          runId,
          fromIndex: resumeIndex,
          delayServed: resumeDelayServed,
          context: { ...context },
        },
        priority: PRIORITY.normal,
        runAt: new Date(Date.now() + waitMinutes * 60_000),
        dedupeKey: resumeDedupeKey(runId, resumeIndex, resumeDelayServed),
      });
      await noteLog(runId, log, `Waiting ${waitMinutes} minute(s) before carrying on`);
      await pool.query(`UPDATE automation_runs SET status = 'waiting' WHERE id = $1`, [runId]);
      return { runId, status: "waiting", log };
    }

    if (action.action_type === "wait") {
      await noteLog(runId, log, "No wait set — carrying straight on");
      continue;
    }

    attempted += 1;
    try {
      // Inside the try, because a condition is read from the database: a blip
      // evaluating one used to fail the whole job — and, on a resumed run, put
      // it back on the queue to re-perform actions it had already performed.
      const conditionsHold = await evaluateConditions(action.conditions ?? {}, context);
      if (!conditionsHold) {
        attempted -= 1;
        await noteLog(runId, log, `Skipped one step — its condition no longer held`);
        continue;
      }

      // The claim is taken before the action runs and is never released. See
      // `claimAction`: a resumed job that fails after a send would otherwise
      // email the same person again on every retry.
      if (!isTest && !(await claimAction(runId, action.id))) {
        attempted -= 1;
        continue;
      }

      const outcome = await performAction(action, context, automationId, isTest);
      await noteLog(runId, log, outcome.log);
      if (outcome.stop) break;
    } catch (err) {
      failures += 1;
      await noteLog(
        runId,
        log,
        `Something went wrong: ${(err as Error).message}`.slice(0, 300)
      );
    }
  }

  const status: RunResult["status"] =
    failures === 0 ? "success" : attempted > 0 && failures === attempted ? "failed" : "partial";

  await pool.query(`UPDATE automation_runs SET status = $2 WHERE id = $1`, [runId, status]);

  if (!isTest) {
    await pool.query(
      `UPDATE automations
          SET run_count = run_count + 1, last_run_at = now(),
              last_error = CASE WHEN $2 = 'success' THEN '' ELSE $3 END
        WHERE id = $1`,
      [automationId, status, log.join(" | ").slice(0, 500)]
    );
  }

  return { runId, status, log };
}

/* ---------------------------------------------------------- the loop guard */

/**
 * Whether this automation has already run for this contact too many times today.
 *
 * Skipped runs are excluded from the count on purpose. Counting them would mean
 * that once the ceiling is hit it can never be un-hit, because the skip records
 * themselves keep the total above the line for the next twenty-four hours.
 */
async function overRunLimit(
  automationId: number,
  contactId: number,
  limit: number
): Promise<boolean> {
  if (limit <= 0) return false;
  const res = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM automation_runs
      WHERE automation_id = $1 AND contact_id = $2
        AND status <> 'skipped'
        AND created_at > now() - interval '24 hours'`,
    [automationId, contactId]
  );
  return Number(res.rows[0]?.count ?? 0) >= limit;
}

async function recordSkip(
  automationId: number,
  context: RunContext,
  reason: string
): Promise<void> {
  await pool.query(
    `INSERT INTO automation_runs
       (automation_id, status, subject_email, log, contact_id, trigger_payload)
     VALUES ($1, 'skipped', $2, $3::jsonb, $4, $5)`,
    [
      automationId,
      context.email,
      JSON.stringify([reason]),
      context.contactId,
      JSON.stringify({ trigger: context.trigger, subjectId: context.subjectId }),
    ]
  );
}

/* ------------------------------------------------------------------ firing */

export interface TriggerInput {
  contactId?: number | null;
  email?: string;
  name?: string;
  /** The form, offer, tag or event the trigger is about. */
  subjectId?: number | null;
  facts?: Record<string, string | number | boolean | null>;
  source?: string;
}

const SUBJECT_KEY: Record<TriggerV2, string> = TRIGGER_DESCRIPTORS.reduce(
  (map, descriptor) => {
    map[descriptor.type] = descriptor.subjectKey;
    return map;
  },
  {} as Record<TriggerV2, string>
);

/**
 * Runs every active automation bound to `trigger`.
 *
 * Never throws. The triggering request — a form submission, a payment — has
 * already succeeded by the time this is called, and an automation failing must
 * not turn a saved lead into a 500.
 */
export async function fireTrigger(trigger: TriggerV2, input: TriggerInput): Promise<void> {
  try {
    let contactId = input.contactId ?? null;
    const email = (input.email ?? "").trim().toLowerCase();

    if (contactId === null && email) {
      contactId = await upsertContact({
        email,
        name: input.name,
        source: input.source ?? `automation:${trigger}`,
      });
    }

    const context: RunContext = {
      trigger,
      contactId,
      email,
      name: input.name ?? "",
      subjectId: input.subjectId ?? null,
      facts: { ...(input.facts ?? {}), email, name: input.name ?? "" },
    };

    const automationsRes = await pool.query<{
      id: number;
      conditions: Record<string, unknown>;
      trigger_config: Record<string, unknown>;
      max_runs_per_contact_per_day: number;
    }>(
      `SELECT id, conditions, trigger_config, max_runs_per_contact_per_day
         FROM automations WHERE trigger_type = $1 AND status = 'active'`,
      [trigger]
    );

    for (const automation of automationsRes.rows) {
      const subjectKey = SUBJECT_KEY[trigger];
      if (subjectKey) {
        const wanted = automation.trigger_config?.[subjectKey];
        // An empty narrowing means "any of them"; a set one has to match, and a
        // trigger that arrived without a subject cannot match a narrowed rule.
        if (wanted !== undefined && wanted !== null && wanted !== "" && wanted !== 0) {
          if (context.subjectId === null || Number(wanted) !== context.subjectId) continue;
        }
      }

      if (!(await evaluateConditions(automation.conditions ?? {}, context))) {
        await recordSkip(automation.id, context, "The conditions were not met");
        continue;
      }

      if (
        context.contactId !== null &&
        (await overRunLimit(
          automation.id,
          context.contactId,
          automation.max_runs_per_contact_per_day
        ))
      ) {
        await recordSkip(
          automation.id,
          context,
          "Already run for this person the maximum number of times today"
        );
        continue;
      }

      await runAutomation({ automationId: automation.id, context });
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[automations/v2] ${trigger} failed:`, (err as Error).message);
  }
}

/** Makes the fire-and-forget intent explicit at call sites. */
export function fireTriggerAsync(trigger: TriggerV2, input: TriggerInput): void {
  void fireTrigger(trigger, input);
}
