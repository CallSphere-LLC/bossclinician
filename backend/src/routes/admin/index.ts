import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { requirePermission } from "../../services/permissions";
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
import { adminSequencesRouter, adminEmailTemplatesRouter } from "./sequences";
import { adminAutomationsV2Router } from "./automationsV2";
import { adminAffiliatesRouter } from "./affiliates";
import { adminSettingsV2Router } from "./settingsV2";
import { adminUsersRouter, adminInviteRouter } from "./adminUsers";
import { adminIntegrationsRouter } from "./integrations";
import { adminReportsRouter } from "./reports";
import { adminDashboardRouter } from "./dashboard";
import { adminAssessmentsRouter } from "./assessments";
import { adminEventsRouter } from "./events";
import { adminFormsRouter as adminFormsV2Router } from "./formsV2";

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

// Login is unauthenticated; /me and everything else requires a valid JWT.
adminRouter.use("/", authRouter);

adminRouter.use("/stats", requireAuth, requirePermission("reports.view"), statsRouter);
adminRouter.use("/blog", requireAuth, requirePermission("website.view"), adminBlogRouter);
adminRouter.use("/courses", requireAuth, requirePermission("products.view"), adminCoursesRouter);
adminRouter.use("/testimonials", requireAuth, requirePermission("website.view"), adminTestimonialsRouter);
adminRouter.use("/resources", requireAuth, requirePermission("website.view"), adminResourcesRouter);
adminRouter.use("/pages", requireAuth, requirePermission("website.view"), adminPagesRouter);
adminRouter.use("/leads", requireAuth, requirePermission("contacts.view"), adminLeadsRouter);
adminRouter.use("/subscribers", requireAuth, requirePermission("contacts.view"), adminSubscribersRouter);
adminRouter.use("/settings", requireAuth, requirePermission("settings.view"), adminSettingsRouter);
adminRouter.use("/ai", requireAuth, requirePermission("website.view"), adminAiRouter);
adminRouter.use("/media", requireAuth, requirePermission("website.view"), adminMediaRouter);
adminRouter.use("/curriculum", requireAuth, requirePermission("products.view"), adminCurriculumRouter);
adminRouter.use("/members", requireAuth, requirePermission("contacts.view"), adminMembersRouter);
adminRouter.use("/community", requireAuth, requirePermission("community.view"), adminCommunityRouter);
adminRouter.use("/sales", requireAuth, requirePermission("orders.view"), adminSalesRouter);
adminRouter.use("/growth", requireAuth, requirePermission("marketing.view"), adminGrowthRouter);
adminRouter.use("/chats", requireAuth, requirePermission("contacts.view"), adminChatsRouter);
adminRouter.use("/products", requireAuth, requirePermission("products.view"), adminProductsRouter);
adminRouter.use("/offers", requireAuth, requirePermission("offers.view"), adminOffersRouter);
adminRouter.use("/redirects", requireAuth, requirePermission("website.view"), adminRedirectsRouter);
adminRouter.use("/contacts", requireAuth, requirePermission("contacts.view"), adminContactsRouter);
adminRouter.use("/tags", requireAuth, requirePermission("contacts.view"), adminTagsRouter);
adminRouter.use("/segments", requireAuth, requirePermission("contacts.view"), adminSegmentsRouter);
adminRouter.use("/sequences", requireAuth, requirePermission("marketing.view"), adminSequencesRouter);
adminRouter.use("/email-templates", requireAuth, requirePermission("marketing.view"), adminEmailTemplatesRouter);
// The original engine stays reachable at /growth/automations until its call
// sites are repointed; these two are different paths, not a replacement in place.
adminRouter.use("/automations", requireAuth, requirePermission("marketing.view"), adminAutomationsV2Router);
adminRouter.use("/affiliates", requireAuth, requirePermission("orders.view"), adminAffiliatesRouter);
adminRouter.use("/settings-v2", requireAuth, requirePermission("settings.view"), adminSettingsV2Router);
adminRouter.use("/admins", requireAuth, requirePermission("admins.view"), adminUsersRouter);
adminRouter.use("/integrations", requireAuth, requirePermission("settings.view"), adminIntegrationsRouter);
adminRouter.use("/reports", requireAuth, requirePermission("reports.view"), adminReportsRouter);
adminRouter.use("/dashboard", requireAuth, requirePermission("reports.view"), adminDashboardRouter);
adminRouter.use("/assessments", requireAuth, requirePermission("marketing.view"), adminAssessmentsRouter);
adminRouter.use("/events", requireAuth, requirePermission("marketing.view"), adminEventsRouter);
adminRouter.use("/forms-v2", requireAuth, requirePermission("marketing.view"), adminFormsV2Router);
// Accepting an invite happens BEFORE the invitee has an account, so this one
// router deliberately sits outside requireAuth. Its own token is the credential.
adminRouter.use("/", adminInviteRouter);
