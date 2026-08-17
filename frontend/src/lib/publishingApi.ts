import { memberRequest } from "@/lib/memberApi";

/**
 * Podcast and newsletter client — the two things that arrive on a schedule
 * rather than being sat down with.
 *
 * They share a file because they share a member concern: what am I subscribed
 * to, and how do I get it. Kept off `memberApi.ts` so that file stays the one
 * copy of the token and refresh logic.
 */

export interface PodcastEpisode {
  id: number;
  title: string;
  description: string;
  audioUrl: string;
  durationSeconds: number;
  episodeNumber: number | null;
  season: number;
  publishedAt: string | null;
}

export interface MemberPodcast {
  id: number;
  slug: string;
  title: string;
  description: string;
  coverImage: string;
  author: string;
  visibility: "public" | "private";
  episodeCount: number;
  latestEpisodeAt: string | null;
  /**
   * Absolute RSS URL. For a private show it carries this member's own token,
   * which makes it a credential — the page says so in as many words.
   */
  feedUrl: string;
  /** True when `feedUrl` is personal to this member and must not be shared. */
  personal: boolean;
  episodes: PodcastEpisode[];
}

export interface NewsletterIssue {
  id: number;
  newsletterId: number;
  newsletterName: string;
  subject: string;
  previewText: string;
  sentAt: string | null;
  bodyMd: string;
}

export interface NewsletterPublication {
  id: number;
  slug: string;
  name: string;
  description: string;
  subscribed: boolean;
  issueCount: number;
  latestIssueAt: string | null;
}

/**
 * A kind of email rather than a publication: reminders, community digests,
 * product news. Granular so "unsubscribe" can mean one of these rather than
 * all of them, which is what a single global switch always ends up meaning.
 */
export interface EmailTopic {
  topic: string;
  label: string;
  description: string;
  subscribed: boolean;
  /** Set on the topics that carry things the member paid for. */
  essential: boolean;
}

export interface NewsletterHome {
  publications: NewsletterPublication[];
  topics: EmailTopic[];
  issues: NewsletterIssue[];
}

export const publishingApi = {
  podcasts: () => memberRequest<MemberPodcast[]>("/member/podcasts"),

  /** Replaces a personal feed token, killing the old link everywhere. */
  rotateFeedUrl: (podcastId: number) =>
    memberRequest<{ feedUrl: string }>(`/member/podcasts/${podcastId}/feed/rotate`, {
      method: "POST",
    }),

  newsletters: () => memberRequest<NewsletterHome>("/member/newsletters"),

  setPublicationSubscribed: (newsletterId: number, subscribed: boolean) =>
    memberRequest<NewsletterPublication>(`/member/newsletters/${newsletterId}/subscription`, {
      method: "PATCH",
      body: JSON.stringify({ subscribed }),
    }),

  setTopicSubscribed: (topic: string, subscribed: boolean) =>
    memberRequest<EmailTopic>("/member/email-preferences", {
      method: "PATCH",
      body: JSON.stringify({ topic, subscribed }),
    }),
};
