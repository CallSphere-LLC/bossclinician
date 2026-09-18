import { pool } from "../db/pool";
import { env } from "../config/env";
import { badRequest, notFound } from "../utils/httpError";
import { generateToken, hashToken, expiresIn } from "../auth/tokens";
import { DEFAULT_TIMEZONE } from "./memberProfile";

/**
 * Host links — the admin's way into her own live room.
 *
 * The room (routes/member/communityLive.ts) admits member sessions and nothing
 * else, and an admin is not a member: a different table, a different origin, a
 * different cookie. Rather than teach the room and its signalling a second kind
 * of identity, the admin panel asks for a one-time link. Opening it signs that
 * browser into the customer site as the member account carrying the admin's
 * own email address, with a membership the room reads as a host, and lands her
 * in the room. Everything downstream — presence, the visit log, moderation —
 * is the ordinary member stack.
 *
 * The link is a `member_magic_links` row with `purpose = 'host'` (migration
 * 063). It is redeemed by POST /api/auth/host-link/consume, which is not behind
 * the magic-link setting, and by nothing else.
 *
 * The audit row is the caller's job, not this module's: it is written from the
 * request (services/adminAudit.ts takes identity from `req.user`), and it has
 * to be on disk before this function mints anything.
 */

/**
 * Two minutes. The link is never mailed or shown — the admin panel opens it the
 * moment it arrives — so it only has to outlive a redirect and a page load, and
 * anything longer is just a wider window for a URL sitting in browser history.
 */
export const HOST_LINK_TTL_SECONDS = 120;

/**
 * The membership role written for the host.
 *
 * `community_memberships.role` has no CHECK; its working vocabulary is
 * member | moderator | admin. The live room treats host | owner | moderator as
 * a host, and the feed treats moderator | admin as a moderator. 'moderator' is
 * the one value both agree on: a host in the room, and no stranger to the feed.
 */
export const HOST_MEMBERSHIP_ROLE = "moderator";

/** Roles the live room already reads as a host, and which are therefore left as found. */
const LIVE_HOST_ROLES = ["host", "owner", "moderator"] as const;

/** The same two statuses routes/auth/memberAuth.ts refuses a session to (`SIGN_IN_BLOCKED`). */
const SIGN_IN_BLOCKED = new Set(["suspended", "deleted"]);

export interface CreateHostLinkInput {
  adminId: number;
  adminEmail: string;
  adminName: string;
  communityId: number;
}

export interface HostLink {
  url: string;
  expiresInSeconds: number;
  memberId: number;
}

/**
 * First and last name out of the single `admin_users.name` field.
 *
 * The first word is the first name and the rest is the last, so "Mary Anne
 * Smith" errs towards a short first name — which is what the room greets her
 * by. An admin with no name at all gets the local part of her address, because
 * an empty first name renders as a blank tile label.
 */
export function splitHostName(name: string, email: string): { firstName: string; lastName: string } {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { firstName: email.split("@")[0] ?? "", lastName: "" };
  return { firstName: words[0], lastName: words.slice(1).join(" ") };
}

/**
 * The address the admin's browser is sent to. `next` is a path on the public
 * site, never a URL, so the page redeeming the link has nothing to validate
 * beyond "starts with a slash".
 */
export function buildHostLinkUrl(siteUrl: string, token: string, slug: string): string {
  const next = `/community/${slug}/live`;
  return `${siteUrl}/host-link?token=${encodeURIComponent(token)}&next=${encodeURIComponent(next)}`;
}

interface HostCommunityRow {
  id: number;
  slug: string;
  published: boolean;
  live_room_enabled: boolean;
}

interface HostMemberRow {
  id: number;
  status: string;
}

/**
 * The member account for this admin, created if she has never had one.
 *
 * `members.email` is citext, so the lookup is case-insensitive without help.
 * An existing account is used exactly as found — name, password and all — and
 * is only ever refused, never repaired: an admin whose member account was
 * suspended or deleted does not get it back as a side effect of opening a room.
 *
 * A new one has no password. She can set one through "forgot password" like any
 * imported member; until then the host link is the only way into it.
 */
