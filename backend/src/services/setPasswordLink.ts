import { pool } from "../db/pool";
import { expiresIn, generateToken, hashToken } from "../auth/tokens";
import { sendMail } from "../email/mailer";
import { setPassword } from "../email/memberTemplates";

/**
 * The set-password link for an account that exists but has never had a password.
 *
 * Three flows create such an account — a guest checkout, an admin adding a
 * member, an automation capturing a lead — and each of them needs to send the
 * same email. Keeping it here means one TTL, one rate ceiling and one template
 * rather than a copy per caller that quietly drifts.
 *
 * A day, not the hour that routes/auth/memberAuth.ts gives a self-service reset:
 * the buyer of a course did not ask for this email and is not sitting on a form
 * waiting for it, and the link is the only way into an account that already owns
 * something they paid for.
 */
export const SET_PASSWORD_TTL_MINUTES = 24 * 60;

/**
 * Matches the ceiling the reset endpoint enforces. Nothing that reaches this
 * function is unauthenticated, but a retry storm on a webhook should not turn
 * into a mailbox full of live keys to the same door either.
 */
const WINDOW_MINUTES = 15;
const MAX_PER_WINDOW = 5;

/**
 * Emails a set-password link to a member. Returns false when nothing was sent.
 *
 * Fire-and-forget by contract: the caller has already taken the customer's money
 * and must not fail because SMTP did, so every outcome is a boolean and never an
 * exception.
 */
export async function sendSetPasswordLink(memberId: number): Promise<boolean> {
  try {
    const memberRes = await pool.query<{ email: string; first_name: string }>(
      `SELECT email, first_name FROM members WHERE id = $1`,
      [memberId]
    );
    const member = memberRes.rows[0];
    if (!member || !member.email) return false;

    const recent = await pool.query<{ count: string }>(
      `SELECT count(*) AS count
         FROM member_password_resets
        WHERE member_id = $1
          AND created_at > now() - make_interval(mins => $2)`,
      [memberId, WINDOW_MINUTES]
    );
    if (Number(recent.rows[0]?.count ?? 0) >= MAX_PER_WINDOW) return false;

    // Outstanding links are burned first, so a forwarded or intercepted earlier
    // email stops working the moment a fresh one is sent.
    await pool.query(
      `UPDATE member_password_resets SET used_at = now()
        WHERE member_id = $1 AND used_at IS NULL`,
      [memberId]
    );

    const raw = generateToken();
    await pool.query(
      `INSERT INTO member_password_resets (member_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [memberId, hashToken(raw), expiresIn(SET_PASSWORD_TTL_MINUTES * 60)]
    );

    void sendMail({
      to: member.email,
      ...setPassword({
        firstName: member.first_name,
        token: raw,
        expiresInMinutes: SET_PASSWORD_TTL_MINUTES,
      }),
    });
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[setPasswordLink] could not send link:", (err as Error).message);
    return false;
  }
}
