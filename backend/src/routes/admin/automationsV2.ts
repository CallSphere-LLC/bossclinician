import { Router } from "express";
import { z } from "zod";
import {
  ACTION_DESCRIPTORS,
  ACTION_TYPES,
  TRIGGER_DESCRIPTORS,
  TRIGGER_TYPES,
  conditionsSchema,
  describeActionProblem,
  describeConditionProblem,
  evaluateConditions,
  isTriggerV2,
  recordSkip,
  runAutomation,
  type RunContext,
} from "../../automations/engineV2";
import { pool } from "../../db/pool";
import { upsertContact } from "../../services/contacts";
import { asyncHandler } from "../../utils/asyncHandler";
import { rowToCamel, rowsToCamel } from "../../utils/case";
import { badRequest, notFound } from "../../utils/httpError";

/**
 * The automation builder's API — mounted at /api/admin/automations.
 *
 * Everything here exists so the screen can read as a sentence. `/options`
 * hands over every name the builder needs in one call, and the list endpoint
 * composes the sentence itself, so "When someone submits the Offer Quiz form"
 * is written once here rather than assembled from ids in the browser.
 */

export const adminAutomationsV2Router = Router();

/* ----------------------------------------------------------------- schemas */

/**
 * Conditions are held to the engine's own shape, and no further.
 *
 * Shape only, because the builder saves a condition the moment it is added and
 * she chooses the tag on the next click; refusing that would make a condition
 * impossible to add. Whether a condition is *finished* is the turn-it-on gate
 * below, which is the point at which an unfinished one can do harm.
 *
 * `passthrough` keeps the flat legacy map that older automations still store,
 * which `evaluateConditions` reads and which stripping would erase on any save.
 */
const savedConditionsSchema = conditionsSchema.passthrough();

const automationSchema = z.object({
  name: z.string().trim().min(1, "Give this automation a name").max(200),
  description: z.string().max(2000).optional(),
  triggerType: z.enum(TRIGGER_TYPES),
  triggerConfig: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  conditions: savedConditionsSchema.optional(),
  status: z.enum(["active", "paused"]).optional(),
  maxRunsPerContactPerDay: z.number().int().min(0).max(500).optional(),
});

const actionSchema = z.object({
  actionType: z.enum(ACTION_TYPES),
  config: z.record(z.string(), z.unknown()).optional(),
  delayMinutes: z.number().int().min(0).max(525_600).optional(),
  conditions: savedConditionsSchema.optional(),
  sort: z.number().int().min(0).optional(),
});

/* --------------------------------------------------------------- readiness */

/**
 * Whether an automation can do what its sentence says, and what is stopping it.
 *
 * One reading of "ready", shared by the places that need it: the save endpoints
 * refuse a step that could never work, the turn-it-on check refuses the whole
 * automation, and the two GETs hand the answer to the builder so an unfinished
 * step is visible before she trusts it. All of them defer to the engine's own
 * schemas, so a step this file calls ready and the runner treats as empty
 * cannot happen again.
 */

/** The columns any of that needs, however the row was fetched. */
interface StoredAction {
  action_type: string;
  config: Record<string, unknown> | null;
  conditions: Record<string, unknown> | null;
}

const ACTION_LABEL = new Map<string, string>(
  ACTION_DESCRIPTORS.map((descriptor) => [descriptor.type as string, descriptor.label])
);

/** `null` when this step is finished, otherwise what it is still missing. */
function stepProblem(action: StoredAction): string | null {
  return (
    describeActionProblem(action.action_type, action.config ?? {}) ??
    describeConditionProblem(action.conditions ?? {})
  );
}

function readinessProblems(conditions: unknown, actions: StoredAction[]): string[] {
  const problems: string[] = [];

  const conditionProblem = describeConditionProblem(conditions ?? {});
  if (conditionProblem) problems.push(conditionProblem);

  // An automation with nothing to do still writes a run for every trigger, and
  // every one of those runs says it went fine.
  if (actions.length === 0) problems.push("it has no steps yet");

  actions.forEach((action, index) => {
    const problem = stepProblem(action);
    if (!problem) return;
    const label = ACTION_LABEL.get(action.action_type) ?? action.action_type;
    problems.push(`step ${index + 1} (${label}) ${problem}`);
  });

  return problems;
}

