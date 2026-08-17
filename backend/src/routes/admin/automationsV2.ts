import { Router } from "express";
import { z } from "zod";
import {
  ACTION_DESCRIPTORS,
  ACTION_TYPES,
  TRIGGER_DESCRIPTORS,
  TRIGGER_TYPES,
  isTriggerV2,
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

const automationSchema = z.object({
  name: z.string().trim().min(1, "Give this automation a name").max(200),
  description: z.string().max(2000).optional(),
  triggerType: z.enum(TRIGGER_TYPES),
  triggerConfig: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  conditions: z.unknown().optional(),
  status: z.enum(["active", "paused"]).optional(),
  maxRunsPerContactPerDay: z.number().int().min(0).max(500).optional(),
});

const actionSchema = z.object({
  actionType: z.enum(ACTION_TYPES),
  config: z.record(z.unknown()).optional(),
  delayMinutes: z.number().int().min(0).max(525_600).optional(),
  conditions: z.unknown().optional(),
  sort: z.number().int().min(0).optional(),
});

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
    }>(
      `SELECT a.*,
              (SELECT COUNT(*)::int FROM automation_actions x WHERE x.automation_id = a.id) AS action_count
         FROM automations a
        ORDER BY a.name`
    );

    const actions = await pool.query<{
      automation_id: number;
      action_type: string;
      config: Record<string, unknown>;
      delay_minutes: number;
    }>(
      `SELECT automation_id, action_type, config, delay_minutes
         FROM automation_actions ORDER BY automation_id, sort, id`
    );

    const byAutomation = new Map<number, string[]>();
    for (const action of actions.rows) {
      const list = byAutomation.get(action.automation_id) ?? [];
      list.push(actionSentence(lookup, action.action_type, action.config ?? {}, action.delay_minutes));
      byAutomation.set(action.automation_id, list);
    }

    res.json(
      automations.rows.map((row) => ({
        ...rowToCamel(row),
        triggerSentence: triggerSentence(lookup, row.trigger_type, row.trigger_config ?? {}),
        actionSentences: byAutomation.get(row.id) ?? [],
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

    res.json({
      ...rowToCamel(row),
      triggerSentence: triggerSentence(lookup, row.trigger_type, row.trigger_config ?? {}),
      actions: actions.rows.map((action) => ({
        ...rowToCamel(action),
        sentence: actionSentence(lookup, action.action_type, action.config ?? {}, action.delay_minutes),
      })),
    });
  })
);

adminAutomationsV2Router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const input = automationSchema.partial().parse(req.body);
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

    const automation = await pool.query<{ trigger_type: string }>(
      `SELECT trigger_type FROM automations WHERE id = $1`,
      [req.params.id]
    );
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

    const result = await runAutomation({
      automationId: Number(req.params.id),
      context,
      // `live` really does everything, for the case where the owner wants to
      // see the email land in her own inbox. Off by default.
      isTest: input.live !== true,
    });

    res.status(202).json(result);
  })
);
