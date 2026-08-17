import express, { Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import { env } from "./config/env";
import { publicRouter } from "./routes/public";
import { adminRouter } from "./routes/admin";
import { memberAuthRouter } from "./routes/auth";
import { memberRouter } from "./routes/member";
import { seoRouter } from "./routes/public/seo";
import { notFoundHandler, errorHandler } from "./middleware/errorHandler";

export function createApp(): Express {
  const app = express();

  app.disable("x-powered-by");
  // Behind nginx/Traefik: trust the first hop so req.ip / X-Forwarded-For
  // reflect the real client IP (required for correct rate-limit keying).
  app.set("trust proxy", 1);

  const corsOrigin = env.frontendOrigin === "*" ? true : env.frontendOrigin;
  // credentials: the member refresh token travels in an HttpOnly cookie, and a
  // browser will not attach it to a cross-origin request unless the response
  // says so. Only meaningful when FRONTEND_ORIGIN names a real origin — the
  // wildcard case is same-origin behind nginx in production anyway.
  app.use(cors({ origin: corsOrigin, credentials: env.frontendOrigin !== "*" }));

  app.use(cookieParser());

  // Stripe signs the exact bytes it sent, so the webhook needs the raw body.
  // This MUST stay ahead of express.json() — once JSON parses the stream the
  // original bytes are gone and signature verification can never succeed.
  app.use("/api/stripe/webhook", express.raw({ type: "application/json", limit: "1mb" }));

  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true }));

  if (env.nodeEnv !== "test") {
    app.use(morgan(env.nodeEnv === "production" ? "combined" : "dev"));
  }

  // Anonymous, unexpiring, ahead of every router: whatever is in this directory
  // is on the open web. That is the right answer for a blog cover, a testimonial
  // photo or a member's avatar, and it is why nothing a customer paid for is
  // stored here — course video, lesson attachments, product files, coaching
  // files and certificate PDFs live in env.protectedUploadDir, which is outside
  // this tree and reachable only through a signed link (services/signedUrls.ts).
  app.use("/uploads", express.static(env.uploadDir));

  // Root-level, not under /api: crawlers fetch these at fixed paths. nginx
  // routes exactly these two paths here instead of to the SPA.
  app.use("/", seoRouter);

  app.use("/api/admin", adminRouter);
  // Member identity. /api/auth is the unauthenticated surface (register, login,
  // refresh, reset); /api/member is everything that requires being signed in.
  app.use("/api/auth", memberAuthRouter);
  app.use("/api/member", memberRouter);
  app.use("/api", publicRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
