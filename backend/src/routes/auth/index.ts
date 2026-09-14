import { Router } from "express";
import { memberAuthCsrf } from "../../auth/memberCsrf";
import { memberAuthRoutes } from "./memberAuth";
import { memberAccountRoutes } from "./memberAccount";

/**
 * `/api/auth/*` — member identity.
 *
 * Split in two: `memberAuth` is the unauthenticated surface (register, sign in,
 * refresh, forgotten passwords, email verification), `memberAccount` is the
 * signed-in surface (/me and friends). They share a mount point because that is
 * the shape the brief specifies and because the refresh cookie is path-scoped
 * to `/api/auth`.
 */
export const memberAuthRouter = Router();

// First, because the refresh cookie is scoped to exactly this mount: see
// auth/memberCsrf.ts for why SameSite alone does not cover it on this domain.
memberAuthRouter.use(memberAuthCsrf);
memberAuthRouter.use(memberAuthRoutes);
memberAuthRouter.use(memberAccountRoutes);
