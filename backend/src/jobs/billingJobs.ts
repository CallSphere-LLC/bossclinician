import { pool } from "../db/pool";
import { env } from "../config/env";
import { sendMail } from "../email/mailer";
import { escapeHtml } from "../email/templates";
import { withStoredTemplate } from "../email/templateStore";
import type { EmailContent } from "../email/memberTemplates";
import { readSetting } from "../services/settings";
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
  await sendMail({ to: row.email, ...content });
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

export async function sweepBillingReminders(): Promise<{ trial: number; upcoming: number }> {
  const settings = await readSetting("customer_payments");
  const trialDays = Number(settings.trialReminderDays ?? 3);
  const upcomingDays = Number(settings.upcomingPaymentReminderDays ?? 3);
  const [trial, upcoming] = await Promise.all([
    trialReminders(Number.isInteger(trialDays) ? trialDays : 3),
    upcomingReminders(Number.isInteger(upcomingDays) ? upcomingDays : 3),
  ]);
  return { trial, upcoming };
}

export function registerBillingJobs(): void {
  registerHandler("billing.reminders", () => sweepBillingReminders());
}
