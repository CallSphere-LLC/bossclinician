import { pool } from "../db/pool";

/**
 * The contact record — one row per person, whatever door they came in through.
 *
 * `leads`, `subscribers` and `members` all survive: `members` alone is the
 * target of twenty-odd foreign keys, and rewriting them is a migration with no
 * safe rollback. So a contact is the identity those three point AT, and every
 * write path that creates a silo row calls through here as well. Somebody who
 * opted in, joined the newsletter and later bought a course is then one person
 * with one timeline, rather than three rows nobody can reconcile.
 *
 * Everything here takes an optional `client`, so a contact can be created in
 * the same transaction as the order or member row that caused it. A contact
 * that exists only because a transaction half-committed is a duplicate nobody
 * can see the cause of.
 */

/** Anything that can run a query — the pool, or a client inside a transaction. */
export interface Queryable {
  query: typeof pool.query;
}

/** The silo tables that carry a `contact_id`. Fixed, because the key is a table name. */
const LINKABLE = {
  lead: "leads",
  subscriber: "subscribers",
  member: "members",
  order: "orders",
} as const;

export type LinkableKind = keyof typeof LINKABLE;

export interface UpsertContactInput {
  email: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  timezone?: string;
  /** How they first arrived. Only ever set on the row that creates the contact. */
  source?: string;
  /** What they agreed to and where — CAN-SPAM and GDPR both ask for it. */
  consentSource?: string;
  consentIp?: string;
  customFields?: Record<string, unknown>;
  client?: Queryable;
}

/**
 * Finds the contact for an address, or creates one, and returns its id.
 *
 * Every field is filled in rather than overwritten: a checkout that knows a
 * billing name must not blank the name a lead form already captured, and a
 * newsletter signup that knows nothing but an address must leave everything
 * else alone. `source` is stickier still — it records where the person first
 * came from, and the second door they walk through does not change that.
 *
 * `email_marketing_status` is untouched here on purpose. It is set by consent
 * and by the provider's bounce webhooks, and an ordinary form submission is
 * neither; re-subscribing somebody who opted out, because they filled in a
 * contact form, is the bug that costs a sending domain its reputation.
 */
export async function upsertContactWithStatus(
  input: UpsertContactInput
): Promise<{ id: number; created: boolean }> {
  const db = input.client ?? pool;
  const email = input.email.trim().toLowerCase();
  if (!email) throw new Error("upsertContact requires an email address");

  const first = (input.firstName ?? "").trim();
  const last = (input.lastName ?? "").trim();
  const name = (input.name ?? `${first} ${last}`).trim();

  const result = await db.query<{ id: number; created: boolean }>(
    `INSERT INTO contacts AS c
       (email, name, first_name, last_name, phone, timezone, source,
        consent_source, consent_ip, custom_fields, last_activity_at)
     VALUES ($1, $2, $3, $4, $5,
             COALESCE(NULLIF($6, ''), 'America/New_York'),
             $7, $8, $9, $10::jsonb, now())
     ON CONFLICT (email) DO UPDATE
        -- The fuller name wins. A newsletter form that knows only a first name
        -- would otherwise shorten "Yvette Howard" to "Yvette", and the display
        -- name is the one field where every form has an opinion and only some
        -- of them have the whole answer.
        SET name           = CASE
                               WHEN EXCLUDED.name = '' THEN c.name
                               WHEN length(EXCLUDED.name) > length(c.name) THEN EXCLUDED.name
                               ELSE c.name
                             END,
            first_name     = COALESCE(NULLIF(EXCLUDED.first_name, ''), c.first_name),
            last_name      = COALESCE(NULLIF(EXCLUDED.last_name, ''), c.last_name),
            phone          = COALESCE(NULLIF(EXCLUDED.phone, ''), c.phone),
            consent_source = COALESCE(NULLIF(c.consent_source, ''), EXCLUDED.consent_source),
            consent_ip     = COALESCE(NULLIF(c.consent_ip, ''), EXCLUDED.consent_ip),
            -- Merged rather than replaced: two forms each know a couple of
            -- answers, and the second must not erase the first one's.
            custom_fields    = c.custom_fields || EXCLUDED.custom_fields,
            last_activity_at = now(),
            updated_at       = now()
     RETURNING c.id, (xmax = 0) AS created`,
    [
      email,
      name,
      first,
      last,
      (input.phone ?? "").trim(),
      (input.timezone ?? "").trim(),
      (input.source ?? "").trim(),
      (input.consentSource ?? "").trim(),
      (input.consentIp ?? "").slice(0, 64),
      JSON.stringify(input.customFields ?? {}),
    ]
  );

  const row = result.rows[0];

  return row;
}

