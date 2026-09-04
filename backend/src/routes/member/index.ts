import { Router } from "express";
import { requireMember } from "../../middleware/memberAuth";
import { memberBillingRouter } from "./billing";
import { memberLibraryRouter } from "./library";
import { memberProgressRouter } from "./progress";
import { memberDownloadsRouter } from "./downloads";
import { memberCertificatesRouter } from "./certificates";
import { memberCommunityRouter } from "./community";
import { memberCommunityLiveRouter } from "./communityLive";
import { memberCoachingRouter } from "./coaching";
import { memberEventsRouter } from "./events";
import { memberPublishingRouter } from "./publishing";
import { memberAffiliateRouter } from "./affiliatePortal";

/**
 * `/api/member/*` — everything a signed-in customer can do.
 *
 * Authentication is applied once, here, rather than per sub-router: a new file
 * mounted below is protected by construction, so forgetting the middleware is
 * not a failure mode this surface has. Ownership checks still belong in each
 * handler — being signed in is not the same as being entitled to a given row.
 */
export const memberRouter = Router();

memberRouter.use(requireMember);

memberRouter.use("/billing", memberBillingRouter);
memberRouter.use("/library", memberLibraryRouter);
memberRouter.use("/certificates", memberCertificatesRouter);
memberRouter.use("/downloads", memberDownloadsRouter);
// Before the general community router, whose `/:slug` handler would
// otherwise swallow `/:slug/live` as a community named "live".
memberRouter.use("/community", memberCommunityLiveRouter);
memberRouter.use("/community", memberCommunityRouter);
memberRouter.use("/coaching", memberCoachingRouter);
memberRouter.use("/events", memberEventsRouter);
memberRouter.use("/affiliate", memberAffiliateRouter);

// Progress routes are keyed on a lesson rather than on the product it belongs
// to ("/lessons/:lessonId/progress"), so they sit at the root of the member
// surface instead of under /library. The player already holds a lesson id by
// the time it reports progress, and routing through the product slug would mean
// re-deriving one from the other on every ten-second heartbeat.
memberRouter.use(memberProgressRouter);

// Publishing serves two sibling surfaces — "/podcasts" and "/newsletters" —
// plus the "/email-preferences" toggle they share, so like progress above it
// declares whole member-surface paths and mounts at the root rather than under
// a prefix of its own.
memberRouter.use(memberPublishingRouter);
