import { Router, type Request, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, serviceUnavailable, unauthorized, HttpError } from "../../utils/httpError";
import { voiceEnabled } from "../../config/env";
import { ADMIN_ACCESS_COOKIE, ADMIN_REFRESH_COOKIE, requireAdminHost } from "../../auth/adminSession";
import { requireAuth } from "../../middleware/auth";
import { optionalMember } from "../../middleware/memberAuth";
import { voiceSessionLimiter } from "../../middleware/rateLimit";
import { SURFACE_LIMITS, resolveSurface, type VoiceIdentity } from "../../services/voice/contract";
import { issueAdmission } from "../../services/voice/admission";
import { CONCIERGE_VOICE, backendModel } from "../../services/voice/liveConfig";
import { callerKey, claimSessionSlot, normalisePath } from "../../services/voice/policy";
import { ensureVoiceVisitorId, openSession } from "../../services/voice/sessionStore";

export const voiceSessionRouter = Router();

/**
 * Who the request has proved itself to be, from its own credentials.
 *
 * This is the server half of the role-based access the contract insists on
 * being enforced twice, and it lives beside the route that first needs it
 * (`/chat` imports it from here). It does not reimplement either check: it runs
 * the middleware the rest of the app runs and reads the answer, so a session
 * that has been revoked, an admin who has been demoted and a member who has
 * been suspended are all as invisible to the concierge as they are to every
 * other route. Reinventing them here would mean two implementations of "is this
 * person still allowed in", and one of them would rot.
 *
 * **The two audiences do not authenticate the same way, and this is the thing
 * to get right.** An administrator carries a cookie session. A MEMBER carries a
 * bearer token in the `Authorization` header — their refresh cookie is scoped
 * to `path=/api/auth` and is never even sent here — so a voice route that read
 * cookies alone would demote every signed-in member to the public concierge,
 * silently, and only in production, where it would look like the agent had
 * simply forgotten who they were.
 *
 * Admin is asked first, because when a request somehow carries both, being the
 * owner is the more specific answer.
 */
export async function identityFromRequest(req: Request, res: Response): Promise<VoiceIdentity> {
  // The virtual host is this app's routing boundary for anything administrative
  // (app.ts puts `requireAdminHost` in front of every /api/admin route, login
  // included), and an admin voice session is administrative. These routes serve
  // all three surfaces so they cannot sit behind that guard wholesale — but the
  // admin ANSWER can, and does. A browser could not reach this anyway, because
  // the `__Host-` cookie is bound to the admin host; the point is that the rule
  // holds here for the same reason it holds there rather than by accident.
  const wrongHost = await settle(requireAdminHost, req, res);
  const adminFailure =
    wrongHost === undefined ? await settle(requireAuth, req, res) : wrongHost;
  const admin = adminFailure === undefined ? adminIdentity(req) : null;
  if (admin) return admin;

  // A 401 here is the ordinary "not signed in as an admin". Anything else is
  // the database saying no, and silently demoting the owner to a public visitor
  // because a query failed is the kind of thing that gets reported later as
  // "the assistant is just dumber in the admin".
  if (adminFailure !== undefined && !(adminFailure instanceof HttpError)) {
    console.error("[voice] admin identity check failed:", adminFailure);
  }

  // `adminAccessToken` prefers an explicit bearer over the cookie, which is
  // right everywhere else in the app and wrong here: on these routes a bearer
  // header means a MEMBER, so an admin who also held one would have their
  // cookie ignored in favour of a token that cannot be an admin token. It does
  // not happen in a real browser — the admin virtual host sends no member
  // bearer — but the two meanings of one header should not be left to rely on
  // that, so when both are present the cookie gets its own turn.
  if (
    wrongHost === undefined &&
    req.headers.authorization &&
    req.cookies?.[ADMIN_ACCESS_COOKIE]
  ) {
    const presented = req.headers.authorization;
    delete req.headers.authorization;
    const retry = await settle(requireAuth, req, res);
    req.headers.authorization = presented;
    const retried = retry === undefined ? adminIdentity(req) : null;
    if (retried) return retried;
  }

  await settle(optionalMember, req, res);
  if (req.member) return { audience: "member", memberId: req.member.id };

  // A supplied credential that has expired must trigger the app's shared
  // refresh-and-retry path. Only a truly anonymous request may be demoted.
  if (req.headers.authorization || (wrongHost === undefined &&
      (req.cookies?.[ADMIN_ACCESS_COOKIE] || req.cookies?.[ADMIN_REFRESH_COOKIE]))) {
    throw unauthorized("Your session needs refreshing. Please sign in again if it has ended.");
  }
  return { audience: "anonymous" };
}