export async function upsertContact(input: UpsertContactInput): Promise<number> {
  const row = await upsertContactWithStatus(input);
  // Workflows that must link a member, apply tags or enrol a sequence before
  // the event is visible use upsertContactWithStatus and publish after their
  // final mutation. This convenience path is for standalone contact upserts.
  if (row.created && input.client === undefined) {
    const { publishDomainEvent } = await import("./domainEvents");
    await publishDomainEvent("contact_created", {
      eventKey: `contact-created:${row.id}`,
      contactId: row.id,
      email: input.email.trim().toLowerCase(),
      name: (input.name ?? `${input.firstName ?? ""} ${input.lastName ?? ""}`).trim(),
      source: input.source ?? "",
    });
  }
  return row.id;
}

/**
 * Points a silo row at its contact.
 *
 * Only ever fills a blank. A row already attached to a contact stays attached:
 * re-pointing it would silently move a member's orders to a different person if
 * two addresses were ever confused, and that is not damage a later run can find.
 */
export async function linkContact(
  kind: LinkableKind,
  id: number,
  contactId: number,
  client?: Queryable
): Promise<void> {
  const db = client ?? pool;
  // The table name comes out of a fixed map keyed by a union type, so nothing a
  // caller passes can reach the statement as an identifier.
  const table = LINKABLE[kind];
  await db.query(
    `UPDATE ${table} SET contact_id = $2 WHERE id = $1 AND contact_id IS NULL`,
    [id, contactId]
  );
  if (kind === "member") {
    // A contact may have booked coaching before they created an account. Once
    // the identities meet, make those sessions visible in the member portal
    // without changing their stable CRM ownership.
    await db.query(
      `UPDATE coaching_sessions
          SET member_id = $1, updated_at = now()
        WHERE contact_id = $2 AND member_id IS NULL`,
      [id, contactId]
    );
  }
}

export interface ActivityInput {
  contactId: number;
  kind: string;
  title: string;
  body?: string;
  /** A soft reference for linking — never a join that has to resolve. */
  subjectType?: string;
  subjectId?: string | number;
  meta?: Record<string, unknown>;
  occurredAt?: Date;
  client?: Queryable;
}

/**
 * Appends to a contact's timeline and moves their "last active" stamp.
 *
 * The title and body are stored, not derived. A purchase recorded in 2026 has
 * to still read correctly after the offer it names is renamed or deleted, which
 * a join cannot promise.
 */
export async function recordActivity(input: ActivityInput): Promise<void> {
  const db = input.client ?? pool;
  await db.query(
    `INSERT INTO contact_activity
       (contact_id, kind, title, body, subject_type, subject_id, meta, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, COALESCE($8, now()))`,
    [
      input.contactId,
      input.kind.slice(0, 80),
      input.title.slice(0, 300),
      (input.body ?? "").slice(0, 4000),
      (input.subjectType ?? "").slice(0, 60),
      input.subjectId === undefined ? "" : String(input.subjectId).slice(0, 80),
      JSON.stringify(input.meta ?? {}),
      input.occurredAt ?? null,
    ]
  );

  // Only ever forward: a backdated import must not make somebody look less
  // recently active than they are.
  await db.query(
    `UPDATE contacts
        SET last_activity_at = GREATEST(COALESCE(last_activity_at, to_timestamp(0)), COALESCE($2, now())),
            updated_at = now()
      WHERE id = $1`,
    [input.contactId, input.occurredAt ?? null]
  );
}