/**
 * The refusal, written to survive the trip to the screen.
 *
 * `friendlyError` in the admin passes a 400's own wording through to her only
 * while it stays under 200 characters and does not read like a parser message;
 * past that she gets "check the highlighted fields" on a screen with nothing
 * highlighted. So the list is trimmed here rather than in the browser.
 */
function notReadyMessage(problems: string[]): string {
  const shown = problems.slice(0, 2).join(", and ");
  const rest = problems.length - 2;
  const more = rest > 0 ? ` (and ${rest} more thing${rest === 1 ? "" : "s"})` : "";
  return `Not ready to turn on yet: ${shown}${more}. Finish that and it will start.`.slice(0, 200);
}

/* ----------------------------------------------------------------- options */

interface NamedOption {
  id: number;
  name: string;
}

async function namesFrom(sql: string): Promise<NamedOption[]> {
  const result = await pool.query<{ id: number; name: string }>(sql);
  return result.rows.map((row) => ({ id: row.id, name: row.name }));
}

/**
 * GET /api/admin/automations/options
 *
 * Every list the builder needs, in one request. Declared before `/:id` because
 * Express matches in order and "options" is otherwise a perfectly good id.
 */
adminAutomationsV2Router.get(
  "/options",
  asyncHandler(async (_req, res) => {
    const [tags, sequences, offers, forms, events, assessments, courses, communities, plans, segments] =
      await Promise.all([
        namesFrom(`SELECT id, name FROM tags ORDER BY name`),
        namesFrom(`SELECT id, name FROM email_sequences WHERE status <> 'archived' ORDER BY name`),
        namesFrom(`SELECT id, title AS name FROM offers WHERE status <> 'archived' ORDER BY title`),
        namesFrom(`SELECT id, name FROM forms ORDER BY name`),
        namesFrom(`SELECT id, title AS name FROM events ORDER BY title`),
        namesFrom(`SELECT id, title AS name FROM assessments ORDER BY title`),
        namesFrom(`SELECT id, title AS name FROM courses ORDER BY title`),
        namesFrom(`SELECT id, name FROM communities ORDER BY name`),
        namesFrom(`SELECT id, name FROM plans ORDER BY name`),
        namesFrom(`SELECT id, name FROM segments ORDER BY name`),
      ]);

    res.json({
      triggers: TRIGGER_DESCRIPTORS,
      actions: ACTION_DESCRIPTORS,
      lists: { tags, sequences, offers, forms, events, assessments, courses, communities, plans, segments },
    });
  })
);

/* -------------------------------------------------------------- sentences */

type NameLookup = Map<string, Map<number, string>>;

async function buildLookup(): Promise<NameLookup> {
  const [tags, sequences, offers, forms, events, assessments, courses, communities, plans] =
    await Promise.all([
      namesFrom(`SELECT id, name FROM tags`),
      namesFrom(`SELECT id, name FROM email_sequences`),
      namesFrom(`SELECT id, title AS name FROM offers`),
      namesFrom(`SELECT id, name FROM forms`),
      namesFrom(`SELECT id, title AS name FROM events`),
      namesFrom(`SELECT id, title AS name FROM assessments`),
      namesFrom(`SELECT id, title AS name FROM courses`),
      namesFrom(`SELECT id, name FROM communities`),
      namesFrom(`SELECT id, name FROM plans`),
    ]);

  const lookup: NameLookup = new Map();
  const add = (key: string, rows: NamedOption[]): void => {
    lookup.set(key, new Map(rows.map((row) => [row.id, row.name])));
  };
  add("tags", tags);
  add("sequences", sequences);
  add("offers", offers);
  add("forms", forms);
  add("events", events);
  add("assessments", assessments);
  add("courses", courses);
  add("communities", communities);
  add("plans", plans);
  return lookup;
}

