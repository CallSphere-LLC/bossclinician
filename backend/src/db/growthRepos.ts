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
  "contactId",
  "scheduledAt",
  "durationMinutes",
  "status",
  "meetingUrl",
  "agenda",
  "privateNotes",
  // What the member reads after the call. Both columns have been on the table
  // since migration 003 and the member screen has always rendered them; without
  // these two entries nothing could ever put a word in either.
  "sharedNotes",
  "recordingUrl",
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
  "transcript",
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
  "folder",
  "subject",
  "subjectB",
  "abSplitPercent",
  "previewText",
  "bodyMd",
  "audience",
  "segmentId",
  "includeTagIds",
  "excludeSegmentIds",
  "excludeTagIds",
  "status",
  "scheduledAt",
  "timezone",
  // The event anchor (3.3) is deliberately NOT writable through generic CRUD.
  //
  // Arming one has to stamp `anchor_armed_at` from the server clock — that
  // stamp is the whole backlog guard, since the sweeper refuses any send whose
  // moment was already past when the campaign was armed. A CRUD PUT that could
  // set `anchorKind` and `anchorEventId` without it would leave an anchor with
  // no arming moment, which is exactly the state the guard cannot reason about.
  // POST /campaigns/:id/schedule-event sets all four together, or none.
]);

export const funnelsRepo = createCrudRepo<Row>("funnels", [
  "slug",
  "name",
  "description",
  "kind",
  "published",
  "formId",
  "tagId",
  "sequenceId",
  "offerId",
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
