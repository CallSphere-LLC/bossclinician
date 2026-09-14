import { pool } from "../db/pool";
import { generateToken, hashToken, expiresIn } from "../auth/tokens";
import { sendMail } from "../email/mailer";
import * as emails from "../email/memberTemplates";
import type { Queryable } from "./contacts";

/**
 * Email confirmation, in one place, because it was in two and they disagreed.
 *
 * There are two stores, and both are real:
 *
 *   `members.email_verified_at` — the ACCOUNT's confirmation. Somebody clicked
 *     a link that only arrived at that address. It is what gates posting,
 *     commenting and every point a member can earn (middleware/memberAuth.ts,
 *     `requireVerifiedEmail`).
 *
 *   `contacts.email_marketing_status = 'unconfirmed'` — the MAILING LIST's
 *     double opt-in state. It is a consent fact, set by the subscribe paths and
 *     cleared from the preference centre.
 *
 * Neither reflected the other, and a tester found the exact consequence: the
 * People screen's "Hasn't confirmed yet" filter reported 0 people while a member
 * sat blocked from posting, and his contact card read "Happy to hear from you"
 * because his consent row said `subscribed`. Two answers to one question, on two
 * screens, with nothing to reconcile them.
 *
 * This is the same class of bug as the two email-preference stores fixed in
 * ebfbb0a, and it gets the same treatment rather than a migration that merges
 * the columns: both stores are kept, because each records a different decision
 * somebody actually made, and every surface that asks "has this person
 * confirmed?" is made to read both. Where a confirmation is genuinely proved —
 * a member clicking their link, or an admin taking responsibility for it — the
 * proof is written to both.
 *
 * What is deliberately NOT done: the preference-centre link is not treated as
 * proof of the address. Its token never expires, on purpose, so that an
 * unsubscribe link found in a three-year-old email still works — which also
 * makes it exactly the wrong thing to confirm an account with.
 */

/* ------------------------------------------------------------- shared SQL */

/**
 * "This person hasn't confirmed their email", as one SQL predicate over `c`.
 *
 * Both stores, so the People list, the insights tile and the contact card
 * cannot give three different answers. A deleted account is excluded: an erased
 * row keeps a null `email_verified_at` forever and nobody can confirm it.
 */
export const CONTACT_UNCONFIRMED_SQL = `(
  c.email_marketing_status = 'unconfirmed'
  OR EXISTS (
    SELECT 1 FROM members m
     WHERE m.contact_id = c.id
       AND m.status <> 'deleted'
       AND m.email_verified_at IS NULL
  )
)`;

/**
 * The account behind a contact, for every contact read.
 *
 * Two scalar subqueries rather than a join, so it can be dropped into the
 * existing column list without changing the shape of any query that uses it;
 * `idx_members_contact` makes both a single index lookup. The oldest account
 * wins when a contact somehow has two, which is the same rule
 * `GET /admin/contacts/:id` already uses for `member_id`.
 */
export const CONTACT_ACCOUNT_SQL = `(SELECT m.id FROM members m
        WHERE m.contact_id = c.id AND m.status <> 'deleted'
        ORDER BY m.id LIMIT 1) AS account_member_id,
      (SELECT m.email_verified_at FROM members m
        WHERE m.contact_id = c.id AND m.status <> 'deleted'
        ORDER BY m.id LIMIT 1) AS account_email_verified_at`;

/* ------------------------------------------------------------------ state */

export type ConfirmationState =
  /** An account exists and the address is proved. */
  | "confirmed"
  /** An account exists and the address is not proved — they cannot post. */
  | "unconfirmed"
  /** No account, and the mailing list is still waiting for a double opt-in. */
  | "list_unconfirmed"
  /** No account, nothing pending. */
  | "no_account";

export interface ConfirmationFacts {
  /** `contacts.email_marketing_status`, or "" when read for a bare member. */
  contactStatus: string;
  /** The member account, when there is one. */
  memberId: number | null;
  /** `members.email_verified_at` as an ISO string, or null. */
  accountConfirmedAt: string | null;
}

export interface ConfirmationSummary extends ConfirmationFacts {
  state: ConfirmationState;
  /** True when nothing is waiting on a confirmation. */
  confirmed: boolean;
  /** Whether this person may post, comment and earn points right now. */
  canPost: boolean;
  /** One sentence for the admin card. */
  label: string;
  detail: string;
}

/**
 * The one derivation, so the API, the badge and the filter agree.
 *
 * A member account that has not confirmed is the answer that wins, because it is
 * the one with a consequence attached: whatever the consent row says, that
 * person is locked out of the community until it changes.
 */