function nameOf(lookup: NameLookup, source: string, id: unknown): string {
  const numeric = Number(id);
  if (!Number.isFinite(numeric)) return "";
  return lookup.get(source)?.get(numeric) ?? "";
}

/** "When someone submits the Offer Quiz form". */
function triggerSentence(
  lookup: NameLookup,
  triggerType: string,
  triggerConfig: Record<string, unknown>
): string {
  const descriptor = TRIGGER_DESCRIPTORS.find((d) => d.type === triggerType);
  if (!descriptor) return "When something happens";

  if (!descriptor.subjectKey) return `When ${descriptor.label}`;
  const subject = nameOf(lookup, descriptor.subjectSource, triggerConfig?.[descriptor.subjectKey]);
  return subject ? `When ${descriptor.label} — ${subject}` : `When ${descriptor.label} (any)`;
}

/** "add the tag Visionary". */
function actionSentence(
  lookup: NameLookup,
  actionType: string,
  config: Record<string, unknown>,
  delayMinutes: number
): string {
  const wait = delayMinutes > 0 ? `after ${describeMinutes(delayMinutes)}, ` : "";

  switch (actionType) {
    case "send_email":
      return `${wait}send them the email "${String(config.subject ?? "").slice(0, 60) || "(no subject yet)"}"`;
    case "subscribe_sequence":
      return `${wait}start them on ${nameOf(lookup, "sequences", config.sequenceId) || "a sequence"}`;
    case "unsubscribe_sequence":
      return `${wait}take them off ${nameOf(lookup, "sequences", config.sequenceId) || "a sequence"}`;
    case "add_tag":
      return `${wait}add the tag ${nameOf(lookup, "tags", config.tagId) || "(none chosen)"}`;
    case "remove_tag":
      return `${wait}remove the tag ${nameOf(lookup, "tags", config.tagId) || "(none chosen)"}`;
    case "grant_offer":
      return `${wait}give them ${nameOf(lookup, "offers", config.offerId) || "an offer"}`;
    case "revoke_offer":
      return `${wait}take away ${nameOf(lookup, "offers", config.offerId) || "an offer"}`;
    case "register_event":
      return `${wait}register them for ${nameOf(lookup, "events", config.eventId) || "an event"}`;
    case "create_task":
      return `${wait}remind you to ${String(config.title ?? "follow up")}`;
    case "fire_webhook":
      return `${wait}notify another app`;
    case "wait":
      return `wait ${describeMinutes(
        Number(config.minutes ?? 0) + Number(config.days ?? 0) * 1440
      )}`;
    case "branch":
      return "only carry on if the conditions still hold";
    default:
      return actionType;
  }
}

function describeMinutes(minutes: number): string {
  if (minutes <= 0) return "no time at all";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  if (minutes < 1440) {
    const hours = Math.round(minutes / 60);
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  const days = Math.round(minutes / 1440);
  return `${days} day${days === 1 ? "" : "s"}`;
}

/* ------------------------------------------------------------ automations */

adminAutomationsV2Router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const lookup = await buildLookup();

    const automations = await pool.query<{
      id: number;
      trigger_type: string;
      trigger_config: Record<string, unknown>;
      conditions: Record<string, unknown>;
    }>(
      `SELECT a.*,
              (SELECT COUNT(*)::int FROM automation_actions x WHERE x.automation_id = a.id) AS action_count
         FROM automations a
        ORDER BY a.name`
    );

    const actions = await pool.query<StoredAction & {
      automation_id: number;
      delay_minutes: number;
    }>(
      `SELECT automation_id, action_type, config, conditions, delay_minutes
         FROM automation_actions ORDER BY automation_id, sort, id`
    );

    const byAutomation = new Map<number, string[]>();
    const stepsOf = new Map<number, StoredAction[]>();
    for (const action of actions.rows) {
      const list = byAutomation.get(action.automation_id) ?? [];
      list.push(actionSentence(lookup, action.action_type, action.config ?? {}, action.delay_minutes));
      byAutomation.set(action.automation_id, list);

      const steps = stepsOf.get(action.automation_id) ?? [];
      steps.push(action);
      stepsOf.set(action.automation_id, steps);
    }

    res.json(
      automations.rows.map((row) => ({
        ...rowToCamel(row),
        triggerSentence: triggerSentence(lookup, row.trigger_type, row.trigger_config ?? {}),
        actionSentences: byAutomation.get(row.id) ?? [],
        // The list is where she decides which automation to trust, so an
        // unfinished one has to say so here rather than only once she opens it.
        needsAttention:
          readinessProblems(row.conditions, stepsOf.get(row.id) ?? []).length > 0,
      }))
    );
  })
);

