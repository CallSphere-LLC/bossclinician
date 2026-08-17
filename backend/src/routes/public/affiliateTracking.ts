import { Request, Response, Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { pool } from "../../db/pool";
import { env } from "../../config/env";
import { asyncHandler } from "../../utils/asyncHandler";
import { generateToken } from "../../auth/tokens";
import { affiliateSettings, recordClick } from "../../services/affiliates";

/**
 * Share-link tracking — the front door of the whole partner program.
 *
 * `GET /api/ref/:code` does three things and then gets out of the way: it makes
 * sure the visitor is carrying a first-party token, records the click against
 * it, and sends them where the link was pointing.
 *
 * The design constraint that shapes everything here is that these links are
 * *already in the world* — printed in a partner's newsletter, in the bio of an
 * Instagram account, in a PDF somebody downloaded last year. A link whose
 * partner has since been suspended, or whose code was mistyped by whoever built
 * the page, must still land the visitor somewhere sensible. Every failure below
 * is therefore a redirect, never an error page: the sale is worth more than the
 * attribution.
 */
export const affiliateTrackingRouter = Router();

/**
 * The visitor cookie.
 *
 * **HttpOnly, deliberately.** Nothing in the browser needs to read this value —
 * the click is written by the server on the way in, and the attribution is
 * resolved by the server at checkout from the same cookie — so exposing it to
 * `document.cookie` would buy nothing and hand every third-party script on the
 * page (analytics, chat widget, pixel) the ability to read a visitor's
 * attribution token and, worse, to rewrite it. A partner who can set this value
 * on a page they control can steal every sale that follows.
 *
 * `SameSite=Lax` rather than `Strict`: essentially all of this traffic arrives
 * as a top-level navigation from somebody else's site, which Lax allows and
 * Strict does not send the cookie on. `Secure` everywhere but local
 * development, because the token is only as good as the transport carrying it.
 *
 * First-party by construction — it is set on this origin by this server, so it
 * survives third-party cookie blocking, which is the thing that has quietly
 * broken most affiliate programs built on a pixel.
 */
export const VISITOR_COOKIE = "bc_ref";

/** 24 bytes of CSPRNG. Opaque; it identifies a browser, not a person. */
const VISITOR_TOKEN_BYTES = 24;

/** base64url, so a value that did not come from us is rejected rather than stored. */
const VISITOR_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * A crawler hitting a share link a thousand times must not fill the click table
 * or drown a real visitor's click in noise. High enough that a person clicking
 * around several partner links in an afternoon never notices.
 */
const trackingLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  // A limited visitor still has to reach the site, so the ceiling redirects
  // rather than answering with JSON nobody would be able to read.
  handler: (_req: Request, res: Response) => {
    res.redirect(302, "/");
  },
});

const paramsSchema = z.object({
  code: z.string().trim().min(1).max(64),
});

const querySchema = z.object({
  /** Which of the partner's saved links this is, when they used one. */
  l: z.string().regex(/^\d{1,9}$/).optional(),
  /** An ad-hoc destination, for a partner deep-linking without a saved link. */
  to: z.string().max(400).optional(),
});

/**
 * Keeps a redirect on this site.
 *
 * The destination is attacker-controlled — anyone can append `?to=` — so an
 * unchecked value turns a link with the business's own domain on it into an
 * open redirect, which is exactly the shape a phishing campaign wants.
 *
 * Only a path is accepted. `//evil.example` and `/\evil.example` are both read
 * as protocol-relative URLs by browsers, and a backslash is normalised to a
 * slash by several of them, so both are refused explicitly rather than caught by
 * the leading-slash test alone.
 */
export function safeInternalPath(raw: string | undefined, fallback: string): string {
  const value = (raw ?? "").trim();
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (/[\r\n]/.test(value)) return fallback;
  return value.slice(0, 400);
}

/** Reuses the token this browser already carries, so two clicks are one visitor. */
function visitorToken(req: Request): { token: string; isNew: boolean } {
  const existing = req.cookies?.[VISITOR_COOKIE];
  if (typeof existing === "string" && VISITOR_TOKEN_PATTERN.test(existing)) {
    return { token: existing, isNew: false };
  }
  return { token: generateToken(VISITOR_TOKEN_BYTES), isNew: true };
}

interface AffiliateLookup {
  id: number;
  status: string;
  cookie_window_days: number;
}

interface LinkLookup {
  id: number;
  offer_id: number | null;
  destination_path: string;
}

/**
 * GET /api/ref/:code
 *
 * Records the click and 302s. Never renders anything, never 404s, never 500s
 * into a visitor's face.
 */
affiliateTrackingRouter.get(
  "/ref/:code",
  trackingLimiter,
  asyncHandler(async (req, res) => {
    const settings = await affiliateSettings();
    const fallbackPath = safeInternalPath(settings.landingPath, "/");

    const params = paramsSchema.safeParse(req.params);
    const query = querySchema.safeParse(req.query);
    if (!params.success) {
      res.redirect(302, fallbackPath);
      return;
    }
    const requestedPath = safeInternalPath(query.success ? query.data.to : undefined, "");

    const affiliateRes = await pool.query<AffiliateLookup>(
      `SELECT id, status, cookie_window_days FROM affiliates WHERE code = $1::citext`,
      [params.data.code]
    );
    const affiliate = affiliateRes.rows[0];

    // An unknown code, or one whose partner is pending, suspended or rejected.
    // The visitor is a real person who clicked a real link; they get the site.
    // No cookie is set, so a suspended partner cannot keep accruing quietly, and
    // an existing token belonging to somebody else is left untouched.
    if (!affiliate || affiliate.status !== "approved") {
      res.redirect(302, requestedPath || fallbackPath);
      return;
    }

    let link: LinkLookup | null = null;
    if (query.success && query.data.l) {
      const linkRes = await pool.query<LinkLookup>(
        `SELECT id, offer_id, destination_path
           FROM affiliate_links WHERE id = $1 AND affiliate_id = $2`,
        [Number(query.data.l), affiliate.id]
      );
      // A link id belonging to somebody else is ignored rather than honoured:
      // otherwise one partner could send traffic through another's destination
      // and inflate that link's click count.
      link = linkRes.rows[0] ?? null;
    }

    const destination = safeInternalPath(
      link?.destination_path || requestedPath || fallbackPath,
      "/"
    );

    const { token } = visitorToken(req);
    const maxAgeMs = affiliate.cookie_window_days * 24 * 60 * 60 * 1000;

    // Re-stamped on every click so the window runs from the most recent visit,
    // which is what a partner means by "a 30 day cookie".
    res.cookie(VISITOR_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: env.nodeEnv === "production",
      path: "/",
      maxAge: maxAgeMs,
    });

    await recordClick({
      affiliateId: affiliate.id,
      linkId: link?.id ?? null,
      offerId: link?.offer_id ?? null,
      visitorToken: token,
      landingPath: destination,
      referrer: typeof req.headers.referer === "string" ? req.headers.referer : "",
      userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : "",
      ip: req.ip ?? "",
      cookieWindowDays: affiliate.cookie_window_days,
    });

    if (link) {
      // Denormalised for the partner's own link list; the nightly rollup
      // recomputes it, so a lost increment here self-heals.
      await pool.query(`UPDATE affiliate_links SET click_count = click_count + 1 WHERE id = $1`, [
        link.id,
      ]);
    }

    res.redirect(302, destination);
  })
);
