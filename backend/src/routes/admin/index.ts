import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
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

export const adminRouter = Router();

// Login is unauthenticated; /me and everything else requires a valid JWT.
adminRouter.use("/", authRouter);

adminRouter.use("/stats", requireAuth, statsRouter);
adminRouter.use("/blog", requireAuth, adminBlogRouter);
adminRouter.use("/courses", requireAuth, adminCoursesRouter);
adminRouter.use("/testimonials", requireAuth, adminTestimonialsRouter);
adminRouter.use("/resources", requireAuth, adminResourcesRouter);
adminRouter.use("/pages", requireAuth, adminPagesRouter);
adminRouter.use("/leads", requireAuth, adminLeadsRouter);
adminRouter.use("/subscribers", requireAuth, adminSubscribersRouter);
adminRouter.use("/settings", requireAuth, adminSettingsRouter);
adminRouter.use("/ai", requireAuth, adminAiRouter);
adminRouter.use("/media", requireAuth, adminMediaRouter);
adminRouter.use("/curriculum", requireAuth, adminCurriculumRouter);
adminRouter.use("/members", requireAuth, adminMembersRouter);
adminRouter.use("/community", requireAuth, adminCommunityRouter);
adminRouter.use("/sales", requireAuth, adminSalesRouter);
adminRouter.use("/growth", requireAuth, adminGrowthRouter);
adminRouter.use("/chats", requireAuth, adminChatsRouter);
adminRouter.use("/products", requireAuth, adminProductsRouter);
adminRouter.use("/offers", requireAuth, adminOffersRouter);
adminRouter.use("/redirects", requireAuth, adminRedirectsRouter);
adminRouter.use("/contacts", requireAuth, adminContactsRouter);
adminRouter.use("/tags", requireAuth, adminTagsRouter);
adminRouter.use("/segments", requireAuth, adminSegmentsRouter);
adminRouter.use("/sequences", requireAuth, adminSequencesRouter);
adminRouter.use("/email-templates", requireAuth, adminEmailTemplatesRouter);
// The original engine stays reachable at /growth/automations until its call
// sites are repointed; these two are different paths, not a replacement in place.
adminRouter.use("/automations", requireAuth, adminAutomationsV2Router);
adminRouter.use("/affiliates", requireAuth, adminAffiliatesRouter);
adminRouter.use("/settings-v2", requireAuth, adminSettingsV2Router);
adminRouter.use("/admins", requireAuth, adminUsersRouter);
adminRouter.use("/integrations", requireAuth, adminIntegrationsRouter);
// Accepting an invite happens BEFORE the invitee has an account, so this one
// router deliberately sits outside requireAuth. Its own token is the credential.
adminRouter.use("/", adminInviteRouter);