adminAutomationsV2Router.post(
  "/",
  asyncHandler(async (req, res) => {
    const input = automationSchema.parse(req.body);
    const result = await pool.query(
      `INSERT INTO automations
         (name, description, trigger_type, trigger_config, conditions, status,
          max_runs_per_contact_per_day)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)
       RETURNING *`,
      [
        input.name,
        input.description ?? "",
        input.triggerType,
        JSON.stringify(input.triggerConfig ?? {}),
        JSON.stringify(input.conditions ?? { match: "all", rules: [] }),
        input.status ?? "paused",
        input.maxRunsPerContactPerDay ?? 25,
      ]
    );
    res.status(201).json(rowToCamel(result.rows[0]));
  })
);

adminAutomationsV2Router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const automation = await pool.query(`SELECT * FROM automations WHERE id = $1`, [req.params.id]);
    if (automation.rowCount === 0) throw notFound("Automation not found");

    const actions = await pool.query(
      `SELECT * FROM automation_actions WHERE automation_id = $1 ORDER BY sort, id`,
      [req.params.id]
    );

    const lookup = await buildLookup();
    const row = automation.rows[0];
    const problems = readinessProblems(row.conditions, actions.rows);

    res.json({
      ...rowToCamel(row),
      triggerSentence: triggerSentence(lookup, row.trigger_type, row.trigger_config ?? {}),
      actions: actions.rows.map((action) => ({
        ...rowToCamel(action),
        sentence: actionSentence(lookup, action.action_type, action.config ?? {}, action.delay_minutes),
        // Per step as well as for the whole automation: "something is unfinished"
        // is not actionable on a screen with six steps on it.
        problem: stepProblem(action),
      })),
      problems,
      needsAttention: problems.length > 0,
    });
  })
);

/**
 * PATCH /api/admin/automations/:id
 *
 * Turning one on is the one edit that is refused rather than saved. Until this
 * check existed, `status` flipped to active without anybody reading the steps,
 * so an automation whose only step had nothing chosen went live and reported
 * every run as a success.
 *
 * An automation that is *already* active and unfinished is left alone here — it
 * is not silently paused behind her back — but its runs now report the problem
 * instead of a green tick, the builder marks it as needing attention, and it
 * cannot be turned on again once paused until it is finished.
 */
adminAutomationsV2Router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const input = automationSchema.partial().parse(req.body);

    if (input.status === "active") {
      const current = await pool.query<{ conditions: Record<string, unknown> }>(
        `SELECT conditions FROM automations WHERE id = $1`,
        [req.params.id]
      );
      if (current.rowCount === 0) throw notFound("Automation not found");

      const steps = await pool.query<StoredAction>(
        `SELECT action_type, config, conditions FROM automation_actions
          WHERE automation_id = $1 ORDER BY sort, id`,
        [req.params.id]
      );

      // The conditions in this same request win: she may be fixing the last
      // problem and turning it on in one go.
      const problems = readinessProblems(
        input.conditions ?? current.rows[0].conditions,
        steps.rows
      );
      if (problems.length > 0) throw badRequest(notReadyMessage(problems));
    }

    const result = await pool.query(
      `UPDATE automations SET
          name         = COALESCE($2, name),
          description  = COALESCE($3, description),
          trigger_type = COALESCE($4, trigger_type),
          trigger_config = CASE WHEN $5::boolean THEN $6::jsonb ELSE trigger_config END,
          conditions   = CASE WHEN $7::boolean THEN $8::jsonb ELSE conditions END,
          status       = COALESCE($9, status),
          max_runs_per_contact_per_day = COALESCE($10, max_runs_per_contact_per_day),
          updated_at   = now()
        WHERE id = $1
        RETURNING *`,
      [
        req.params.id,
        input.name ?? null,
        input.description ?? null,
        input.triggerType ?? null,
        input.triggerConfig !== undefined,
        JSON.stringify(input.triggerConfig ?? {}),
        input.conditions !== undefined,
        JSON.stringify(input.conditions ?? {}),
        input.status ?? null,
        input.maxRunsPerContactPerDay ?? null,
      ]
    );
    if (result.rowCount === 0) throw notFound("Automation not found");
    res.json(rowToCamel(result.rows[0]));
  })
);

