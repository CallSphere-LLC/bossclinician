import dotenv from "dotenv";
import path from "path";

dotenv.config();

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

/** Served verbatim at /uploads: blog covers, testimonial photos, member avatars. */
const uploadDir = path.resolve(process.cwd(), process.env.UPLOAD_DIR ?? "uploads");

/**
 * Everything a customer paid for: course video, lesson attachments, download
 * product files, coaching session files, certificate PDFs.
 *
 * A sibling of the public directory rather than a folder inside it. app.ts hands
 * the whole of `uploadDir` to express.static, so a protected directory nested
 * within it would be served too, and the only thing standing between a $297
 * product and the open web would be a path prefix somebody remembered to
 * exclude. Being outside that tree, it cannot be reached by any URL at all.
 *
 * Deployments must give it its own persistent volume — see docker-compose.yml.
 * Losing it loses every course video, which no database backup can restore.
 */
const protectedUploadDir = path.resolve(
  process.env.PROTECTED_UPLOAD_DIR ?? `${uploadDir}-protected`
);

// The one configuration mistake that would undo the split, refused at boot
// rather than discovered from a leaked link: a protected directory placed
// inside the public one is published by the static mount the moment it exists.
if (
  protectedUploadDir === uploadDir ||
  protectedUploadDir.startsWith(uploadDir + path.sep)
) {
  throw new Error(
    `PROTECTED_UPLOAD_DIR (${protectedUploadDir}) is inside UPLOAD_DIR (${uploadDir}), ` +
      `which serves its whole contents publicly. Point it somewhere outside that directory.`
  );
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: parseInt(process.env.PORT ?? "4000", 10),

  databaseUrl: required(
    "DATABASE_URL",
    "postgres://postgres:postgres@localhost:5432/bossclinician"
  ),

  jwtSecret: required("JWT_SECRET"),
  jwtExpiresIn: "7d" as const,

  adminEmail: process.env.ADMIN_EMAIL ?? "admin@bossclinician.com",
  adminPassword: process.env.ADMIN_PASSWORD ?? "",

  aiBaseUrl: process.env.AI_BASE_URL ?? "http://localhost:8000",

  frontendOrigin: process.env.FRONTEND_ORIGIN ?? "*",

  smtp: {
    host: process.env.SMTP_HOST ?? "",
    port: parseInt(process.env.SMTP_PORT ?? "587", 10),
    user: process.env.SMTP_USER ?? "",
    pass: process.env.SMTP_PASS ?? "",
    from: process.env.SMTP_FROM ?? "Boss Clinician <no-reply@bossclinician.com>",
  },
  notifyEmail: process.env.NOTIFY_EMAIL ?? "",

  // Amazon SES, reached over its SMTP interface so both the fire-and-forget
  // sender in email/mailer.ts and the recorded sender in email/provider.ts use
  // one transport without an SDK between them.
  //
  // The two configuration sets are not a nicety. A set that subscribes to CLICK
  // makes SES rewrite every link in the message through awstrack.me, which is
  // right for a broadcast whose click rate is the point and wrong for a receipt,
  // where a redirect through a domain the reader has never heard of is the
  // difference between a document they trust and one they report.
  ses: {
    transactionalConfigSet: process.env.SES_CONFIG_SET_TRANSACTIONAL ?? "",
    marketingConfigSet: process.env.SES_CONFIG_SET_MARKETING ?? "",
    /** The SNS topic SES posts delivery events to. Verified per notification. */
    snsTopicArn: process.env.SES_SNS_TOPIC_ARN ?? "",
  },

  uploadDir,
  protectedUploadDir,
  // Course videos are the large case; images sit far below this. Keep in sync
  // with nginx's client_max_body_size or nginx rejects the body before Express
  // ever sees it (and the client gets an opaque 413 with no JSON error).
  maxUploadMb: parseInt(process.env.MAX_UPLOAD_MB ?? "512", 10),

  // Stripe. Checkout stays disabled (routes 503) until the secret key is set,
  // so the app boots fine without it. The webhook secret comes from
  // `stripe listen` locally or the dashboard endpoint in production.
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY ?? "",
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
  },

  // Absolute origin used to build Stripe success/cancel return URLs, email
  // links and every absolute URL in the sitemap.
  publicSiteUrl: (process.env.PUBLIC_SITE_URL ?? "https://bossclinician.callsphere.site").replace(
    /\/+$/,
    ""
  ),

  // Off until the DNS cutover. bossclinician.com is live and indexed; a staging
  // host serving the same content to crawlers competes with it. See
  // routes/public/seo.ts.
  seoAllowIndexing: (process.env.SEO_ALLOW_INDEXING ?? "false").toLowerCase() === "true",

  // The job worker runs inside the API process. The work is IO-bound — sending
  // mail, calling Stripe — so it does not compete with request handling for the
  // thing requests actually need, and one service is one thing to deploy and
  // watch. Set false to move it to its own container without a code change.
  workerEnabled: (process.env.WORKER_ENABLED ?? "true").toLowerCase() !== "false",
};

export const stripeEnabled = (): boolean => env.stripe.secretKey.length > 0;
