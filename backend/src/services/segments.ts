import { z } from "zod";
import { pool } from "../db/pool";
import { badRequest } from "../utils/httpError";

/**
 * Segments — a saved filter over contacts, stored as rules and interpreted here.
 *
 * The definition is JSON written by an admin screen, and that makes it data,
 * not code. Nothing out of it is ever spliced into SQL: a field name is looked
 * up in the table below and answers with a fixed column expression, an operator
 * is looked up in that field's own allowlist, and the value travels as a bind
 * parameter. A definition naming a field nobody built is rejected, loudly,
 * rather than being passed through to Postgres to see what happens.
 *
 * That matters more than it looks. A segment is reachable from an admin screen,
 * is stored, and is later evaluated by a background job with no request context
 * — so a definition that could carry SQL would be a stored injection that fires
 * long after whoever wrote it has gone.
 */

export type SegmentMatch = "all" | "any";

export interface SegmentRule {
  field: string;
  op: string;
  value?: unknown;
}

export interface SegmentDefinition {
  match: SegmentMatch;
  rules: SegmentRule[];
}

/** The shape, only — which fields and operators are real is decided below. */
export const segmentDefinitionSchema = z.object({
  match: z.enum(["all", "any"]).default("all"),
  rules: z
    .array(
      z.object({
        field: z.string().min(1).max(60),
        op: z.string().min(1).max(20),
        value: z.unknown().optional(),
      })
    )
    .max(25)
    .default([]),
});

export type SegmentOperator =
  | "eq"
  | "neq"
  | "contains"
  | "gt"
  | "lt"
  | "before"
  | "after"
  | "has"
  | "not_has";

interface FieldSpec {
  /** Which operators this field understands. Anything else is refused. */
  ops: readonly SegmentOperator[];
  /**
   * The SQL for one rule. `param` binds a value and hands back its placeholder,
   * so no builder here ever sees a chance to concatenate one in.
   */
  build(op: SegmentOperator, value: unknown, param: (v: unknown) => string): string;
}

const EMAIL_STATUSES = [
  "subscribed",
  "opted_out",
  "bounced",
  "complained",
  "unconfirmed",
] as const;

/** Escapes the characters LIKE reads as syntax, so "100%" searches for itself. */
function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

function asText(field: string, value: unknown): string {
  if (typeof value !== "string") throw badRequest(`"${field}" needs some text to compare against`);
  const trimmed = value.trim();
  if (!trimmed) throw badRequest(`"${field}" needs some text to compare against`);
  return trimmed.slice(0, 320);
}

function asNumber(field: string, value: unknown): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) {
    throw badRequest(`"${field}" needs a number to compare against`);
  }
  return parsed;
}

