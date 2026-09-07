import { createCrudRepo } from "./repo";

/**
 * Repositories for the growth suite (coaching, podcasts, newsletters,
 * campaigns, funnels, automations, forms, reports).
 *
 * The string arrays are write whitelists — a field absent here can never be
 * set from a request body, which is what keeps counters like `views`,
 * `run_count` and `recipient_count` server-owned.
 */

export interface Row {
  id: number;
}

export const coachingOffersRepo = createCrudRepo<Row>("coaching_offers", [
  "slug",
  "title",
  "description",
  "sessionCount",
  "durationMinutes",
  "priceCents",
  "currency",
  "stripePriceId",
  "format",
  "bookingUrl",
  "published",
  "sort",
]);

export const coachingSessionsRepo = createCrudRepo<Row>("coaching_sessions", [
  "offerId",
  "memberId",
  "scheduledAt",
  "durationMinutes",
  "status",
  "meetingUrl",
  "agenda",
  "privateNotes",
]);

export const podcastsRepo = createCrudRepo<Row>("podcasts", [
  "slug",
  "title",
  "description",
  "coverImage",
  "author",
  "category",
  "language",
  "explicit",
  "visibility",
  "published",
]);

export const podcastEpisodesRepo = createCrudRepo<Row>("podcast_episodes", [
  "podcastId",
  "title",
  "slug",
  "description",
  "showNotesMd",
  "audioUrl",
  "audioBytes",
  "durationSeconds",
  "episodeNumber",
  "season",
  "published",
  "publishedAt",
]);

export const newslettersRepo = createCrudRepo<Row>("newsletters", [
  "slug",
  "name",
  "description",
  "access",
  "planId",
  "published",
]);

export const newsletterIssuesRepo = createCrudRepo<Row>("newsletter_issues", [
  "newsletterId",
  "subject",
  "previewText",
  "bodyMd",
  "status",
  "scheduledAt",
]);

export const campaignsRepo = createCrudRepo<Row>("email_campaigns", [
  "name",
  "subject",
  "previewText",
  "bodyMd",
  "audience",
  "status",
  "scheduledAt",
  // A newsletter is a kind of broadcast, not a separate system — see
  // migration 021. The column drives what the editor suggests, nothing more.
  "kind",
]);

export const funnelsRepo = createCrudRepo<Row>("funnels", [
  "slug",
  "name",
  "description",
  "kind",
  "published",
]);

export const funnelStepsRepo = createCrudRepo<Row>("funnel_steps", [
  "funnelId",
  "name",
  "slug",
  "stepType",
  "headline",
  "bodyMd",
  "ctaLabel",
  "ctaUrl",
  "sort",
]);

export const automationsRepo = createCrudRepo<Row>("automations", [
  "name",
  "description",
  "triggerType",
  "conditions",
  "status",
], ["conditions"]);

export const automationActionsRepo = createCrudRepo<Row>("automation_actions", [
  "automationId",
  "actionType",
  "config",
  "sort",
], ["config"]);

export const formsRepo = createCrudRepo<Row>("forms", [
  "slug",
  "name",
  "description",
  "fields",
  "submitLabel",
  "successMessage",
  "createLead",
  "published",
], ["fields"]);

export const savedReportsRepo = createCrudRepo<Row>("saved_reports", ["name", "kind", "config"], ["config"]);
