import { Router } from "express";

export const healthRouter = Router();

/**
 * The commit this image was built from, baked in by the Dockerfile's
 * APP_RELEASE build arg. The deploy pipeline reads it back through the public
 * URL to prove the live API is the build it just rolled out, not a container
 * that outlived the rollout.
 */
const release = process.env.APP_RELEASE || "dev";

healthRouter.get("/health", (_req, res) => {
  res.json({ ok: true, service: "bossclinician-backend", release, time: new Date().toISOString() });
});