adminAutomationsV2Router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const result = await pool.query(`DELETE FROM automations WHERE id = $1`, [req.params.id]);
    if (result.rowCount === 0) throw notFound("Automation not found");
    res.status(204).end();
  })
);

/* ---------------------------------------------------------------- actions */

adminAutomationsV2Router.post(
  "/:id/actions",
  asyncHandler(async (req, res) => {
    const input = actionSchema.parse(req.body);

    // A step is saved finished or not at all. The builder used to create one
    // from the Add menu with no configuration at all and never open the editor,
    // which is where every "add the tag (none chosen)" came from.
    const problem = describeActionProblem(input.actionType, input.config ?? {});
    if (problem) throw badRequest(`This step ${problem}.`);

    const next = await pool.query<{ sort: number }>(
      `SELECT COALESCE(MAX(sort), -1) + 1 AS sort FROM automation_actions WHERE automation_id = $1`,
      [req.params.id]
    );

    const result = await pool.query(
      `INSERT INTO automation_actions
         (automation_id, action_type, config, sort, delay_minutes, conditions)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6::jsonb)
       RETURNING *`,
      [
        req.params.id,
        input.actionType,
        JSON.stringify(input.config ?? {}),
        input.sort ?? next.rows[0].sort,
        input.delayMinutes ?? 0,
        JSON.stringify(input.conditions ?? {}),
      ]
    );
    res.status(201).json(rowToCamel(result.rows[0]));
  })
);

adminAutomationsV2Router.patch(
  "/:id/actions/:actionId",
  asyncHandler(async (req, res) => {
    const input = actionSchema.partial().parse(req.body);

    if (input.config !== undefined || input.actionType !== undefined) {
      // The type comes from the row when the edit does not change it: a config
      // is only meaningful against the kind of step it belongs to.
      const existing = await pool.query<{ action_type: string; config: Record<string, unknown> }>(
        `SELECT action_type, config FROM automation_actions WHERE id = $2 AND automation_id = $1`,
        [req.params.id, req.params.actionId]
      );
      if (existing.rowCount === 0) throw notFound("Step not found");

      const actionType = input.actionType ?? existing.rows[0].action_type;
      const config = input.config ?? existing.rows[0].config ?? {};
      const problem = describeActionProblem(actionType, config);
      if (problem) throw badRequest(`This step ${problem}.`);
    }

    const result = await pool.query(
      `UPDATE automation_actions SET
          action_type   = COALESCE($3, action_type),
          config        = CASE WHEN $4::boolean THEN $5::jsonb ELSE config END,
          delay_minutes = COALESCE($6, delay_minutes),
          conditions    = CASE WHEN $7::boolean THEN $8::jsonb ELSE conditions END,
          sort          = COALESCE($9, sort)
        WHERE id = $2 AND automation_id = $1
        RETURNING *`,
      [
        req.params.id,
        req.params.actionId,
        input.actionType ?? null,
        input.config !== undefined,
        JSON.stringify(input.config ?? {}),
        input.delayMinutes ?? null,
        input.conditions !== undefined,
        JSON.stringify(input.conditions ?? {}),
        input.sort ?? null,
      ]
    );
    if (result.rowCount === 0) throw notFound("Step not found");
    res.json(rowToCamel(result.rows[0]));
  })
);