function asId(field: string, value: unknown): number {
  const parsed = asNumber(field, value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw badRequest(`"${field}" needs a valid choice`);
  return parsed;
}

function asDate(field: string, value: unknown): Date {
  if (typeof value !== "string" && typeof value !== "number") {
    throw badRequest(`"${field}" needs a date to compare against`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw badRequest(`"${field}" needs a valid date`);
  return date;
}

/** Text comparison on a column that is already folded to lower case. */
function textRule(column: string, label: string) {
  return (op: SegmentOperator, value: unknown, param: (v: unknown) => string): string => {
    const term = asText(label, value).toLowerCase();
    if (op === "contains") return `${column} LIKE ${param(likePattern(term))}`;
    return `${column} ${op === "eq" ? "=" : "<>"} ${param(term)}`;
  };
}

function numberRule(column: string, label: string) {
  return (op: SegmentOperator, value: unknown, param: (v: unknown) => string): string => {
    const operator = op === "eq" ? "=" : op === "neq" ? "<>" : op === "gt" ? ">" : "<";
    return `${column} ${operator} ${param(asNumber(label, value))}`;
  };
}

/**
 * Date comparison where a NULL column counts as "never".
 *
 * "Nobody has heard from them since March" has to include the people nobody has
 * ever heard from, which a bare `<` silently drops — and those are exactly the
 * contacts a re-engagement segment exists to find.
 */
function dateRule(column: string, label: string, nullMeansNever: boolean) {
  return (op: SegmentOperator, value: unknown, param: (v: unknown) => string): string => {
    const placeholder = param(asDate(label, value));
    if (op === "before") {
      return nullMeansNever
        ? `(${column} IS NULL OR ${column} < ${placeholder})`
        : `${column} < ${placeholder}`;
    }
    return `${column} > ${placeholder}`;
  };
}

/** `EXISTS`/`NOT EXISTS` around one correlated sub-select. */
function existsRule(body: (placeholder: string) => string, bind: (value: unknown) => unknown) {
  return (op: SegmentOperator, value: unknown, param: (v: unknown) => string): string => {
    const clause = `EXISTS (${body(param(bind(value)))})`;
    return op === "has" ? clause : `NOT ${clause}`;
  };
}

const TEXT_OPS = ["eq", "neq", "contains"] as const;
const NUMBER_OPS = ["eq", "neq", "gt", "lt"] as const;
const DATE_OPS = ["before", "after"] as const;
const SET_OPS = ["has", "not_has"] as const;

/**
 * Every field a segment may name, and the only SQL each one can produce.
 *
 * Adding a field here is the only way to make it filterable, which is the point:
 * the list is the security boundary, not a convenience.
 */
const FIELDS: Record<string, FieldSpec> = {
  email: {
    ops: TEXT_OPS,
    build: textRule("lower(c.email::text)", "email address"),
  },
  name: {
    ops: TEXT_OPS,
    build: textRule("lower(c.name)", "name"),
  },
  email_marketing_status: {
    ops: ["eq", "neq"],
    build: (op, value, param) => {
      const status = asText("email subscription", value).toLowerCase();
      if (!(EMAIL_STATUSES as readonly string[]).includes(status)) {
        throw badRequest("That email subscription state isn't one we track");
      }
      return `c.email_marketing_status ${op === "eq" ? "=" : "<>"} ${param(status)}`;
    },
  },
  lifetime_value_cents: {
    ops: NUMBER_OPS,
    build: numberRule("c.lifetime_value_cents", "total spent"),
  },
  order_count: {
    ops: NUMBER_OPS,
    build: numberRule("c.order_count", "number of purchases"),
  },
  created_at: {
    ops: DATE_OPS,
    build: dateRule("c.created_at", "date added", false),
  },
  last_activity_at: {
    ops: DATE_OPS,
    build: dateRule("c.last_activity_at", "last active", true),
  },
  tag: {
    ops: SET_OPS,
    build: existsRule(
      (placeholder) =>
        `SELECT 1 FROM contact_tags ct
            JOIN tags t ON t.id = ct.tag_id
           WHERE ct.contact_id = c.id AND t.slug = ${placeholder}::citext`,
      (value) => asText("tag", value).toLowerCase()
    ),
  },
  purchased_offer: {
    ops: SET_OPS,
    build: existsRule(
      // Only a settled order counts. A pending row is a checkout somebody
      // opened and may never finish, and mailing them as a customer is worse
      // than not mailing them at all.
      (placeholder) =>
        `SELECT 1 FROM orders o
           WHERE o.contact_id = c.id AND o.offer_id = ${placeholder} AND o.status = 'paid'`,
      (value) => asId("what they bought", value)
    ),
  },
  in_sequence: {
    ops: SET_OPS,
    build: existsRule(
      (placeholder) =>
        `SELECT 1 FROM sequence_subscriptions ss
           WHERE ss.contact_id = c.id AND ss.sequence_id = ${placeholder}
             AND ss.status = 'active'`,
      (value) => asId("the sequence", value)
    ),
  },
};

export interface CompiledSegment {
  /** A boolean expression over the alias `c`, safe to drop into a WHERE. */
  where: string;
  params: unknown[];
}

/**
 * Turns a stored definition into a parameterised predicate.
 *
 * A definition with no rules matches everyone. That is the honest reading of
 * "no conditions", and it is what the preview shows before the first rule is
 * added, so the count never jumps from nothing to the whole list.
 */
export function compileSegment(definition: unknown): CompiledSegment {
  const parsed = segmentDefinitionSchema.safeParse(definition ?? {});
  if (!parsed.success) throw badRequest("That saved filter isn't readable", parsed.error.flatten());

  const params: unknown[] = [];
  const param = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  const clauses = parsed.data.rules.map((rule) => {
    // Looked up, never interpolated. An unknown key lands on `undefined` here
    // and stops, rather than reaching the query as an identifier.
    const spec = Object.prototype.hasOwnProperty.call(FIELDS, rule.field)
      ? FIELDS[rule.field]
      : undefined;
    if (!spec) throw badRequest("That saved filter uses something we don't recognise");

    const op = rule.op as SegmentOperator;
    if (!spec.ops.includes(op)) {
      throw badRequest("That saved filter asks for a comparison we can't make");
    }

    return `(${spec.build(op, rule.value, param)})`;
  });

  if (clauses.length === 0) return { where: "TRUE", params };

  return {
    where: clauses.join(parsed.data.match === "any" ? " OR " : " AND "),
    params,
  };
}

/** How many contacts a definition currently matches. */
export async function countSegment(definition: unknown): Promise<number> {
  const { where, params } = compileSegment(definition);
  const result = await pool.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM contacts c WHERE ${where}`,
    params
  );
  return result.rows[0]?.count ?? 0;
}

export interface SegmentContactRow {
  /** Present so a row can be handed straight to `rowsToCamel` without a cast. */
  [column: string]: unknown;
  id: number;
  email: string;
  name: string;
  email_marketing_status: string;
  lifetime_value_cents: number;
  order_count: number;
  last_activity_at: string | null;
  created_at: string;
}

/** The matching contacts, most recently active first. */
export async function listSegmentContacts(
  definition: unknown,
  page: { limit: number; offset: number }
): Promise<SegmentContactRow[]> {
  const { where, params } = compileSegment(definition);
  const result = await pool.query<SegmentContactRow>(
    `SELECT c.id, c.email::text AS email, c.name, c.email_marketing_status,
            c.lifetime_value_cents, c.order_count, c.last_activity_at, c.created_at
       FROM contacts c
      WHERE ${where}
      ORDER BY c.last_activity_at DESC NULLS LAST, c.id DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, page.limit, page.offset]
  );
  return result.rows;
}

/** The ids only — what a broadcast or a bulk tag needs. */
export async function listSegmentContactIds(definition: unknown): Promise<number[]> {
  const { where, params } = compileSegment(definition);
  const result = await pool.query<{ id: number }>(
    `SELECT c.id FROM contacts c WHERE ${where} ORDER BY c.id`,
    params
  );
  return result.rows.map((row) => row.id);
}
