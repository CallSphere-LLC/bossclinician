import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, notFound } from "../../utils/httpError";
import { seriesView } from "../../services/communityEventSeries";
import { adminPreviewUrl, isProtectedRef } from "../../services/signedUrls";
import { FEED_SELECT, loadPostExtras, toPostJson, type FeedRow } from "../member/community";

// Mounted under the existing authenticated community module gate. Only GET is
// implemented; there is no member identity, auto-enrolment or last-seen write.
export const adminCommunityPreviewRouter = Router({ mergeParams: true });
const positiveId = z.coerce.number().int().positive().max(2147483647);
const querySchema = z.object({
  group: z.union([z.literal("all"), z.literal("none"), positiveId]).default("all"),
  channel: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
});

adminCommunityPreviewRouter.get("/", asyncHandler(async (req, res) => {
  const id = positiveId.safeParse(req.params.id);
  if (!id.success) throw notFound("Community not found");
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) throw badRequest("Invalid preview options");
  const { group, channel: selected, page } = parsed.data;
  const communityId = id.data;
  const community = (await pool.query(`SELECT c.*,
    (SELECT COUNT(*)::int FROM community_memberships cm JOIN members m ON m.id=cm.member_id
      WHERE cm.community_id=c.id AND cm.banned_at IS NULL AND m.status='active') AS member_count
    FROM communities c WHERE c.id=$1`, [communityId])).rows[0];
  if (!community) throw notFound("Community not found");
  const groups = (await pool.query(`SELECT g.*, o.slug AS checkout_slug, o.status AS offer_status,
    o.pricing_type,o.amount_cents,o.currency,o.interval,o.installment_count,o.trial_days
    FROM community_access_groups g LEFT JOIN offers o ON o.id=g.checkout_offer_id
    WHERE g.community_id=$1 ORDER BY g.sort,g.id`, [communityId])).rows;
  if (typeof group === "number" && !groups.some(g => g.id === group)) throw notFound("Access group not found");
  const groupIds = group === "all" ? groups.map(g => g.id) : group === "none" ? [] : [group];
  // A normal participant, with the selected access groups. Private channels
  // require an individual invitation and are deliberately not implied by a tier.
  const channels = (await pool.query(`SELECT ch.*, g.name AS access_group_name,
    (SELECT COUNT(*)::int FROM community_posts p WHERE p.channel_id=ch.id AND p.status='visible') AS post_count
    FROM community_channels ch LEFT JOIN community_access_groups g ON g.id=ch.access_group_id
    WHERE ch.community_id=$1 AND ch.visibility='public'
      AND (ch.access_group_id IS NULL OR ch.access_group_id=ANY($2::int[]))
    ORDER BY ch.sort,ch.id`, [communityId, groupIds])).rows;
  const channel = selected ? channels.find(c => c.slug === selected) : channels[0];
  if (selected && !channel) throw notFound("That channel is not visible with these preview access groups.");
  const previewPath = `/admin/community/${communityId}/preview`;
  const href = (slug?: string) => `${previewPath}?group=${group}${slug ? `&channel=${encodeURIComponent(slug)}` : ""}`;
  const groupJson = (g: typeof groups[number]) => ({ id:g.id,name:g.name,description:g.description,
    checkoutSlug:g.checkout_slug,pricingType:g.pricing_type,amountCents:g.amount_cents,currency:g.currency,
    interval:g.interval,installmentCount:g.installment_count,trialDays:g.trial_days });
  const overview = {
    community: { id:communityId,slug:community.slug,name:community.name,description:community.description,
      coverImage:community.cover_image,memberCount:community.member_count },
    membership: { role:"member",points:0,bio:"",headline:"",joinedAt:null,lastSeenAt:null,badges:[],nextBadge:null },
    channels: channels.map(ch => ({id:ch.id,slug:ch.slug,name:ch.name,description:ch.description,
      format:ch.format,visibility:ch.visibility,coverImage:ch.cover_image,accessGroupId:ch.access_group_id,
      accessGroupName:ch.access_group_name,viewModes:ch.view_modes ?? ["feed"],defaultViewMode:ch.default_view_mode ?? "feed",
      viewMode:ch.view_mode ?? "feed",postCount:ch.post_count,unreadCount:0,href:href(ch.slug)})),
    accessGroups: groups.filter(g => groupIds.includes(g.id)).map(groupJson),
    availableAccessGroups: groups.filter(g => !groupIds.includes(g.id) && g.offer_status === "published").map(groupJson),
    unreadTotal:0,unreadNotifications:0,
    guidelines: community.guidelines_md?.trim() ? {text:community.guidelines_md,pending:false} : null,
    liveRoom: community.live_room_enabled ? {enabled:true,label:community.live_room_alias || "Live room",href:`/community/${community.slug}/live`} : null,
  };
  let feed = null;
  if (channel) {
    const perPage = 20;
    const offset = (page-1)*perPage;
    const rows = (await pool.query<FeedRow>(`${FEED_SELECT} WHERE p.channel_id=$1 AND p.status='visible'
      ORDER BY p.pinned DESC,p.last_activity_at DESC,p.id DESC LIMIT $3 OFFSET $4`, [channel.id,communityId,perPage,offset])).rows;
    const extras = await loadPostExtras(rows.map(p => p.id), 0);
    const posts = await Promise.all(rows.map(async row => {
      // Never mint a member-scoped protected-media link for a synthetic identity.
      const post = toPostJson({...row,media_url:""}, 0, extras.reactions.get(row.id) ?? [], extras.polls.get(row.id));
      if (isProtectedRef(row.media_url)) {
        const asset = (await pool.query("SELECT id FROM media_assets WHERE url=$1 ORDER BY id DESC LIMIT 1", [row.media_url])).rows[0];
        post.mediaUrl = asset ? adminPreviewUrl({assetId:asset.id,adminUserId:Number(req.user?.sub),now:new Date()}).url : "";
      } else post.mediaUrl = row.media_url;
      return post;
    }));
    const total = Number(rows[0]?.total_count ?? 0);
    feed = {community:overview.community,channel:overview.channels.find(c => c.id===channel.id),posts,
      reactionEmoji:["👍","❤️","🎉","🙌","🔥","😂","💡","👀"],page,perPage,total,hasMore:offset+rows.length<total};
  }
  const now = new Date();
  const events = (await pool.query(`SELECT e.*,
    (SELECT COUNT(*)::int FROM community_event_rsvps r WHERE r.event_id=e.id AND r.status='going') AS going_count
    FROM community_events e WHERE e.community_id=$1 AND e.published
      AND (e.access_group_id IS NULL OR e.access_group_id=ANY($2::int[])) ORDER BY e.starts_at,e.id`, [communityId,groupIds])).rows
    .map(row => { const series = seriesView(row,now); return {id:row.id,title:row.title,description:row.description,
      startsAt:row.starts_at,nextStartsAt:series.nextStartsAt,recurring:series.recurring,recurrenceLabel:series.recurrenceLabel,
      occurrences:series.occurrences,durationMinutes:row.duration_minutes,locationUrl:row.location_url,
      goingCount:row.going_count,myStatus:null,attended:false,upcoming:series.upcoming}; })
    .filter(e=>e.upcoming).sort((a,b)=>Date.parse(a.nextStartsAt ?? "9999-01-01")-Date.parse(b.nextStartsAt ?? "9999-01-01"));
  const challenges = (await pool.query(`SELECT c.*,(SELECT COUNT(*)::int FROM community_challenge_entries e WHERE e.challenge_id=c.id) AS entry_count
    FROM community_challenges c WHERE c.community_id=$1 AND c.published ORDER BY COALESCE(c.ends_at,c.starts_at,c.created_at) DESC`, [communityId])).rows
    .map(c=>({id:c.id,title:c.title,description:c.description,coverImage:c.cover_image,startsAt:c.starts_at,endsAt:c.ends_at,
      points:c.points,entryCount:c.entry_count,open:(!c.starts_at||c.starts_at<=now)&&(!c.ends_at||c.ends_at>=now),myEntry:null}));
  const leaderboard = (await pool.query(`SELECT cm.member_id,cm.points,cm.headline,
    COALESCE(NULLIF(TRIM(m.first_name || ' ' || m.last_name),''),NULLIF(m.name,''),'Member') AS name,
    COALESCE(m.avatar_url,'') AS avatar_url,RANK() OVER (ORDER BY cm.points DESC) AS rank,
    COUNT(*) OVER (PARTITION BY cm.points)>1 AS tied,
    (SELECT b.emoji FROM community_badges b WHERE b.community_id=cm.community_id AND b.threshold<=cm.points ORDER BY b.threshold DESC LIMIT 1) AS badge
    FROM community_memberships cm JOIN members m ON m.id=cm.member_id
    WHERE cm.community_id=$1 AND cm.banned_at IS NULL AND m.status='active' AND cm.points>0 ORDER BY cm.points DESC LIMIT 20`,[communityId])).rows
    .map(r=>({memberId:r.member_id,name:r.name,avatarUrl:r.avatar_url,headline:r.headline,points:r.points,rank:Number(r.rank),tied:r.tied,badge:r.badge,mine:false}));
  res.set("Cache-Control","no-store").json({overview,feed,events,challenges,
    leaderboard:{period:"all",periods:{week:false,month:false,all:community.leaderboard_all_time!==false},leaderboard:community.leaderboard_all_time===false?[]:leaderboard,me:null},
    groups:groups.map(g=>({id:g.id,name:g.name})),published:community.published,archived:!!community.archived_at});
}));
