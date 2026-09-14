import express, { Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import { requireAdminHost } from "./auth/adminSession";
import { env } from "./config/env";
import { publicRouter } from "./routes/public";
import { adminRouter } from "./routes/admin";
import { memberAuthRouter } from "./routes/auth";
import { memberRouter } from "./routes/member";
import { accountReceiptsRouter } from "./routes/member/accountReceipts";
import { seoRouter } from "./routes/public/seo";
import { renderRouter } from "./routes/public/render";
import { apiV1Router } from "./routes/public/apiV1";
import { notFoundHandler, errorHandler } from "./middleware/errorHandler";
import { apiLimiter } from "./middleware/rateLimit";

export function createApp(): Express {
  const app = express();

  app.disable("x-powered-by");
  // Behind nginx/Traefik: trust exactly one hop. This value is COUPLED to
  // nginx/site.conf, which forwards X-Forwarded-For verbatim rather than
  // appending to it (see the comment there). If nginx ever goes back to
  // $proxy_add_x_forwarded_for, it appends a hop and this must become 2 —
  // and if you raise it to 2 while nginx still passes through, a client can
  // forge its own X-Forwarded-For. Change the two together or not at all.
  //
  // Note this does NOT currently yield the visitor's address: the k3d load
  // balancer is a plain TCP proxy and the Traefik Service uses
  // externalTrafficPolicy: Cluster, so the source IP is replaced upstream of
  // us. req.ip is a constant in production, which means every per-IP rate
  // limiter is effectively global and consentIp/audit IPs are not evidence.
  // Fixing that needs PROXY protocol on the k3d LB and the Traefik
  // entrypoints together; see docs/bugs/infra.md.
  app.set("trust proxy", 1);

  // Host is the real routing boundary. Do this before CORS and every admin
  // endpoint, including login and refresh, even if a legacy cookie is sent.
  app.use("/api/admin", requireAdminHost);
  app.use(cors((req, callback) => {
    const isAdmin = req.url === "/api/admin" || req.url.startsWith("/api/admin/");
    const origin = isAdmin && env.adminOrigin ? env.adminOrigin : env.frontendOrigin;
    callback(null, { origin: origin === "*" ? true : origin, credentials: origin !== "*" });
  }));

  // The site-wide backstop; middleware/rateLimit.ts has the sizing and why it is
  // per surface rather than per visitor. After CORS so a refusal still carries
  // the headers a browser needs to read it, ahead of the body parsers so a
  // refused request is not parsed first, and ahead of every router so nothing
  // that reaches the database is unlimited.
  app.use(apiLimiter);

  app.use(cookieParser());

  // Stripe signs the exact bytes it sent, so the webhook needs the raw body.
  // This MUST stay ahead of express.json() — once JSON parses the stream the
  // original bytes are gone and signature verification can never succeed.
  app.use("/api/stripe/webhook", express.raw({ type: "application/json", limit: "1mb" }));

  // Same reason as the Stripe line above: the provider signs the bytes it sent,
  // so once JSON has parsed the stream the original body is gone and no
  // signature can ever verify.
  //
  // Every content type, not just JSON: Amazon SNS — which is how SES reports
  // deliveries and bounces — posts its JSON under `text/plain`, and a type
  // filter that misses it leaves the body unparsed and every notification
  // unverifiable. Nothing but webhooks is mounted under this path, so accepting
  // the bytes whatever they claim to be costs nothing.
  app.use("/api/email/webhook", express.raw({ type: () => true, limit: "1mb" }));

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
  //
  // `dotfiles: "deny"` for the one directory inside it that is not published
  // media: `.parts`, where a resumable upload accumulates. A 404 there would be
  // enough; a 403 says the path is off limits whether the file exists or not,
  // so a half-uploaded course video cannot be fetched by guessing its session
  // id while it is still being written.
  app.use("/uploads", express.static(env.uploadDir, { dotfiles: "deny" }));

  // Root-level, not under /api: crawlers fetch these at fixed paths. nginx
  // routes exactly these two paths here instead of to the SPA.
  app.use("/", seoRouter);

  // The Zapier-compatible surface. Its own bearer scheme (an API key, not a
  // session), so it is mounted beside the app rather than inside it.
  app.use("/api/v1", apiV1Router);

  app.use("/api/admin", adminRouter);
  // Member identity. /api/auth is the unauthenticated surface (register, login,
  // refresh, reset); /api/member is everything that requires being signed in.
  app.use("/api/auth", memberAuthRouter);
  app.use("/api/member", memberRouter);
  // The receipt PDF at its permanent member address. Two exact route shapes,
  // authenticated by the /account/-scoped document cookie; nginx sends exactly
  // these here and every other /account URL to the SPA.
  app.use("/account", accountReceiptsRouter);
  app.use("/api", publicRouter);

  // Server-rendered marketing HTML. Last, and matching only its own explicit
  // list of paths, so it can never shadow an API route or the static mounts
  // above it. nginx sends exactly these paths here; everything else still
  // reaches the frontend container as the client-rendered shell.
  app.use("/", renderRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