export function summariseConfirmation(facts: ConfirmationFacts): ConfirmationSummary {
  const { contactStatus, memberId, accountConfirmedAt } = facts;

  if (memberId !== null && accountConfirmedAt === null) {
    return {
      ...facts,
      state: "unconfirmed",
      confirmed: false,
      canPost: false,
      label: "Hasn't confirmed their email",
      detail:
        "They have an account but have never clicked a confirmation link, so they can't post, " +
        "comment or earn points. Confirm it for them, or send the email again.",
    };
  }

  if (memberId !== null) {
    return {
      ...facts,
      state: "confirmed",
      confirmed: true,
      canPost: true,
      label: "Email confirmed",
      detail: "They confirmed this address, so they can post and comment.",
    };
  }

  if (contactStatus === "unconfirmed") {
    return {
      ...facts,
      state: "list_unconfirmed",
      confirmed: false,
      canPost: false,
      label: "Hasn't confirmed the mailing list",
      detail:
        "They joined the list but never clicked the confirmation link. They have no account yet.",
    };
  }

  return {
    ...facts,
    state: "no_account",
    confirmed: true,
    canPost: false,
    label: "No account yet",
    detail: "They're on your list but have never created an account.",
  };
}

function iso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

/** The confirmation picture for one contact, read from both stores. */
export async function confirmationForContact(contactId: number): Promise<ConfirmationSummary> {
  const res = await pool.query<{
    email_marketing_status: string;
    member_id: number | null;
    email_verified_at: Date | null;
  }>(
    `SELECT c.email_marketing_status,
            (SELECT m.id FROM members m
              WHERE m.contact_id = c.id AND m.status <> 'deleted'
              ORDER BY m.id LIMIT 1) AS member_id,
            (SELECT m.email_verified_at FROM members m
              WHERE m.contact_id = c.id AND m.status <> 'deleted'
              ORDER BY m.id LIMIT 1) AS email_verified_at
       FROM contacts c
      WHERE c.id = $1`,
    [contactId]
  );
  const row = res.rows[0];
  if (!row) {
    return summariseConfirmation({ contactStatus: "", memberId: null, accountConfirmedAt: null });
  }
  return summariseConfirmation({
    contactStatus: row.email_marketing_status,
    memberId: row.member_id === null ? null : Number(row.member_id),
    accountConfirmedAt: iso(row.email_verified_at),
  });
}

/** The same, from the member side, including the consent row when one is linked. */
export async function confirmationForMember(memberId: number): Promise<ConfirmationSummary> {
  const res = await pool.query<{
    id: number;
    email_verified_at: Date | null;
    contact_status: string | null;
  }>(
    `SELECT m.id, m.email_verified_at,
            (SELECT c.email_marketing_status FROM contacts c WHERE c.id = m.contact_id) AS contact_status
       FROM members m
      WHERE m.id = $1 AND m.status <> 'deleted'`,
    [memberId]
  );
  const row = res.rows[0];
  if (!row) {
    return summariseConfirmation({ contactStatus: "", memberId: null, accountConfirmedAt: null });
  }
  return summariseConfirmation({
    contactStatus: row.contact_status ?? "",
    memberId: Number(row.id),
    accountConfirmedAt: iso(row.email_verified_at),
  });
}

/* ------------------------------------------------------------ write-through */

/**
 * Lifts a contact out of `unconfirmed` because their account has been confirmed.
 *
 * Only ever out of `unconfirmed`. A contact who opted out, bounced or complained
 * stays exactly as they are: clicking a confirmation link proves the address is
 * theirs, which is not the same as asking to be marketed to again, and quietly
 * re-subscribing somebody on the strength of it is how a sending domain dies.
 */
export async function reflectConfirmationOnContact(
  memberId: number,
  client?: Queryable
): Promise<void> {
  const db = client ?? pool;
  await db.query(
    `UPDATE contacts AS c
        SET email_marketing_status = 'subscribed',
            opted_in_at = COALESCE(c.opted_in_at, now()),
            updated_at = now()
      WHERE c.id = (SELECT m.contact_id FROM members m WHERE m.id = $1)
        AND c.email_marketing_status = 'unconfirmed'`,
    [memberId]
  );
}

export interface AdminConfirmResult {
  /** False when the address was already confirmed, so the caller can say so. */
  changed: boolean;
  before: ConfirmationSummary;
  after: ConfirmationSummary;
}

/**
 * An admin taking responsibility for a member's address.
 *
 * This is the escape hatch the product could not function without. Confirmation
 * gates posting, commenting and points, so while mail is not arriving — an
 * unverified sending domain, an SES account on probation, a customer whose IT
 * department eats our mail — every member is permanently locked out of the
 * social half of the product with no way through. There was no override.
 *
 * Both stores are written, in one transaction, and the audit row is the callers'
 * job (routes/admin/contacts.ts, routes/admin/members.ts) because it is the only
 * place `req.user` exists. Outstanding verification links are retired: the
 * address is confirmed now, and a link still sitting in an inbox would otherwise
 * be a live token for an account state that no longer needs one.
 */
