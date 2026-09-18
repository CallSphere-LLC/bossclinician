import crypto from "crypto";
import { z } from "zod";
import { env } from "../config/env";
import { pool } from "../db/pool";
import { sendMail } from "../email/mailer";
import { renderMarkdown, renderTokens, sendEmail } from "../email/provider";
import { PRIORITY, enqueue } from "../jobs/queue";
import { grantOfferAccess, revokeOfferAccess } from "../services/access";
import { applyTags, recordActivity, removeTags, upsertContact } from "../services/contacts";
import { enrollContact, exitContact } from "../services/sequences";
import { notificationRecipients } from "../services/notificationRecipients";

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
  "sequence_subscribed",
  "sequence_unsubscribed",
  "tag_added",
  "tag_removed",
  "subscription_cancelled",
  "subscription_cancel_requested",
  "payment_plan_completed",
  "payment_failed",
  "event_registered",
  "event_attended",
  "assessment_completed",
  "assessment_passed",
  "lesson_completed",
  "course_completed",
  "certificate_earned",
  "coaching_session_booked",
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
  // Joining and leaving, as distinct from finishing: "left" is a run cut short —
  // taken off by hand, by an automation, by an exit tag, or by buying the thing
  // the sequence was selling — and never fires for somebody who reached the end.
  { type: "sequence_subscribed", label: "someone is added to an email sequence", subjectKey: "sequenceId", subjectSource: "sequences", subjectLabel: "Which sequence" },
  { type: "sequence_unsubscribed", label: "someone leaves an email sequence early", subjectKey: "sequenceId", subjectSource: "sequences", subjectLabel: "Which sequence" },
  { type: "tag_added", label: "a tag is added to someone", subjectKey: "tagId", subjectSource: "tags", subjectLabel: "Which tag" },
  { type: "tag_removed", label: "a tag is removed from someone", subjectKey: "tagId", subjectSource: "tags", subjectLabel: "Which tag" },
  { type: "subscription_cancelled", label: "someone's subscription actually ends", subjectKey: "planId", subjectSource: "plans", subjectLabel: "Which plan" },
  // "Asked to cancel" and "has now gone" are weeks apart on a period-end
  // cancellation, and they want opposite emails: a win-back offer while she can
  // still keep them, and a goodbye once she cannot.
  { type: "subscription_cancel_requested", label: "someone asks to cancel a subscription", subjectKey: "planId", subjectSource: "plans", subjectLabel: "Which plan" },
  { type: "payment_plan_completed", label: "someone finishes paying off a payment plan", subjectKey: "offerId", subjectSource: "offers", subjectLabel: "Which offer" },
  { type: "payment_failed", label: "a payment fails", subjectKey: "", subjectSource: "", subjectLabel: "" },
  { type: "event_registered", label: "someone registers for an event", subjectKey: "eventId", subjectSource: "events", subjectLabel: "Which event" },
  { type: "event_attended", label: "someone attends an event", subjectKey: "eventId", subjectSource: "events", subjectLabel: "Which event" },
  { type: "assessment_completed", label: "someone finishes a quiz", subjectKey: "assessmentId", subjectSource: "assessments", subjectLabel: "Which quiz" },
  { type: "assessment_passed", label: "someone passes a quiz", subjectKey: "assessmentId", subjectSource: "assessments", subjectLabel: "Which quiz" },
  { type: "lesson_completed", label: "someone completes a lesson", subjectKey: "courseId", subjectSource: "courses", subjectLabel: "Which course" },
  { type: "course_completed", label: "someone completes a course", subjectKey: "courseId", subjectSource: "courses", subjectLabel: "Which course" },
  // Finishing a course and earning its certificate are not the same moment: a
  // course with no certificate template never reaches the second, and a member
  // whose access was clawed back completes without earning.
  { type: "certificate_earned", label: "someone earns a certificate", subjectKey: "courseId", subjectSource: "courses", subjectLabel: "Which course" },
  { type: "coaching_session_booked", label: "someone books a coaching session", subjectKey: "", subjectSource: "", subjectLabel: "" },
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
 *
 * Exported so the save endpoint can hold conditions to the shape the engine
 * reads them in: a `rules` key holding anything else parsed here as "no rules",
 * and the automation ran for everybody.
 */
