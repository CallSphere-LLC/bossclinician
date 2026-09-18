import { pool } from "../db/pool";
import { renderMarkdown, sendEmail } from "../email/provider";
import { MAILABLE_CONTACT_SQL } from "./audience";
import { upsertContact } from "./contacts";

/**
 * Sending a newsletter issue — by hand from the admin, or on its schedule.
 *
 * This was the body of `POST /admin/growth/issues/:id/send` and nothing else
 * could reach it, so an issue saved as "scheduled" stayed scheduled for ever:
 * the status and the date were stored and no job ever read them. The route and
 * the `newsletter.sendScheduled` job (jobs/newsletterJobs.ts) now share it.
 *
 * In both paths the issue is marked sent *before* a single copy leaves, and the
 * statement that marks it is the claim: only the caller whose UPDATE moved the
 * row mails anybody. Two clicks on Send, two workers ticking in the same
 * second, or a redelivered job then produce one issue in each inbox, not two.
 */

/** Issues claimed per tick. Each one is a whole list's worth of mail. */
const BATCH = 20;

/** As much of an issue, and the newsletter it belongs to, as a send needs. */
export interface IssueForSend {
  id: number;
  status: string;
  subject: string;
  body_md: string;
  /** free | paid — the newsletter's, not the issue's. */
  access: string;
  plan_id: number | null;
}

const ISSUE_FOR_SEND_SQL = `SELECT i.id, i.status, i.subject, i.body_md, n.access, n.plan_id
         FROM newsletter_issues i
         JOIN newsletters n ON n.id = i.newsletter_id`;

export type SendIssueResult =
  | { outcome: "not_found" }
  | { outcome: "already_sent" }
  | {
      outcome: "sending";
      recipients: number;
      /** Settles once every copy has been attempted; never rejects. */
      delivery: Promise<number>;
    };

/**
 * The addresses an issue goes to.
 *
 * Free newsletters go to the email list; paid ones only to members with an
 * active subscription on the linked plan, so a paid issue can't leak to the
 * free list.
 */
export async function issueRecipients(issue: IssueForSend): Promise<string[]> {
  const recipients =
    issue.access === "paid" && issue.plan_id
      ? await pool.query<{ email: string }>(
          `SELECT DISTINCT s.email FROM subscriptions s
            WHERE s.plan_id = $1 AND s.status IN ('active','trialing') AND s.email <> ''`,
          [issue.plan_id],
        )
      : // A free issue goes to the email list, which is the same set of people
        // a broadcast reaches. Reading `subscribers` here sent it to whoever
        // had used the public newsletter form and nobody else.
        await pool.query<{ email: string }>(
          `SELECT c.email FROM contacts c WHERE ${MAILABLE_CONTACT_SQL}`,
        );

  return recipients.rows.map((r) => String(r.email));
}

/**
 * Mails one issue to each address, and answers with how many left.
 *
 * Every copy goes through `sendEmail` rather than `sendMail`. A newsletter is a
 * commercial email, so it has to carry the postal address and the unsubscribe
 * link, and it must not go to an address on the suppression list — none of
 * which `sendMail` knows anything about. The contact is resolved first because
 * the opt-out link is addressed to one.
 */
export async function deliverIssue(issue: IssueForSend, emails: string[]): Promise<number> {
  const body = String(issue.body_md ?? "");
  let sent = 0;
  for (const email of emails) {
    try {
      const contactId = await upsertContact({ email, source: "newsletter" });
      const result = await sendEmail({
        to: email,
        subject: String(issue.subject ?? ""),
        text: body,
        html: renderMarkdown(body),
        contactId,
        // `sourceId` is deliberately null, and it is not an oversight.
        //
        // Everything downstream reads (`source_type`, `source_id`) as one
        // key, and for `broadcast` that key means one row in
        // `email_campaigns`: routes/public/emailWebhook.ts adds every open,
        // click and bounce to the campaign with that id, and
        // services/reports/rollup.ts dimensions it as `broadcast:<id>`. A
        // newsletter id is drawn from a different sequence entirely, so
        // sending the issue's newsletter id here credited whichever
        // campaign happened to share the number — an email Yvette may never
        // have sent — and there is no way to unpick the two afterwards.
        // Anonymous is wrong but harmless; misattributed is neither.
        //
        // The proper fix is a `newsletter` source type carried end to end,
        // which needs the CHECK on email_messages.source_type widened,
        // EmailSourceType in email/provider.ts, the two source lists in
        // services/reports/rollup.ts and the label map in
        // services/reports/queries.ts — all outside this pass's remit. It is
        // written up in docs/bugs/backend-growth.md.
        sourceType: "broadcast",
        sourceId: null,
        topic: "marketing",
      });
      if (result.outcome === "sent") sent += 1;
    } catch {
      // One bad address must not cost the rest of the list its issue.
    }
  }
  return sent;
}

