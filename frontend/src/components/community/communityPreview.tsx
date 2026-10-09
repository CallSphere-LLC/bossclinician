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
}

export const CommunityPreviewContext = createContext<CommunityPreviewData | null>(null);
export const useCommunityPreview = () => useContext(CommunityPreviewContext);