const conditionRuleSchema = z.object({
  field: z.string(),
  op: z.string(),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
});

export const conditionsSchema = z.object({
  match: z.enum(["all", "any"]).default("all"),
  rules: z.array(conditionRuleSchema).default([]),
});

export type ConditionRule = z.infer<typeof conditionRuleSchema>;

/**
 * Condition fields that mean nothing until she picks the thing to check.
 *
 * "they already have the tag —" is not a narrower rule than no rule at all; it
 * is a rule about tag id 0. Whether that reads as always-false or always-true
 * depends on the operator, which is why a half-built rule cannot be left to
 * evaluate: one of the two operators quietly opens the automation to everybody.
 */
const CONDITION_SUBJECT_FIELDS = new Set(["tag", "in_sequence", "owns_offer", "lifetime_value"]);

function ruleIsComplete(rule: ConditionRule): boolean {
  if (!rule.field.trim() || !rule.op.trim()) return false;
  // "is set" is the one operator that asks about presence rather than a value.
  if (rule.op === "is_set") return true;
  if (rule.value === null || rule.value === undefined || rule.value === "") return false;
  if (CONDITION_SUBJECT_FIELDS.has(rule.field)) return Number(rule.value) > 0;
  return true;
}

/**
 * `null` when an "only if" is safe to act on, otherwise why it is not.
 *
 * A shape this cannot read at all is reported too: the legacy flat map is
 * handled by `evaluateConditions` and stays acceptable here, but a `rules` key
 * holding something that is not a list of rules would be silently ignored and
 * the automation would run for everybody.
 */
export function describeConditionProblem(raw: unknown): string | null {
  if (raw === null || raw === undefined || typeof raw !== "object") return null;

  const parsed = conditionsSchema.safeParse(raw);
  if (!parsed.success) return "one of the conditions is not something the builder can read";

  const incomplete = parsed.data.rules.filter((rule) => !ruleIsComplete(rule)).length;
  if (incomplete === 0) return null;
  return incomplete === 1
    ? "one condition has nothing chosen to check against"
    : `${incomplete} conditions have nothing chosen to check against`;
}