/**
 * The manual send: "Send now" on an issue, whatever state it was saved in.
 *
 * The recipients are read first so the count can go down in the same statement
 * as the claim. `status <> 'sent'` in that statement is what makes a second
 * click, or the scheduled job reaching the same issue in the same moment, a
 * refusal rather than a second send.
 *
 * Delivery is handed back rather than awaited: a large list must not hold the
 * request open.
 */
export async function sendIssueNow(issueId: number): Promise<SendIssueResult> {
  const found = await pool.query<IssueForSend>(`${ISSUE_FOR_SEND_SQL} WHERE i.id = $1`, [issueId]);
  const issue = found.rows[0];
  if (!issue) return { outcome: "not_found" };
  if (issue.status === "sent") return { outcome: "already_sent" };

  const emails = await issueRecipients(issue);

  const claimed = await pool.query(
    `UPDATE newsletter_issues
        SET status = 'sent', sent_at = now(), recipient_count = $2, updated_at = now()
      WHERE id = $1 AND status <> 'sent'`,
    [issue.id, emails.length],
  );
  if ((claimed.rowCount ?? 0) === 0) return { outcome: "already_sent" };

  return { outcome: "sending", recipients: emails.length, delivery: deliverIssue(issue, emails) };
}

/**
 * Claims the scheduled issues whose time has come.
 *
 * `RETURNING` on the UPDATE is what makes the claim atomic: the rows this
 * worker gets back are exactly the rows it moved from scheduled to sent, so no
 * second worker — and no click on "Send now" — can be holding the same one.
 */
async function claimDueIssues(): Promise<number[]> {
  const res = await pool.query<{ id: number }>(
    `WITH due AS (
       SELECT i.id
         FROM newsletter_issues i
        WHERE i.status = 'scheduled'
          AND i.scheduled_at IS NOT NULL
          AND i.scheduled_at <= now()
        ORDER BY i.scheduled_at
        LIMIT $1
        FOR UPDATE SKIP LOCKED
     )
     UPDATE newsletter_issues i
        SET status = 'sent', sent_at = now(), updated_at = now()
       FROM due
      WHERE i.id = due.id
      RETURNING i.id`,
    [BATCH],
  );
  return res.rows.map((r) => r.id);
}

/** Reads a claimed issue and its audience, and records how many it is going to. */
async function prepareClaimedIssue(
  id: number,
): Promise<{ issue: IssueForSend; emails: string[] } | null> {
  // The join has to be a second read: RETURNING cannot reach `newsletters`,
  // and whether the issue is paid lives there.
  const found = await pool.query<IssueForSend>(`${ISSUE_FOR_SEND_SQL} WHERE i.id = $1`, [id]);
  const issue = found.rows[0];
  if (!issue) return null;
  const emails = await issueRecipients(issue);
  await pool.query(`UPDATE newsletter_issues SET recipient_count = $2 WHERE id = $1`, [
    id,
    emails.length,
  ]);
  return { issue, emails };
}

/**
 * Sends every scheduled issue that is due. The `newsletter.sendScheduled` job.
 *
 * Claim-then-send, as the reminder jobs do it, with one deliberate difference:
 * a claim is only put back while nobody has been mailed. Failing to read the
 * audience is that case, and the next tick retries it. Once copies are leaving,
 * a failure belongs to one address and is swallowed there — putting a
 * half-delivered issue back to "scheduled" would send it to the first half of
 * the list twice, which is worse than the second half getting it late.
 *
 * Delivery is awaited here, unlike the route: the job holds a renewed lease
 * rather than a visitor on a spinner, and the count it reports is only worth
 * having once the sends have happened.
 */
export async function sendScheduledIssues(): Promise<{ issues: number; sent: number }> {
  const ids = await claimDueIssues();
  let issues = 0;
  let sent = 0;

  for (const id of ids) {
    let prepared: { issue: IssueForSend; emails: string[] } | null;
    try {
      prepared = await prepareClaimedIssue(id);
    } catch (err) {
      await pool.query(
        `UPDATE newsletter_issues
            SET status = 'scheduled', sent_at = NULL, updated_at = now()
          WHERE id = $1`,
        [id],
      );
      console.error(
        `[jobs] scheduled newsletter issue ${id} could not be prepared:`,
        err instanceof Error ? err.message : err,
      );
      continue;
    }
    if (!prepared) continue;

    issues += 1;
    sent += await deliverIssue(prepared.issue, prepared.emails);
  }

  return { issues, sent };
}
