import { pool } from "../db/pool";
import { automationIdentity, publishDomainEvent } from "../services/domainEvents";
import { registerHandler } from "./worker";

/**
 * Publishes community posts whose scheduled moment has arrived.
 *
 * The post is written in full when it is scheduled and simply held at
 * `status = 'scheduled'`, so this sweeper only flips a status and stamps a
 * time — there is nothing here that can fail halfway and leave a half-written
 * post in a channel.
 *
 * `created_at` is moved to the publication moment on purpose. The feed sorts by
 * it, and a post written a fortnight ago would otherwise appear already buried
 * under everything published since — which is the opposite of what scheduling
 * it was for.
 */
export async function publishScheduledPosts(): Promise<{ published: number }> {
  const published = await pool.query<{
    id: number;
    channel_id: number;
    member_id: number | null;
    author_name: string;
    community_id: number;
    community_slug: string;
  }>(
    `WITH due AS (
       UPDATE community_posts p
          SET status = 'visible',
              created_at = now(),
              last_activity_at = now(),
              updated_at = now()
        WHERE p.status = 'scheduled'
          AND p.publish_at IS NOT NULL
          AND p.publish_at <= now()
        RETURNING p.id, p.channel_id, p.member_id, p.author_name
     )
     SELECT d.*, ch.community_id, c.slug::text AS community_slug
       FROM due d
       JOIN community_channels ch ON ch.id = d.channel_id
       JOIN communities c ON c.id = ch.community_id`
  );

  /*
   * The domain event fires here rather than when the post was written, so an
   * automation on "posted in the community" runs when the post actually
   * appears. Keyed on the post, so a re-run of this sweeper cannot fire twice
   * — which matters because the UPDATE and this loop are not one transaction.
   */
  for (const row of published.rows) {
    const identity = row.member_id === null
      ? { contactId: null as number | null, email: "", name: row.author_name }
      : await automationIdentity(row.member_id, "", row.author_name);
    await publishDomainEvent("community_post_created", {
      eventKey: `community-post:${row.id}`,
      contactId: identity.contactId,
      email: identity.email,
      name: identity.name || row.author_name,
      subjectId: row.community_id,
      source: `community:${row.community_slug}`,
      facts: { postId: row.id, channelId: row.channel_id, communityId: row.community_id },
    });
  }

  return { published: published.rowCount ?? 0 };
}

export function registerCommunityJobs(): void {
  registerHandler("community.publishScheduled", () => publishScheduledPosts());
}