/**
 * Adds tags to a contact, creating any that do not exist yet.
 *
 * Creating on demand is what lets an automation say "tag them bali-2027" without
 * somebody having built that tag by hand first — the alternative is a rule that
 * silently does nothing. The display name is derived from the slug so the tag
 * list stays readable until it is renamed.
 *
 * Returns how many tags the contact did not already have.
 */
export async function applyTags(
  contactId: number,
  tagSlugs: string[],
  appliedBy: string,
  client?: Queryable
): Promise<number> {
  const db = client ?? pool;
  const slugs = normaliseSlugs(tagSlugs);
  if (slugs.length === 0) return 0;

  await db.query(
    `INSERT INTO tags (name, slug)
     SELECT initcap(replace(slug, '-', ' ')), slug FROM unnest($1::citext[]) AS slug
     ON CONFLICT (slug) DO NOTHING`,
    [slugs]
  );

  const applied = await db.query<{ tag_id: number }>(
    `INSERT INTO contact_tags (contact_id, tag_id, applied_by)
     SELECT $1, t.id, $3 FROM tags t WHERE t.slug = ANY($2::citext[])
     ON CONFLICT (contact_id, tag_id) DO NOTHING
     RETURNING tag_id`,
    [contactId, slugs, appliedBy.slice(0, 120)]
  );

  if (applied.rows.length > 0 && client === undefined) {
    const [person, { publishDomainEvent }] = await Promise.all([
      pool.query<{ email: string; name: string }>(
        `SELECT email::text AS email, name FROM contacts WHERE id = $1`,
        [contactId],
      ),
      import("./domainEvents"),
    ]);
    for (const tag of applied.rows) {
      await publishDomainEvent("tag_added", {
        contactId,
        email: person.rows[0]?.email ?? "",
        name: person.rows[0]?.name ?? "",
        subjectId: tag.tag_id,
        source: appliedBy,
        facts: { tagId: tag.tag_id },
      });
    }
  }

  return applied.rowCount ?? 0;
}

/** Takes tags off a contact. Returns how many were actually removed. */
export async function removeTags(
  contactId: number,
  tagSlugs: string[],
  client?: Queryable
): Promise<number> {
  const db = client ?? pool;
  const slugs = normaliseSlugs(tagSlugs);
  if (slugs.length === 0) return 0;

  const removed = await db.query<{ tag_id: number }>(
    `DELETE FROM contact_tags ct
      USING tags t
      WHERE ct.tag_id = t.id AND ct.contact_id = $1 AND t.slug = ANY($2::citext[])
      RETURNING ct.tag_id`,
    [contactId, slugs]
  );

  if (removed.rows.length > 0 && client === undefined) {
    const [person, { publishDomainEvent }] = await Promise.all([
      pool.query<{ email: string; name: string }>(
        `SELECT email::text AS email, name FROM contacts WHERE id = $1`,
        [contactId],
      ),
      import("./domainEvents"),
    ]);
    for (const tag of removed.rows) {
      await publishDomainEvent("tag_removed", {
        contactId,
        email: person.rows[0]?.email ?? "",
        name: person.rows[0]?.name ?? "",
        subjectId: tag.tag_id,
        facts: { tagId: tag.tag_id },
      });
    }
  }

  return removed.rowCount ?? 0;
}

/**
 * The one spelling of a tag identifier.
 *
 * Duplicates within a single call are collapsed, so "tag them VIP and vip"
 * counts as one tag rather than reporting two applied.
 */
export function normaliseSlugs(slugs: string[]): string[] {
  const seen = new Set<string>();
  for (const raw of slugs) {
    const slug = raw
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80)
      .replace(/-+$/, "");
    if (slug) seen.add(slug);
  }
  return [...seen];
}
