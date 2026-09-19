import { z } from "zod";
import { env } from "../config/env";
import { pool } from "../db/pool";
import { sendEmail } from "../email/provider";

const payloadSchema = z.object({ membershipId: z.coerce.number().int().positive() });

/** A durable access notice. Resolve current access and address when the job runs. */
export async function sendCommunityMembershipWelcome(payload: Record<string, unknown>) {
  const { membershipId } = payloadSchema.parse(payload);
  const result = await pool.query<{
    member_id: number; email: string; contact_id: number | null;
    community_name: string; community_slug: string;
  }>(
    `SELECT cm.member_id, m.email::text AS email, m.contact_id,
            c.name AS community_name, c.slug::text AS community_slug
       FROM community_memberships cm
       JOIN members m ON m.id = cm.member_id
       JOIN communities c ON c.id = cm.community_id
      WHERE cm.id = $1 AND cm.banned_at IS NULL AND m.status IN ('active', 'invited')`,
    [membershipId],
  );
  const recipient = result.rows[0];
  if (!recipient) return { outcome: "skipped", reason: "Membership is no longer active" };

  // The worker can retry after sending but before recording job success.
  const sent = await pool.query(
    `SELECT id FROM email_messages
      WHERE source_type = 'transactional' AND topic = 'community_membership'
        AND source_id = $1 AND status IN ('sent', 'delivered', 'bounced', 'complained') LIMIT 1`,
    [membershipId],
  );
  if (sent.rowCount) return { outcome: "already_sent" };

  const url = `${env.publicSiteUrl}/community/${encodeURIComponent(recipient.community_slug)}`;
  return sendEmail({
    to: recipient.email,
    subject: `You've been added to ${recipient.community_name}`,
    text: `You've been added to ${recipient.community_name} on Boss Clinician.\n\nOpen your community: ${url}\n\nSign in with this email address to get started.`,
    memberId: recipient.member_id,
    contactId: recipient.contact_id,
    sourceType: "transactional",
    sourceId: membershipId,
    topic: "community_membership",
  });
}
