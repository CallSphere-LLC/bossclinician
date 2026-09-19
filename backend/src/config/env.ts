import dotenv from "dotenv";
import path from "path";

// Quiet: dotenv 17 prints a "injecting env (N) from .env" banner on every load
// by default, once per process and once per forked test suite. It told nobody
// anything the missing-variable check below does not, and 16 never printed it.
dotenv.config({ quiet: true });

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

/**
 * The relay port, validated. An unparseable or out-of-range TURN_PORT falls
 * back to 3478 instead of propagating: the value ends up inside a `turn:` URL
 * handed to a browser, and a browser given an unreachable relay does not fail
 * fast — it stalls the whole ICE gathering timeout before the room gives up,
 * which looks like a broken call rather than a mistyped variable.
 */
function turnPort(): number {
  const raw = process.env.TURN_PORT;
  if (!raw) return 3478;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    console.warn(`Ignoring invalid TURN_PORT=${raw}; using 3478`);
    return 3478;
  }
  return n;
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
  jwtExpiresIn: "5m" as const,

  adminEmail: process.env.ADMIN_EMAIL ?? "admin@bossclinician.com",
  adminPassword: process.env.ADMIN_PASSWORD ?? "",

  aiBaseUrl: process.env.AI_BASE_URL ?? "http://localhost:8000",

  /**
   * OpenAI, for the voice concierge — the only part of this app that talks to
   * OpenAI from Node rather than through the Python service at AI_BASE_URL.
   *
   * It has to. `/api/voice/connect` trades the browser's SDP offer for an
   * answer, and the whole point of doing that here is that the key never
   * reaches the page; a proxy hop through a second service would only move the
   * same secret one container further away for no gain. The key is not copied
   * into backend/.env for it: docker-compose.yml hands this service the same
   * `ai/.env` the AI service already reads, so there is one file on this host
   * holding it.
   *
   * Blank is a supported state. The concierge routes answer 503 ("not
   * configured") and nothing else in the app changes.
   *
   * The model NAMES are not here. They live in services/voice/contract.ts,
   * where they are verified and where the browser is handed a copy of them, so
   * the two halves of the concierge cannot name different models; the optional
   * overrides sit beside them in services/voice/liveConfig.ts. In particular
   * the AI service's own `OPENAI_MODEL` is deliberately not read — it names the
   * model behind the old text chat, and ai/.env must not be able to swap the
   * concierge's brain as a side effect of being shared.
   */
  openai: {
    apiKey: (process.env.OPENAI_API_KEY ?? "").trim(),
    // ai/.env ships OPENAI_BASE_URL empty, meaning "OpenAI itself" — so an
    // empty string has to fall through to the default rather than become one.
    baseUrl: (process.env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1").replace(
      /\/+$/,
      ""
    ),
  },

  frontendOrigin: process.env.FRONTEND_ORIGIN ?? "*",
  adminOrigin: process.env.ADMIN_ORIGIN ?? (process.env.NODE_ENV === "production" ? "https://admin.bossclinician.callsphere.site" : ""),

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

  /**
   * STUN/TURN for the community live room.
   *
   * Same scheme the telehealth app on this host uses — coturn started with a
   * `--static-auth-secret`, and the browser handed a short-lived credential
   * minted from it (TURN REST API) rather than a standing password — but a
   * separate relay with a separate secret. The two apps shared one coturn
   * briefly; that made this secret a key to the clinical relay and coupled
   * the two apps' rate limits, so this app now runs its own (see the coturn
   * service in docker-compose.yml). Hence the port: the telehealth relay
   * already holds 3478 on this host.
   *
   * Both blank is a supported configuration, not a broken one — the room still
   * connects over host and STUN candidates, which covers most home and office
   * networks. It fails on symmetric NAT, which is exactly what TURN relays, so
   * the ICE endpoint reports whether a relay is configured instead of leaving
   * a silent hole for someone to discover mid-call.
   */
  turn: {
    host: process.env.TURN_HOST ?? "",
    /**
     * The port this app's own relay listens on, for both STUN and TURN.
     *
     * Defaults to 3478 because that is what a lone coturn uses, but on this
     * host the telehealth relay already has it, so the deployed value is not
     * the default. A bad value falls back rather than serving a browser an
     * unreachable `turn:` URL it would spend the whole ICE timeout on.
     */
    port: turnPort(),
    /** Never sent to a browser. Only HMACs of a timestamped username are. */
    staticAuthSecret: process.env.TURN_STATIC_AUTH_SECRET ?? "",
    /** A public STUN fallback so a room works with no TURN deployed at all. */
    stunFallback: process.env.STUN_FALLBACK_URL ?? "stun:stun.l.google.com:19302",
  },

  uploadDir,
  protectedUploadDir,
  // Course videos are the large case; images sit far below this. Keep in sync
  // with nginx's client_max_body_size or nginx rejects the body before Express
  // ever sees it (and the client gets an opaque 413 with no JSON error).
  maxUploadMb: parseInt(process.env.MAX_UPLOAD_MB ?? "512", 10),

  /**
   * Where a voice conversation's audio is kept.
   *
   * `local` writes into the protected upload directory above — the one no
   * static handler is mounted on — and is the default because this host has no
   * AWS credentials. `s3` is the target: set the bucket and the region, supply
   * credentials the standard way (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY, or
   * an instance role), and nothing else changes. Recordings already written
   * keep playing after the switch, because a stored key says which store holds
   * it rather than the environment deciding for every key at once.
   */
  voiceRecording: {
    store: (process.env.VOICE_RECORDING_STORE ?? "local").trim().toLowerCase(),
    bucket: (process.env.VOICE_RECORDING_BUCKET ?? "").trim(),
    // AWS_REGION is what the SDK itself reads, so a deployment that already
    // sets it does not have to say the same thing twice.
    region: (process.env.VOICE_RECORDING_REGION ?? process.env.AWS_REGION ?? "").trim(),
    prefix: (process.env.VOICE_RECORDING_PREFIX ?? "voice-recordings").trim(),
  },

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

  // "Continue with Google" on the member sign-in and sign-up screens. Off until
  // BOTH are set — the button is not drawn and /api/auth/google/start is a 404 —
  // so the app boots fine without them. There is no redirect-URI variable on
  // purpose: it is always `${PUBLIC_SITE_URL}/api/auth/google/callback`, and
  // that exact string is what has to be registered in the Google Cloud Console.
  // See auth/googleOAuth.ts.
  google: {
    clientId: (process.env.GOOGLE_CLIENT_ID ?? "").trim(),
    clientSecret: (process.env.GOOGLE_CLIENT_SECRET ?? "").trim(),
  },

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

/** Whether the voice and text concierge can reach a model at all. */
export const voiceEnabled = (): boolean => env.openai.apiKey.length > 0;