async function findOrCreateHostMember(input: CreateHostLinkInput): Promise<number> {
  const { firstName, lastName } = splitHostName(input.adminName, input.adminEmail);

  // ON CONFLICT rather than select-then-insert, so two clicks in the same
  // instant produce one member and not a unique violation.
  const created = await pool.query<HostMemberRow>(
    `INSERT INTO members (email, name, first_name, last_name, timezone, status, email_verified_at)
     VALUES ($1, $2, $3, $4, $5, 'active', now())
     ON CONFLICT (email) DO NOTHING
     RETURNING id, status`,
    [input.adminEmail, `${firstName} ${lastName}`.trim(), firstName, lastName, DEFAULT_TIMEZONE]
  );
  if (created.rows[0]) return created.rows[0].id;

  const existing = await pool.query<HostMemberRow>(
    `SELECT id, status FROM members WHERE email = $1`,
    [input.adminEmail]
  );
  const member = existing.rows[0];
  if (!member) throw badRequest("We couldn't set up a member account for you. Please try again.");
  if (SIGN_IN_BLOCKED.has(member.status)) {
    throw badRequest(
      `The member account for ${input.adminEmail} is ${member.status}, so it can't be signed in to. Reactivate it under Members first.`
    );
  }
  return member.id;
}

/**
 * Mints the one-time link that takes an admin into a community's live room.
 *
 * Throws 404 for a community that does not exist and 400 for one whose room
 * cannot be entered, because a link that signs her in and then lands on "this
 * room is off" is worse than being told so in the admin panel.
 */
export async function createHostLink(input: CreateHostLinkInput): Promise<HostLink> {
  const found = await pool.query<HostCommunityRow>(
    `SELECT id, slug, published, live_room_enabled FROM communities WHERE id = $1`,
    [input.communityId]
  );
  const community = found.rows[0];
  if (!community) throw notFound("Community not found");
  if (!community.live_room_enabled) {
    throw badRequest("The live room is switched off for this community. Turn it on first.");
  }
  // The member-side room is only served for a published community.
  if (!community.published) {
    throw badRequest("This community isn't published yet, so its live room can't be opened.");
  }

  const memberId = await findOrCreateHostMember(input);

  // `source = 'manual'` is load-bearing, not bookkeeping: in a community that is
  // sold, services/access.ts only lets a membership open the door when it is
  // manual, automation or plan — a 'free' or refunded 'purchase' row would land
  // her on a 404. A role the room already reads as a host is left alone, so an
  // owner is never turned into a moderator; anything else, including the feed's
  // 'admin' (identical to 'moderator' everywhere it is read), becomes one. A
  // host is not held at the guidelines gate, nor kept out by a ban on the
  // account she is hosting from.
  await pool.query(
    `INSERT INTO community_memberships (community_id, member_id, role, source, guidelines_accepted_at)
     VALUES ($1, $2, $3, 'manual', now())
     ON CONFLICT (community_id, member_id) DO UPDATE
       SET role = CASE WHEN community_memberships.role = ANY($4::text[])
                       THEN community_memberships.role
                       ELSE EXCLUDED.role END,
           source = 'manual',
           banned_at = NULL,
           guidelines_accepted_at = COALESCE(community_memberships.guidelines_accepted_at, now())`,
    [community.id, memberId, HOST_MEMBERSHIP_ROLE, [...LIVE_HOST_ROLES]]
  );

  // One live host link at a time. Scoped to the purpose, so asking for a host
  // link never retires a sign-in link sitting in the same person's inbox.
  await pool.query(
    `UPDATE member_magic_links SET used_at = now()
      WHERE member_id = $1 AND purpose = 'host' AND used_at IS NULL`,
    [memberId]
  );

  const raw = generateToken();
  await pool.query(
    `INSERT INTO member_magic_links (member_id, token_hash, expires_at, purpose)
     VALUES ($1, $2, $3, 'host')`,
    [memberId, hashToken(raw), expiresIn(HOST_LINK_TTL_SECONDS)]
  );

  return {
    url: buildHostLinkUrl(env.publicSiteUrl, raw, community.slug),
    expiresInSeconds: HOST_LINK_TTL_SECONDS,
    memberId,
  };
}