/**
 * The admin `requireAuth` just proved, read off the request.
 *
 * A function rather than two inline reads of `req.user`, and not only to avoid
 * repeating the construction. The attempts are separated by an `await`, and the
 * compiler cannot see that a middleware assigns `req.user` — so a check earlier
 * in the same scope keeps narrowing the property long after the middleware has
 * filled it, and the second read is against a value TypeScript believes cannot
 * exist. Reading it through here asks the question fresh each time, which is
 * also what the code means.
 */
function adminIdentity(req: Request): VoiceIdentity | null {
  const payload = req.user;
  if (!payload) return null;
  return { audience: "admin", adminUserId: payload.sub, role: payload.role };
}

/**
 * Runs one of the app's middlewares to completion and hands back whatever it
 * passed to `next`, instead of letting it end the request.
 *
 * `requireAuth` is written to reject; here a rejection is an answer rather than
 * a failure, because asking for more than you are must degrade rather than 403
 * (see `resolveSurface`). Neither middleware writes to the response, so nothing
 * has been sent by the time this resolves.
 */
function settle(handler: RequestHandler, req: Request, res: Response): Promise<unknown> {
  return new Promise((resolve) => {
    void handler(req, res, (err?: unknown) => resolve(err));
  });
}

const sessionSchema = z.object({
  surface: z.enum(["public", "member", "admin"]),
  path: z.string().max(2048),
});

/**
 * POST /api/voice/session — decide who this is, open a row, mint an admission.
 *
 * The surface in the body is a REQUEST, not a fact. Whatever it says, the
 * answer comes from `resolveSurface` reading the credentials this request
 * carries, and asking for more than you are degrades quietly: a signed-out
 * visitor who has landed on an admin URL is an ordinary thing, and answering
 * them with a 403 would only make the public concierge worse. The browser is
 * told which surface it actually got, so it can drop the tools it will not be
 * allowed to use.
 */
voiceSessionRouter.post(
  "/session",
  voiceSessionLimiter,
  asyncHandler(async (req, res) => {
    const parsed = sessionSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid voice session request", parsed.error.flatten());

    // Checked before the row is written, so a server with no key does not
    // accumulate sessions nobody could ever have connected.
    if (!voiceEnabled()) {
      throw serviceUnavailable("The voice assistant is unavailable right now.");
    }

    const identity = await identityFromRequest(req, res);
    const surface = resolveSurface(parsed.data.surface, identity);
    const limits = SURFACE_LIMITS[surface];

    // Minted here, before the budget is checked, so an anonymous visitor's
    // allowance belongs to their browser rather than to the whole site — and so
    // the row below opens with an owner already in hand rather than claiming
    // one from its first transcript line. See sessionStore.ts.
    const visitorId = identity.audience === "anonymous" ? ensureVoiceVisitorId(req, res) : null;

    const slot = claimSessionSlot(callerKey(identity, { visitorId, ip: req.ip ?? "" }), surface);
    if (!slot.allowed) {
      // A number of seconds, so the browser can say "in a few minutes" rather
      // than leaving someone pressing a button that does nothing.
      res.setHeader("Retry-After", String(slot.retryAfterSeconds));
      res.status(429).json({
        error: "You have started a lot of conversations in the last hour. Try again shortly.",
      });
      return;
    }

    const path = normalisePath(parsed.data.path);
    const { sessionId } = await openSession({
      surface,
      identity,
      path,
      ip: req.ip ?? "",
      userAgent: req.get("user-agent") ?? "",
      visitorId,
      mode: "voice",
    });

    const { token, admission } = issueAdmission({ sessionId, surface, identity });

    // No caching, anywhere: this response contains a credential, and the whole
    // design rests on it being usable exactly once.
    res.setHeader("Cache-Control", "no-store");
    res.json({
      admission: token,
      sessionId: admission.sessionId,
      surface,
      maxSessionSeconds: limits.maxSessionSeconds,
      recording: limits.recordAudio,
      // Named by the server, echoed by the browser. The browser re-registers
      // the delegation config once its data channel is open, and two
      // independently hardcoded model names is a brain that changes halfway
      // through the handshake. The side holding the API key decides.
      backendModel: backendModel(),
      voice: CONCIERGE_VOICE,
    });
  }),
);
