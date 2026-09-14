import { pool } from "../db/pool";
import { env } from "../config/env";
import { sendMail } from "../email/mailer";
import { escapeHtml } from "../email/templates";
import { withStoredTemplate } from "../email/templateStore";
import type { EmailContent } from "../email/memberTemplates";
import { readSetting } from "../services/settings";
import { sweepDunning } from "../services/dunning";
import { formatAmount } from "../utils/money";
import { registerHandler } from "./worker";

interface ReminderRow {
  id: number;
  email: string;
  name: string;
  plan_name: string;
  amount_cents: number;
  currency: string;
  due_at: Date;
}

function dateLabel(value: Date): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(value);
}

async function deliver(kind: "trial" | "upcoming", row: ReminderRow): Promise<void> {
  const amount = formatAmount(row.amount_cents, row.currency);
  const when = dateLabel(row.due_at);
  const firstName = row.name.trim().split(/\s+/)[0] || "there";
  const subject = kind === "trial"
    ? `Your free trial ends ${when}`
    : `Your ${amount} payment is coming up`;
  const sentence = kind === "trial"
    ? `Your free trial of ${row.plan_name} ends on ${when}. Your first ${amount} payment is due then.`
    : `Your next ${amount} payment for ${row.plan_name} is due on ${when}.`;
  const fallback: EmailContent = {
    subject,
    text: `Hi ${firstName},\n\n${sentence}\n\nYou can review the subscription or update your card in your billing portal.\n\n${env.publicSiteUrl}/account/billing`,
    html: `<p>Hi ${escapeHtml(firstName)},</p><p>${escapeHtml(sentence)}</p><p><a href="${env.publicSiteUrl}/account/billing">Review your billing details</a></p>`,
  };
  const content = await withStoredTemplate(
    kind === "trial" ? "trial_ending" : "upcoming_payment",
    { firstName, name: row.name, email: row.email, offer: row.plan_name, total: amount, date: when },
    fallback,
  );
  await sendMail({
    topic: kind === "trial" ? "trial_ending" : "upcoming_payment",
    sourceId: row.id,
    to: row.email,
    ...content,
  });
}

async function trialReminders(days: number): Promise<number> {
  if (days <= 0) return 0;
  const candidates = await pool.query<ReminderRow>(
    `SELECT s.id, s.email, COALESCE(NULLIF(m.name,''), split_part(s.email,'@',1)) AS name,
            COALESCE(NULLIF(o.title,''), NULLIF(p.name,''), 'your subscription') AS plan_name,
            s.amount_cents, s.currency, s.trial_ends_at AS due_at
       FROM subscriptions s
       LEFT JOIN members m ON m.id = s.member_id
       LEFT JOIN offers o ON o.id = s.offer_id
       LEFT JOIN plans p ON p.id = s.plan_id
      WHERE s.status = 'trialing' AND s.email <> ''
        AND s.trial_ends_at > now()
        AND s.trial_ends_at <= now() + make_interval(days => $1)
        AND s.trial_reminder_sent_at IS NULL
      ORDER BY s.trial_ends_at LIMIT 200`,
    [days],
  );
  let sent = 0;
  for (const row of candidates.rows) {
    const claimed = await pool.query(
      `UPDATE subscriptions SET trial_reminder_sent_at = now(), updated_at = now()
        WHERE id = $1 AND trial_reminder_sent_at IS NULL`,
      [row.id],
    );
    if (claimed.rowCount === 0) continue;
    try {
      await deliver("trial", row);
      sent += 1;
    } catch (error) {
      await pool.query(`UPDATE subscriptions SET trial_reminder_sent_at = NULL WHERE id = $1`, [row.id]);
      throw error;
    }
  }
  return sent;
}