adminAutomationsV2Router.delete(
  "/:id/actions/:actionId",
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      `DELETE FROM automation_actions WHERE id = $2 AND automation_id = $1`,
      [req.params.id, req.params.actionId]
    );
    if (result.rowCount === 0) throw notFound("Step not found");
    res.status(204).end();
  })
);

adminAutomationsV2Router.post(
  "/:id/actions/reorder",
  asyncHandler(async (req, res) => {
    const { order } = z
      .object({ order: z.array(z.number().int().positive()).min(1) })
      .parse(req.body);

    // `sort` has no unique constraint, so unlike the sequence reorder this can
    // be done in one pass.
    for (const [index, actionId] of order.entries()) {
      await pool.query(
        `UPDATE automation_actions SET sort = $3 WHERE id = $2 AND automation_id = $1`,
        [req.params.id, actionId, index]
      );
    }

    const actions = await pool.query(
      `SELECT * FROM automation_actions WHERE automation_id = $1 ORDER BY sort, id`,
      [req.params.id]
    );
    res.json(rowsToCamel(actions.rows));
  })
);

/* ------------------------------------------------------------------- runs */

adminAutomationsV2Router.get(
  "/:id/runs",
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      `SELECT r.id, r.status, r.subject_email, r.log, r.is_test, r.created_at,
              c.name AS contact_name
         FROM automation_runs r
         LEFT JOIN contacts c ON c.id = r.contact_id
        WHERE r.automation_id = $1
        ORDER BY r.created_at DESC
        LIMIT 100`,
      [req.params.id]
    );
    res.json(rowsToCamel(result.rows));
  })
);

/**
 * POST /api/admin/automations/:id/test
 *
 * Runs every step against a real person without doing anything to them: each
 * action reports what it would have done. A dry run is the only way to answer
 * "will this send the wrong email to four hundred people" before it does.
 *
 * It goes through the automation's own "only if" first, exactly as `fireTrigger`
 * does. Calling `runAutomation` straight off skipped that check, so the one
 * automation on this site — whose condition matches nobody — practised green
 * while every real purchase was being skipped. A dry run that cannot reproduce
 * a skip is worse than no dry run: it is a green tick over the failure.
 */
adminAutomationsV2Router.post(
  "/:id/test",
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        email: z.string().email("Give an email address to try this against"),
        name: z.string().max(200).optional(),
        live: z.boolean().optional(),
      })
      .parse(req.body);

    const automation = await pool.query<{
      trigger_type: string;
      conditions: Record<string, unknown>;
    }>(`SELECT trigger_type, conditions FROM automations WHERE id = $1`, [req.params.id]);
    if (automation.rowCount === 0) throw notFound("Automation not found");

    const triggerType = automation.rows[0].trigger_type;
    if (!isTriggerV2(triggerType)) {
      throw badRequest("This automation uses an older trigger that the new builder cannot run");
    }

    const contactId = await upsertContact({
      email: input.email,
      name: input.name,
      source: "automation test",
    });

    const context: RunContext = {
      trigger: triggerType,
      contactId,
      email: input.email.toLowerCase(),
      name: input.name ?? "",
      subjectId: null,
      facts: { email: input.email.toLowerCase(), name: input.name ?? "" },
    };

    const automationId = Number(req.params.id);
    const isTest = input.live !== true;
    const conditions = automation.rows[0].conditions ?? {};

    // Reported as a skip, and written to the history as one, because that is
    // what a real trigger would do with this person.
    const conditionProblem = describeConditionProblem(conditions);
    if (conditionProblem || !(await evaluateConditions(conditions, context))) {
      const reason = conditionProblem
        ? `Nothing would happen — ${conditionProblem}`
        : "Nothing would happen — this person does not meet the conditions";
      const runId = await recordSkip(automationId, context, reason, isTest);
      res.status(202).json({ runId, status: "skipped", log: [reason] });
      return;
    }

    const result = await runAutomation({
      automationId,
      context,
      // `live` really does everything, for the case where the owner wants to
      // see the email land in her own inbox. Off by default.
      isTest,
    });

    res.status(202).json(result);
  })
);
