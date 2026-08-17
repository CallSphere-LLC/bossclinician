import { Navigate, useParams } from "react-router-dom";
import { CommunityLayout } from "@/components/community/CommunityLayout";
import { ChannelFeed } from "@/components/community/ChannelFeed";

/**
 * `/community/:slug/:channelSlug` — one channel's feed.
 *
 * A thin adapter on purpose. The layout resolves the community and the role,
 * and `ChannelFeed` does the reading and writing; this file exists to turn two
 * URL segments into those two props, and there is nothing else it should know.
 *
 * The channel is not validated here. `ChannelFeed` asks the API for it, and the
 * API answers 404 for a channel that does not exist and the same 404 for a
 * private one this member is not entitled to see. Guessing at the difference on
 * this side would only produce a second, weaker answer.
 */
export default function CommunityChannel() {
  const { slug, channelSlug } = useParams<{ slug: string; channelSlug: string }>();

  if (!slug) return <Navigate to="/community" replace />;
  if (!channelSlug) return <Navigate to={`/community/${slug}`} replace />;

  return (
    <CommunityLayout slug={slug} activeChannel={channelSlug}>
      {(overview) => (
        <ChannelFeed
          // Keyed on the channel so switching rooms remounts the feed rather
          // than reusing its scroll position, its page counter and its
          // half-finished draft in a different conversation.
          key={channelSlug}
          communitySlug={slug}
          channelSlug={channelSlug}
          role={overview.membership.role}
        />
      )}
    </CommunityLayout>
  );
}
