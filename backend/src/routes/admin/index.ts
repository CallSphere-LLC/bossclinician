import { NextFunction, Request, Response, Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { requirePermission, type Module } from "../../services/permissions";
import { authRouter } from "./auth";
import { statsRouter } from "./stats";
import { adminBlogRouter } from "./blog";
import { adminCoursesRouter } from "./courses";
import { adminTestimonialsRouter } from "./testimonials";
import { adminResourcesRouter } from "./resources";
import { adminPagesRouter } from "./pages";
import { adminLeadsRouter } from "./leads";
import { adminSubscribersRouter } from "./subscribers";
import { adminSettingsRouter } from "./settings";
import { adminAiRouter } from "./ai";
import { adminMediaRouter } from "./media";
import { adminCurriculumRouter } from "./curriculum";
import { adminMembersRouter } from "./members";
import { adminCommunityRouter } from "./community";
import { adminSalesRouter } from "./sales";
import { adminGrowthRouter } from "./growth";
import { adminChatsRouter } from "./chats";
import { adminProductsRouter } from "./products";
import { adminOffersRouter } from "./offers";
import { adminRedirectsRouter } from "./redirects";
import { adminContactsRouter } from "./contacts";
import { adminTagsRouter } from "./tags";
import { adminSegmentsRouter } from "./segments";
import {
  adminSequencesRouter,
  adminEmailTemplatesRouter,
  adminSavedTemplatesRouter,
} from "./sequences";
import { adminAutomationsV2Router } from "./automationsV2";
import { adminAffiliatesRouter } from "./affiliates";
import { adminSettingsV2Router } from "./settingsV2";
import { adminSendingDomainRouter } from "./sendingDomain";
import { adminUsersRouter, adminInviteRouter } from "./adminUsers";
import { adminIntegrationsRouter } from "./integrations";
import { adminReportsRouter } from "./reports";
import { adminDashboardRouter } from "./dashboard";
import { adminAssessmentsRouter } from "./assessments";
import { adminEventsRouter } from "./events";
import { adminFormsRouter as adminFormsV2Router } from "./formsV2";
import { adminAvailabilityRouter } from "./availability";

export const adminRouter = Router();

/**
 * Every mount carries a permission as well as authentication.
 *
 * `requireAuth` only proves somebody is signed in, and this platform now has
 * five admin roles. Without a second gate a Coach account — created so a
 * contractor can run their own sessions — reaches the payments screens, the
 * contact list and the settings that hold API credentials.
 *
 * The gate here is deliberately the `view` permission: it decides whether a
 * module can be reached at all. Routers that need a finer distinction between
 * reading and changing apply `manage` per route inside themselves, because the
 * difference between listing orders and refunding one is not expressible at a
 * mount point.
 */

/**
 * A module gate that tells a read from a write.
 *
 * Most of the routers below predate the roles matrix and carry no permission of
 * their own, so mounting them on `view` alone was enough to let a Support
 * account — which holds `products.view` and `offers.view` so it can answer
 * "what did they actually buy" — edit a course's price, and to let anyone who
 * could open the contact list delete every row in it. Reads keep the view
 * permission; anything that is not a read is held to `manage`.
 *
 * Routers that draw the line more finely than "read or write" — orders,
 * members, settings-v2, admins — keep their own per-route guards and are
 * mounted on `view` as before.
 *
 * The one mount where this gate changes what somebody can do today is
 * `/reports`. Marketing holds `reports.view` so a campaign can be measured, and
 * not `reports.manage`; on a bare `reports.view` mount that account could also
 * create, rename and delete saved views and queue a full rebuild of the
 * warehouse. Reading the numbers is the capability the role is described as
 * having ("Seeing how it all performed"), so the writes go behind `manage`.
 * Everywhere else the gate is belt and braces: every role that can currently
 * reach those screens holds the matching `manage` too, so the change is a
 * closed door for a role added later rather than a capability taken away now.
 *
 * `/stats`, `/dashboard` and `/subscribers` are left on the plain `view`
 * permission deliberately — they expose no route that is not a GET, so a gate
 * there would be a comment pretending to be a control.
 */
function moduleGate(module: Module) {
  const view = requirePermission(`${module}.view`);
  const manage = requirePermission(`${module}.manage`);
  return (req: Request, res: Response, next: NextFunction): void => {
    (req.method === "GET" || req.method === "HEAD" ? view : manage)(req, res, next);
  };
}

const marketingGrowthGate = moduleGate("marketing");
const coachingGrowthGate = moduleGate("coaching");
function growthGate(req: Request, res: Response, next: NextFunction): void {
  (req.path.startsWith("/coaching/") ? coachingGrowthGate : marketingGrowthGate)(req, res, next);
}

/**
 * `admins.view` is the permission to administer *other people's* accounts, and
 * only the owner and a manager hold it. The `/me/...` routes under the same
 * router are the opposite of that: they are how an admin turns on their own
 * two-step sign-in, reads their own sessions and ends one from a lost laptop,
 * and every one of them is scoped to `actorId(req)` rather than to an id in the
 * path. Gating them on `admins.view` meant a Marketing, Support or Coach
 * account could never enable 2FA on itself — the security screen answered 403.
 */
function adminsGate(req: Request, res: Response, next: NextFunction): void {
  if (req.path.startsWith("/me/")) {
    next();
    return;
  }
  requirePermission("admins.view")(req, res, next);
}

// Login is unauthenticated; /me and everything else requires a valid JWT.
adminRouter.use("/", authRouter);

adminRouter.use("/stats", requireAuth, requirePermission("reports.view"), statsRouter);
adminRouter.use("/blog", requireAuth, moduleGate("website"), adminBlogRouter);
adminRouter.use("/courses", requireAuth, moduleGate("products"), adminCoursesRouter);
adminRouter.use("/testimonials", requireAuth, moduleGate("website"), adminTestimonialsRouter);
adminRouter.use("/resources", requireAuth, moduleGate("website"), adminResourcesRouter);
adminRouter.use("/pages", requireAuth, moduleGate("website"), adminPagesRouter);
adminRouter.use("/leads", requireAuth, moduleGate("contacts"), adminLeadsRouter);
adminRouter.use("/subscribers", requireAuth, requirePermission("contacts.view"), adminSubscribersRouter);
adminRouter.use("/settings", requireAuth, moduleGate("settings"), adminSettingsRouter);
adminRouter.use("/ai", requireAuth, moduleGate("website"), adminAiRouter);
adminRouter.use("/media", requireAuth, moduleGate("website"), adminMediaRouter);
adminRouter.use("/curriculum", requireAuth, moduleGate("products"), adminCurriculumRouter);
adminRouter.use("/members", requireAuth, requirePermission("contacts.view"), adminMembersRouter);
adminRouter.use("/community", requireAuth, moduleGate("community"), adminCommunityRouter);
adminRouter.use("/sales", requireAuth, requirePermission("orders.view"), adminSalesRouter);
adminRouter.use("/growth", requireAuth, growthGate, adminGrowthRouter);
adminRouter.use("/chats", requireAuth, moduleGate("contacts"), adminChatsRouter);
adminRouter.use("/products", requireAuth, moduleGate("products"), adminProductsRouter);
adminRouter.use("/offers", requireAuth, moduleGate("offers"), adminOffersRouter);
adminRouter.use("/redirects", requireAuth, moduleGate("website"), adminRedirectsRouter);
adminRouter.use("/contacts", requireAuth, moduleGate("contacts"), adminContactsRouter);
adminRouter.use("/tags", requireAuth, moduleGate("contacts"), adminTagsRouter);
adminRouter.use("/segments", requireAuth, moduleGate("contacts"), adminSegmentsRouter);
adminRouter.use("/sequences", requireAuth, moduleGate("marketing"), adminSequencesRouter);
adminRouter.use("/email-templates", requireAuth, moduleGate("marketing"), adminEmailTemplatesRouter);
// The admin's own reusable templates, distinct from the system store above.
adminRouter.use("/saved-templates", requireAuth, moduleGate("marketing"), adminSavedTemplatesRouter);
// The original engine stays reachable at /growth/automations until its call
// sites are repointed; these two are different paths, not a replacement in place.
adminRouter.use("/automations", requireAuth, moduleGate("marketing"), adminAutomationsV2Router);
adminRouter.use("/affiliates", requireAuth, moduleGate("orders"), adminAffiliatesRouter);
adminRouter.use("/settings-v2", requireAuth, requirePermission("settings.view"), adminSettingsV2Router);
adminRouter.use("/sending-domain", requireAuth, moduleGate("settings"), adminSendingDomainRouter);
adminRouter.use("/admins", requireAuth, adminsGate, adminUsersRouter);
adminRouter.use("/integrations", requireAuth, moduleGate("settings"), adminIntegrationsRouter);
adminRouter.use("/reports", requireAuth, moduleGate("reports"), adminReportsRouter);
adminRouter.use("/dashboard", requireAuth, requirePermission("reports.view"), adminDashboardRouter);
adminRouter.use("/assessments", requireAuth, moduleGate("marketing"), adminAssessmentsRouter);
adminRouter.use("/events", requireAuth, moduleGate("marketing"), adminEventsRouter);
adminRouter.use("/forms-v2", requireAuth, moduleGate("marketing"), adminFormsV2Router);
adminRouter.use("/availability", requireAuth, moduleGate("settings"), adminAvailabilityRouter);
// Accepting an invite happens BEFORE the invitee has an account, so this one
// router deliberately sits outside requireAuth. Its own token is the credential.
adminRouter.use("/", adminInviteRouter);