export interface RunContext {
  trigger: TriggerV2;
  contactId: number | null;
  email: string;
  name: string;
  /** The id of the thing the trigger was about: the form, the offer, the tag. */
  subjectId: number | null;
  /** Everything else the trigger knew, for templating and for field conditions. */
  facts: Record<string, string | number | boolean | null>;
  /** Durable occurrence id. Present for real domain events, absent for practice runs. */
  eventKey?: string;
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

/**
 * What each kind of step must have before it can do the thing it says.
 *
 * These are the only description of a complete step, and every gate reads them:
 * the save endpoint, the turn-it-on check, the dry run and the runner itself.
 * They used to be read only by the runner, and only to decide which sentence to
 * write in the log — which is how "add a tag" with no tag chosen saved, went
 * active, and reported RAN FINE.
 *
 * Nothing here has a forgiving default for the field that *is* the step. A
 * default subject or a default title turns "she has not filled this in yet"
 * into a valid step that sends a blank email.
 */
const sendEmailConfig = z.object({
  subject: z.string().trim().min(1),
  bodyMd: z.string().trim().min(1),
  fromName: z.string().default(""),
  fromEmail: z.string().default(""),
  topic: z.string().default("marketing"),
});

const sequenceConfig = z.object({ sequenceId: z.coerce.number().int().positive() });
const tagConfig = z.object({ tagId: z.coerce.number().int().positive() });
const offerConfig = z.object({ offerId: z.coerce.number().int().positive() });
const eventConfig = z.object({ eventId: z.coerce.number().int().positive() });
const taskConfig = z.object({
  title: z.string().trim().min(1),
  note: z.string().default(""),
});
const webhookConfig = z.object({
  url: z.string().url(),
  secret: z.string().default(""),
});
const waitConfig = z
  .object({
    minutes: z.coerce.number().int().min(0).default(0),
    days: z.coerce.number().int().min(0).default(0),
  })
  // A wait of no time is not a wait. Left valid, it reads as "wait a while" on
  // the screen and carries straight on at run time, which is the one difference
  // she cannot see in the sentence.
  .refine((value) => value.minutes + value.days > 0);

/**
 * A branch is only a gate if it has something to check.
 *
 * An empty one held nothing back and logged "Condition held — carrying on",
 * so a step added to stop the run let everybody through instead.
 */
const branchConfig = z.object({
  conditions: conditionsSchema.refine(
    (value) => value.rules.length > 0 && value.rules.every(ruleIsComplete)
  ),
});

/** Every action type's requirements, keyed the way the rows are stored. */
export const ACTION_CONFIG_SCHEMAS: Record<ActionV2, z.ZodTypeAny> = {
  send_email: sendEmailConfig,
  subscribe_sequence: sequenceConfig,
  unsubscribe_sequence: sequenceConfig,
  add_tag: tagConfig,
  remove_tag: tagConfig,
  grant_offer: offerConfig,
  revoke_offer: offerConfig,
  register_event: eventConfig,
  create_task: taskConfig,
  fire_webhook: webhookConfig,
  wait: waitConfig,
  branch: branchConfig,
};

/**
 * What is missing, in her words, ready to be read after "this step".
 *
 * The reason for a hand-written line per type rather than zod's own message is
 * that these are shown on the builder and written into the run log; "Required
 * at config.tagId" is not something the owner of the business can act on.
 */
const ACTION_CONFIG_PROBLEM: Record<ActionV2, string> = {
  send_email: "needs both a subject and something to say",
  subscribe_sequence: "has no sequence chosen",
  unsubscribe_sequence: "has no sequence chosen",
  add_tag: "has no tag chosen",
  remove_tag: "has no tag chosen",
  grant_offer: "has no offer chosen",
  revoke_offer: "has no offer chosen",
  register_event: "has no event chosen",
  create_task: "has nothing to remind you about",
  fire_webhook: "has no web address to notify",
  wait: "waits no time at all",
  branch: "has nothing to check",
};

const UNKNOWN_ACTION_PROBLEM = "is a kind of step this platform cannot do";

/**
 * `null` when a step is ready to run, otherwise why it is not.
 *
 * Shared deliberately: the API, the activation check and the runner have to
 * agree about what "configured" means, or a step refused by one is reported as
 * fine by another.
 */
export function describeActionProblem(actionType: string, config: unknown): string | null {
  const schema = ACTION_CONFIG_SCHEMAS[actionType as ActionV2];
  if (!schema) return UNKNOWN_ACTION_PROBLEM;
  return schema.safeParse(config ?? {}).success
    ? null
    : ACTION_CONFIG_PROBLEM[actionType as ActionV2];
}

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

interface ActionOutcome {
  log: string;
  stop: boolean;
  /**
   * The step could not do its job because it was never finished.
   *
   * Separate from a thrown error on purpose: the run carries on, but the run
   * cannot be called a success. Reporting these as ordinary outcomes is what let
   * an automation whose only step did nothing show up as RAN FINE.
   */
  misconfigured?: boolean;
  /** A configured step could not act on this particular person. */
  blocked?: boolean;
}

/** The outcome for a step that was never filled in, in the log's own voice. */
function unfinished(actionType: string): ActionOutcome {
  const problem = describeActionProblem(actionType, {}) ?? "is not finished";
  return { log: `Nothing done — this step ${problem}`, stop: false, misconfigured: true };
}

/**
 * Performs one action and returns the line it writes in the run log.
 *
 * Every branch returns a sentence rather than throwing on a missing bit of
 * configuration: a half-configured action is a thing to see in the run log, not
 * a reason to abandon the four actions after it. It is still counted against the
 * run — see `ActionOutcome.misconfigured`.
 */
async function performAction(
  action: ActionRow,
  context: RunContext,
  automationId: number,
  isTest: boolean
): Promise<ActionOutcome> {
  const config = action.config ?? {};
  const contactId = context.contactId;

  switch (action.action_type) {
    case "send_email": {
      const parsed = sendEmailConfig.safeParse(config);
      if (!parsed.success) return unfinished(action.action_type);
      if (contactId === null || !context.email) {
        return { log: "Email: blocked — no contact to send to", stop: false, blocked: true };
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
        blocked: result.outcome === "suppressed",
      };
    }

    case "subscribe_sequence": {
      const parsed = sequenceConfig.safeParse(config);
      if (!parsed.success) return unfinished(action.action_type);
      if (contactId === null) return { log: "Sequence: blocked — no contact", stop: false, blocked: true };
      if (isTest) return { log: "Sequence: would start them on it", stop: false };

      const result = await enrollContact(parsed.data.sequenceId, contactId, {
        reason: `automation ${automationId}`,
      });
      return { log: `Sequence: ${result.outcome.replace(/_/g, " ")}${result.reason ? ` — ${result.reason}` : ""}`, stop: false };
    }

    case "unsubscribe_sequence": {
      const parsed = sequenceConfig.safeParse(config);
      if (!parsed.success) return unfinished(action.action_type);
      if (contactId === null) return { log: "Sequence: blocked — no contact", stop: false, blocked: true };
      if (isTest) return { log: "Sequence: would take them off it", stop: false };

      const removed = await exitContact(parsed.data.sequenceId, contactId, {
        reason: `automation ${automationId}`,
      });
      return { log: removed ? "Taken off the sequence" : "They were not on that sequence", stop: false };
    }

    case "add_tag": {
      const parsed = tagConfig.safeParse(config);
      if (!parsed.success) return unfinished(action.action_type);
      if (contactId === null) return { log: "Tag: blocked — no contact", stop: false, blocked: true };

      const slug = await tagSlug(parsed.data.tagId);
      if (!slug) return { log: "Tag: blocked — that tag no longer exists", stop: false, blocked: true };
      if (isTest) return { log: `Tag: would add "${slug}"`, stop: false };

      await applyTags(contactId, [slug], `automation:${automationId}`);
      return { log: `Tag added: ${slug}`, stop: false };
    }

    case "remove_tag": {
      const parsed = tagConfig.safeParse(config);
      if (!parsed.success) return unfinished(action.action_type);
      if (contactId === null) return { log: "Tag: blocked — no contact", stop: false, blocked: true };
      if (isTest) return { log: "Tag: would remove it", stop: false };

      const slug = await tagSlug(parsed.data.tagId);
      if (!slug) return { log: "Tag: blocked — that tag no longer exists", stop: false, blocked: true };
      const removed = await removeTags(contactId, [slug]);
      return { log: removed > 0 ? "Tag removed" : "They did not have that tag", stop: false };
    }

    case "grant_offer": {
      const parsed = offerConfig.safeParse(config);
      if (!parsed.success) return unfinished(action.action_type);
      const memberId = await memberIdFor(contactId);
      if (memberId === null) {
        return { log: "Offer: blocked — they have no account yet", stop: false, blocked: true };
      }
      if (isTest) return { log: "Offer: would give them access", stop: false };

      const products = await grantOfferAccess({
        memberId,
        offerId: parsed.data.offerId,
        source: "automation",
      });
      return {
        log: products.length > 0 ? `Access given to ${products.length} item(s)` : "Offer: blocked — it contains no products",
        stop: false,
        blocked: products.length === 0,
      };
    }

    case "revoke_offer": {
      const parsed = offerConfig.safeParse(config);
      if (!parsed.success) return unfinished(action.action_type);
      const memberId = await memberIdFor(contactId);
      if (memberId === null) return { log: "Offer: blocked — they have no account", stop: false, blocked: true };
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
      if (!parsed.success) return unfinished(action.action_type);
      if (contactId === null || !context.email) {
        return { log: "Event: blocked — no contact", stop: false, blocked: true };
      }
      if (isTest) return { log: "Event: would register them", stop: false };

      const eventRes = await pool.query<{
        starts_at: Date | null;
        evergreen_interval_minutes: number | null;
      }>(`SELECT starts_at, evergreen_interval_minutes FROM events WHERE id = $1`, [
        parsed.data.eventId,
      ]);
      const event = eventRes.rows[0];
      if (!event) return { log: "Event: blocked — that event no longer exists", stop: false, blocked: true };

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
      if (!parsed.success) return unfinished(action.action_type);
      const { title, note } = parsed.data;
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
      const followUpTo = await notificationRecipients("alert");
      if (followUpTo) {
        await sendMail({
          to: followUpTo,
          subject: `Follow up: ${title}`,
          text: [`${title}`, ``, note, ``, `About: ${context.email || "someone"}`].join("\n"),
        });
      }
      return { log: `Follow-up noted: ${title}`, stop: false };
    }

    case "fire_webhook": {
      const parsed = webhookConfig.safeParse(config);
      if (!parsed.success) return unfinished(action.action_type);
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
      // An unfinished gate stops the run rather than letting it through. The
      // step was added to hold something back, and carrying on would do the one
      // thing she added it to prevent.
      if (!branchConfig.safeParse(config).success) {
        return { ...unfinished(action.action_type), stop: true };
      }
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
      // A row left behind by an older engine. Nothing to run, and nothing about
      // it is a success.
      return {
        log: `${action.action_type}: not something this platform can do`,
        stop: false,
        misconfigured: true,
      };
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

/**
 * Steps whose writes are naturally idempotent and can therefore be attempted
 * again after a definite failure. Provider calls stay at-most-once: a timeout
 * after an email or arbitrary webhook was accepted is indistinguishable from
 * a timeout before acceptance, and retrying it can contact the customer twice.
 */
const RETRY_SAFE_ACTIONS = new Set<string>([
  "subscribe_sequence",
  "unsubscribe_sequence",
  "add_tag",
  "remove_tag",
  "grant_offer",
  "revoke_offer",
  "register_event",
  "branch",
]);

export function actionCanRetry(actionType: string): boolean {
  return RETRY_SAFE_ACTIONS.has(actionType);
}

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

/** Releases only a definitely failed, idempotent action for the queue retry. */
async function releaseActionClaim(runId: number, actionId: number): Promise<void> {
  await pool.query(
    `UPDATE automation_runs
        SET trigger_payload = jsonb_set(
              COALESCE(trigger_payload, '{}'::jsonb),
              $3::text[],
              COALESCE((
                SELECT jsonb_agg(value)
                  FROM jsonb_array_elements(COALESCE(trigger_payload -> $2::text, '[]'::jsonb)) value
                 WHERE value <> to_jsonb($4::int)
              ), '[]'::jsonb)
            )
      WHERE id = $1`,
    [runId, CLAIM_KEY, [CLAIM_KEY], actionId]
  );
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
         (automation_id, status, subject_email, log, contact_id, trigger_payload, is_test, event_key)
       VALUES ($1, 'running', $2, '[]'::jsonb, $3, $4, $5, $6)
       ON CONFLICT (automation_id, event_key)
         WHERE event_key IS NOT NULL AND NOT is_test
         DO NOTHING
       RETURNING id`,
      [
        automationId,
        context.email,
        context.contactId,
        JSON.stringify({ trigger: context.trigger, subjectId: context.subjectId, ...context.facts }),
        isTest,
        context.eventKey ?? null,
      ]
    );
    runId = created.rows[0]?.id ?? 0;
    if (!runId) {
      const existing = await pool.query<{ id: number }>(
        `SELECT id FROM automation_runs WHERE automation_id = $1 AND event_key = $2`,
        [automationId, context.eventKey],
      );
      return {
        runId: existing.rows[0]?.id ?? 0,
        status: "skipped",
        log: ["Already handled this event"],
      };
    }
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
      if (waitMinutes > 0) {
        // A dry run reaches a real wait here, because it does not schedule one.
        await noteLog(runId, log, `Would wait ${waitMinutes} minute(s) before carrying on`);
        continue;
      }
      // A wait with no time on it is a step she added and never filled in. It
      // is handled by this loop rather than by `performAction`, so it needs its
      // own count or a run whose only pause was never set reports success.
      failures += 1;
      await noteLog(runId, log, "Nothing done — this step waits no time at all");
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
      // A step that was never filled in is counted with the errors rather than
      // with the work. It is the whole of P0-6: the run log said "Tag: none
      // chosen" and the run said "success", so the screen said RAN FINE.
      if (outcome.misconfigured || outcome.blocked) failures += 1;
      await noteLog(runId, log, outcome.log);
      if (outcome.stop) break;
    } catch (err) {
      failures += 1;
      const detail = (err instanceof Error ? err.message : String(err)).slice(0, 300);
      await noteLog(
        runId,
        log,
        `Something went wrong: ${detail}`
      );
      if (!isTest && actionCanRetry(action.action_type)) {
        await releaseActionClaim(runId, action.id);
        await pool.query(`UPDATE automation_runs SET status = 'failed' WHERE id = $1`, [runId]);
        await pool.query(
          `UPDATE automations SET last_error = $2 WHERE id = $1`,
          [automationId, detail]
        );
        // The domain-event job owns bounded exponential retry and dead-letter
        // handling. Throwing here leaves the durable event unprocessed.
        throw err;
      }
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

/**
 * Writes the run that did not happen, and says why.
 *
 * Exported because the dry run needs it too: a practice run that quietly skips
 * the condition check reports green for an automation that skips every real
 * trigger, which is how an automation nobody could make fire looked fine.
 */
export async function recordSkip(
  automationId: number,
  context: RunContext,
  reason: string,
  isTest = false
): Promise<number> {
  const res = await pool.query<{ id: number }>(
    `INSERT INTO automation_runs
       (automation_id, status, subject_email, log, contact_id, trigger_payload, is_test, event_key)
     VALUES ($1, 'skipped', $2, $3::jsonb, $4, $5, $6, $7)
     ON CONFLICT (automation_id, event_key)
       WHERE event_key IS NOT NULL AND NOT is_test
       DO NOTHING
     RETURNING id`,
    [
      automationId,
      context.email,
      JSON.stringify([reason]),
      context.contactId,
      JSON.stringify({ trigger: context.trigger, subjectId: context.subjectId }),
      isTest,
      context.eventKey ?? null,
    ]
  );
  if (res.rows[0]?.id) return res.rows[0].id;
  const existing = await pool.query<{ id: number }>(
    `SELECT id FROM automation_runs WHERE automation_id = $1 AND event_key = $2`,
    [automationId, context.eventKey],
  );
  return existing.rows[0]?.id ?? 0;
}

async function eventRun(
  automationId: number,
  eventKey?: string,
): Promise<{ id: number; status: string } | null> {
  if (!eventKey) return null;
  const found = await pool.query<{ id: number; status: string }>(
    `SELECT id, status FROM automation_runs WHERE automation_id = $1 AND event_key = $2 LIMIT 1`,
    [automationId, eventKey],
  );
  return found.rows[0] ?? null;
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
  /** Stable key for this exact occurrence; used to prevent replayed runs. */
  eventKey?: string;
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
export async function fireTrigger(
  trigger: TriggerV2,
  input: TriggerInput,
  options: { rethrow?: boolean } = {},
): Promise<void> {
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
      eventKey: input.eventKey,
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
      // Check before conditions and the per-person ceiling: a replay of an
      // already successful occurrence must not create a later, misleading
      // "maximum runs" skip. The insert-side unique key remains the race-safe
      // authority when two workers arrive together.
      const previous = await eventRun(automation.id, context.eventKey);
      if (previous) {
        if (["failed", "partial", "running"].includes(previous.status)) {
          await runAutomation({ automationId: automation.id, context, runId: previous.id });
        }
        continue;
      }

      const subjectKey = SUBJECT_KEY[trigger];
      if (subjectKey) {
        const wanted = automation.trigger_config?.[subjectKey];
        // An empty narrowing means "any of them"; a set one has to match, and a
        // trigger that arrived without a subject cannot match a narrowed rule.
        if (wanted !== undefined && wanted !== null && wanted !== "" && wanted !== 0) {
          if (context.subjectId === null || Number(wanted) !== context.subjectId) continue;
        }
      }

      // A half-built "only if" is not evaluated at all. Depending on the
      // operator an empty rule reads as always-false or as always-true, and the
      // always-true half is the dangerous one: a gate she believes she set,
      // opening the automation to everybody. Skipping instead is recorded under
      // her nose in the run history rather than being a silent change.
      const conditionProblem = describeConditionProblem(automation.conditions ?? {});
      if (conditionProblem) {
        await recordSkip(automation.id, context, `Not run — ${conditionProblem}`);
        continue;
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
    if (options.rethrow) throw err;
  }
}

/** Makes the fire-and-forget intent explicit at call sites. */
export function fireTriggerAsync(trigger: TriggerV2, input: TriggerInput): void {
  void fireTrigger(trigger, input);
}