async function upcomingReminders(days: number): Promise<number> {
  if (days <= 0) return 0;
  const candidates = await pool.query<ReminderRow>(
    `SELECT s.id, s.email, COALESCE(NULLIF(m.name,''), split_part(s.email,'@',1)) AS name,
            COALESCE(NULLIF(o.title,''), NULLIF(p.name,''), 'your subscription') AS plan_name,
            s.amount_cents, s.currency, s.current_period_end AS due_at
       FROM subscriptions s
       LEFT JOIN members m ON m.id = s.member_id
       LEFT JOIN offers o ON o.id = s.offer_id
       LEFT JOIN plans p ON p.id = s.plan_id
      WHERE s.status = 'active' AND s.email <> ''
        AND s.paused_at IS NULL AND NOT s.cancel_at_period_end
        AND s.current_period_end > now()
        AND s.current_period_end <= now() + make_interval(days => $1)
        AND s.upcoming_reminder_for IS DISTINCT FROM s.current_period_end
      ORDER BY s.current_period_end LIMIT 200`,
    [days],
  );
  let sent = 0;
  for (const row of candidates.rows) {
    const claimed = await pool.query(
      `UPDATE subscriptions SET upcoming_reminder_for = current_period_end, updated_at = now()
        WHERE id = $1 AND upcoming_reminder_for IS DISTINCT FROM current_period_end`,
      [row.id],
    );
    if (claimed.rowCount === 0) continue;
    try {
      await deliver("upcoming", row);
      sent += 1;
    } catch (error) {
      await pool.query(`UPDATE subscriptions SET upcoming_reminder_for = NULL WHERE id = $1`, [row.id]);
      throw error;
    }
  }
  return sent;
}

/**
 * The next instalment of a payment plan, a few days ahead.
 *
 * "3 x $1,250" is the charge a customer is likeliest to be caught out by, and it
 * is an upcoming payment as much as a membership renewal is. One reminder per
 * instalment, claimed on its own row.
 */
async function instalmentReminders(days: number): Promise<number> {
  if (days <= 0) return 0;
  const candidates = await pool.query<ReminderRow>(
    `SELECT i.id, pp.email, COALESCE(NULLIF(m.name,''), split_part(pp.email,'@',1)) AS name,
            COALESCE(NULLIF(o.title,''), 'your payment plan') AS plan_name,
            i.amount_cents, pp.currency, i.due_at
       FROM payment_plan_installments i
       JOIN payment_plans pp ON pp.id = i.payment_plan_id
       LEFT JOIN members m ON m.id = pp.member_id
       LEFT JOIN offers o ON o.id = pp.offer_id
      WHERE i.status = 'scheduled' AND pp.status = 'active' AND pp.email <> ''
        AND i.due_at > now()
        AND i.due_at <= now() + make_interval(days => $1)
        AND i.reminder_sent_at IS NULL
      ORDER BY i.due_at LIMIT 200`,
    [days],
  );
  let sent = 0;
  for (const row of candidates.rows) {
    const claimed = await pool.query(
      `UPDATE payment_plan_installments SET reminder_sent_at = now()
        WHERE id = $1 AND reminder_sent_at IS NULL`,
      [row.id],
    );
    if (claimed.rowCount === 0) continue;
    try {
      await deliver("upcoming", row);
      sent += 1;
    } catch (error) {
      await pool.query(`UPDATE payment_plan_installments SET reminder_sent_at = NULL WHERE id = $1`, [row.id]);
      throw error;
    }
  }
  return sent;
}

/** A whole number of days from the settings row, or the fallback. */
function reminderDays(value: unknown, fallback: number): number {
  const days = Number(value ?? fallback);
  return Number.isInteger(days) && days >= 0 ? days : fallback;
}

/**
 * The hourly reminder sweep.
 *
 * Each reminder has its own on/off switch in Settings → Payments, and a number of
 * days. Before the switches existed "0 days" was the only way to turn one off;
 * migration 046 turned every stored 0 into "off", and 0 still sends nothing.
 */
export async function sweepBillingReminders(): Promise<{ trial: number; upcoming: number; instalments: number }> {
  const settings = await readSetting("customer_payments");
  const trialDays = settings.sendTrialReminders === false ? 0 : reminderDays(settings.trialReminderDays, 3);
  const upcomingDays =
    settings.sendUpcomingPaymentReminders === false ? 0 : reminderDays(settings.upcomingPaymentReminderDays, 3);
  const [trial, upcoming, instalments] = await Promise.all([
    trialReminders(trialDays),
    upcomingReminders(upcomingDays),
    instalmentReminders(upcomingDays),
  ]);
  return { trial, upcoming, instalments };
}

export function registerBillingJobs(): void {
  registerHandler("billing.reminders", () => sweepBillingReminders());
  // Retries on the owner's schedule; a no-op while Stripe does the retrying.
  registerHandler("billing.dunning", () => sweepDunning());
}