export async function confirmMemberEmailAsAdmin(memberId: number): Promise<AdminConfirmResult> {
  const before = await confirmationForMember(memberId);
  if (before.memberId === null) {
    throw new Error(`No live member account with id ${memberId}`);
  }
  if (before.accountConfirmedAt !== null) {
    // Still reflect onto the consent row: the two could have drifted before this
    // existed, and the point of the button is that afterwards they agree.
    await reflectConfirmationOnContact(memberId);
    const after = await confirmationForMember(memberId);
    return { changed: false, before, after };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE members
          SET email_verified_at = COALESCE(email_verified_at, now()),
              -- An invited row becomes a real account the moment its address is
              -- vouched for, exactly as the reset-password path does it.
              status = CASE WHEN status = 'invited' THEN 'active' ELSE status END,
              updated_at = now()
        WHERE id = $1 AND status <> 'deleted'`,
      [memberId]
    );
    await client.query(
      `UPDATE member_email_verifications SET used_at = now()
        WHERE member_id = $1 AND used_at IS NULL`,
      [memberId]
    );
    await reflectConfirmationOnContact(memberId, client);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }

  return { changed: true, before, after: await confirmationForMember(memberId) };
}

/**
 * The mailing list's own confirmation, for a contact with no account.
 *
 * The double opt-in equivalent of the above: somebody who joined the list and
 * never clicked, whose address the owner knows is good because she met them.
 */
export async function confirmContactListAsAdmin(contactId: number): Promise<AdminConfirmResult> {
  const before = await confirmationForContact(contactId);
  const updated = await pool.query(
    `UPDATE contacts
        SET email_marketing_status = 'subscribed',
            opted_in_at = COALESCE(opted_in_at, now()),
            consent_source = COALESCE(NULLIF(consent_source, ''), 'admin'),
            updated_at = now()
      WHERE id = $1 AND email_marketing_status = 'unconfirmed'`,
    [contactId]
  );
  return {
    changed: (updated.rowCount ?? 0) > 0,
    before,
    after: await confirmationForContact(contactId),
  };
}

/* ------------------------------------------------------- verification email */

export const EMAIL_VERIFICATION_TTL_MINUTES = 24 * 60;

/**
 * The durable per-account ceiling, counted in `member_email_verifications`.
 *
 * Same numbers the password-reset flow uses. Without it, resend-verification is
 * a button that sends mail from this domain to any unverified address as often
 * as the caller likes, and the IP rate limiter alone is defeated by changing IP.
 */
const RESEND_WINDOW_MINUTES = 15;
const RESEND_MAX_PER_WINDOW = 5;

/**
 * What a resend actually did, for the callers allowed to be told.
 *
 * "throttled" is its own answer rather than a failure: the ceiling is working as
 * designed, and somebody pressing the button a sixth time is owed "give the last
 * one a minute" rather than either a lie or an error.
 */
export type VerificationSendResult =
  | { state: "sent" }
  | { state: "throttled" }
  | { state: "failed"; error: string };

/**
 * Mints a confirmation link and mails it.
 *
 * Lives here rather than in routes/auth/memberAuth.ts because the admin now
 * needs it too: "send it again" on a contact card and the member's own "resend"
 * button have to mint the same token, retire the same outstanding links and
 * respect the same ceiling, and two copies of that would drift.
 */
export async function sendMemberVerificationEmail(
  member: { id: number; email: string; first_name: string },
  /**
   * Wait for the transport and report back. Off by default: on signup a slow
   * SMTP handshake must not decide how long the member waits for the page. An
   * explicit "send it again" is the opposite case — whoever pressed it is
   * waiting precisely to find out whether it worked.
   */
  options: { awaitDelivery?: boolean } = {}
): Promise<VerificationSendResult> {
  const recent = await pool.query<{ count: string }>(
    `SELECT count(*) AS count
       FROM member_email_verifications
      WHERE member_id = $1
        AND created_at > now() - make_interval(mins => $2)`,
    [member.id, RESEND_WINDOW_MINUTES]
  );
  if (Number(recent.rows[0]?.count ?? 0) >= RESEND_MAX_PER_WINDOW) return { state: "throttled" };

  // Supersede outstanding links rather than adding to them: each one lives 24
  // hours, so a day of resends would otherwise leave a day's worth of
  // simultaneously-valid tokens for the same address.
  await pool.query(
    `UPDATE member_email_verifications SET used_at = now()
      WHERE member_id = $1 AND used_at IS NULL`,
    [member.id]
  );

  const raw = generateToken();
  await pool.query(
    `INSERT INTO member_email_verifications (member_id, email, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [member.id, member.email, hashToken(raw), expiresIn(EMAIL_VERIFICATION_TTL_MINUTES * 60)]
  );

  const message = {
    topic: "email_confirmation",
    memberId: member.id,
    to: member.email,
    ...emails.verifyEmail({
      firstName: member.first_name,
      token: raw,
      expiresInMinutes: EMAIL_VERIFICATION_TTL_MINUTES,
    }),
  };

  if (!options.awaitDelivery) {
    // Fire and forget, as on signup. The delivery log in settings is where this
    // one's fate is read.
    void sendMail(message);
    return { state: "sent" };
  }

  const outcome = await sendMail(message);
  return outcome.sent ? { state: "sent" } : { state: "failed", error: outcome.error };
}
