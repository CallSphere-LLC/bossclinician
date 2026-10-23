import { createContext, useContext } from "react";
import type { ChannelFeedPage, CommunityOverview, CommunityEvent, Challenge, LeaderboardResponse } from "@/lib/communityApi";

/** An admin-only snapshot. It never creates a member session or membership. */
export interface CommunityPreviewData {
  overview: CommunityOverview;
  feed: ChannelFeedPage | null;
  events: CommunityEvent[];
  challenges: Challenge[];
  leaderboard: LeaderboardResponse;
  groups: { id: number; name: string }[];
  published: boolean;
  archived: boolean;
  /**
   * Opens the real community as the admin herself (a one-time host link), in
   * the channel being previewed and, given a post, on that post's replies. The
   * preview has no member identity and stays read-only; this is how the owner
   * posts or replies from it (QA row 168). Supplied by the page, not the API.
   */
  writeAsYourself?: (target?: { postId?: number }) => void;
}

export const CommunityPreviewContext = createContext<CommunityPreviewData | null>(null);
export const useCommunityPreview = () => useContext(CommunityPreviewContext);
