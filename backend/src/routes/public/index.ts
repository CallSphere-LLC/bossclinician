import { cartRouter } from "./cart";
import { Router } from "express";
import { healthRouter } from "./health";
import { pagesRouter } from "./pages";
import { blogRouter } from "./blog";
import { coursesRouter } from "./courses";
import { testimonialsRouter } from "./testimonials";
import { resourcesRouter } from "./resources";
import { settingsRouter } from "./settings";
import { leadsRouter } from "./leads";
import { subscribeRouter } from "./subscribe";
import { chatRouter } from "./chat";
import { communityLiveStreamRouter } from "./communityLiveStream";
import { checkoutRouter } from "./checkout";
import { offersRouter } from "./offers";
import { checkoutOfferRouter } from "./checkoutOffer";
import { checkoutRequirementsRouter } from "./checkoutRequirements";
import { stripeWebhookRouter } from "./stripeWebhook";
import { paypalWebhookRouter } from "./paypalWebhook";
import { growthPublicRouter } from "./growthPublic";
import { assessmentsPublicRouter } from "./assessmentsPublic";
import { eventsPublicRouter } from "./eventsPublic";
import { affiliateTrackingRouter } from "./affiliateTracking";
import { affiliateSignupRouter } from "./affiliateSignup";
import { emailWebhookRouter } from "./emailWebhook";
import { emailPrefsRouter } from "./emailPrefs";
import { redirectsRouter } from "./redirects";
import { verifyRouter } from "./verify";
import { retreatMediaRouter } from "./retreatMedia";
import { receiptLinkRouter } from "./receiptLink";
import { bookACallRouter } from "./bookACall";
import { clubBonusRouter } from "./clubBonus";
import { retreatsPublicRouter } from "./retreatsPublic";

export const publicRouter = Router();

publicRouter.use(healthRouter);
publicRouter.use(pagesRouter);
publicRouter.use(blogRouter);
publicRouter.use(coursesRouter);
publicRouter.use(testimonialsRouter);
publicRouter.use(resourcesRouter);
publicRouter.use(settingsRouter);
publicRouter.use(leadsRouter);
publicRouter.use(subscribeRouter);
publicRouter.use(chatRouter);
// Ticket-authenticated, not open: see the router's own note on why it is here.
publicRouter.use(communityLiveStreamRouter);
publicRouter.use(checkoutRouter);
publicRouter.use(offersRouter);
publicRouter.use(checkoutOfferRouter);
publicRouter.use(checkoutRequirementsRouter);
publicRouter.use(cartRouter);
publicRouter.use(stripeWebhookRouter);
publicRouter.use(paypalWebhookRouter);
publicRouter.use(growthPublicRouter);
publicRouter.use(assessmentsPublicRouter);
publicRouter.use(eventsPublicRouter);
publicRouter.use(bookACallRouter);
// The Club's Ramp-Up bonus status for /club and /club/checkout (migration 215).
publicRouter.use(clubBonusRouter);
publicRouter.use(affiliateTrackingRouter);
publicRouter.use(affiliateSignupRouter);
publicRouter.use(emailWebhookRouter);
publicRouter.use(emailPrefsRouter);
publicRouter.use(verifyRouter);
// Signed links to a retreat's private Memories gallery (sheet row 248).
publicRouter.use(retreatMediaRouter);
// /upcoming-retreats listing and the /retreat-interest sign-up (migration 223).
publicRouter.use(retreatsPublicRouter);
// Signed, expiring receipt PDF downloads: see services/receiptLinks.ts.
publicRouter.use(receiptLinkRouter);
publicRouter.use(redirectsRouter);
