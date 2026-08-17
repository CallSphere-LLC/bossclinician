import { Router } from "express";
import { requireMember } from "../../middleware/memberAuth";
import { memberBillingRouter } from "./billing";

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

// Phase 3 mounts library, player, progress, downloads, certificates, community
// and coaching here.
