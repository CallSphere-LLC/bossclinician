import { Router, type Request } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { voiceConnectLimiter } from "../../middleware/rateLimit";
import { SURFACE_LIMITS } from "../../services/voice/contract";
import { claimAdmission } from "../../services/voice/admission";
import { liveVoice } from "../../services/voice/liveConfig";
import { exchangeOffer, invalidSdp, scheduleHangup } from "../../services/voice/liveSession";

export const voiceConnectRouter = Router();

/** An admission is a couple of hundred characters; this is room to spare. */
const MAX_ADMISSION_LENGTH = 4096;

function bearer(header: string | undefined): string | null {
  const match = /^Bearer ([A-Za-z0-9._-]+)$/.exec(header ?? "");
  const token = match?.[1] ?? "";
  return token && token.length <= MAX_ADMISSION_LENGTH ? token : null;
}

/**
 * POST /api/voice/connect — the SDP broker.
 *
 * The browser has already built its `RTCPeerConnection` and has an offer. It
 * posts that offer here rather than to OpenAI, and gets an answer back. Three
 * things follow from doing it this way, and all three are the point:
 *
 *  - **The OpenAI key never reaches the page.** The browser is handed an SDP
 *    answer, which is useful for exactly one connection and worthless
 *    afterwards, rather than a credential it could spend.
 *  - **The admission is consumed here**, before anything is minted upstream, so
 *    replaying one cannot open a second billable session.
 *  - **The server learns the session id**, which is what lets it hang the call
 *    up at the surface's cap instead of trusting a countdown in a bundle
 *    anybody can patch.
 *
 * The response body is the answer SDP and nothing else. Errors are the app's
 * usual `{ error }` JSON, and they say what actually went wrong: the difference
 * between a key without GPT-Live access, an unknown model id and a rate limit
 * is three different repairs, and a route that collapses them into "voice is
 * unavailable" hides all three.
 */
voiceConnectRouter.post(
  "/connect",
  voiceConnectLimiter,
  asyncHandler(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");

    // Checked first, because it is what decides whether the body parser in
    // app.ts ran at all. Anything else leaves `req.body` undefined and the
    // refusal below would be about the wrong thing.
    if (!req.is("application/sdp")) {
      res.status(415).json({ error: "The audio offer must be sent as application/sdp." });
      return;
    }

    const token = bearer(req.get("authorization"));
    if (!token) {
      res.status(401).json({ error: "This call needs a fresh admission. Start it again." });
      return;
    }

    const sdp = typeof req.body === "string" ? req.body : "";
    if (invalidSdp(sdp)) {
      res.status(400).json({ error: "That is not a valid audio offer." });
      return;
    }

    // Consumed before OpenAI is touched, and deliberately not put back if the
    // exchange below fails. An admission that survived a failure would be an
    // admission a client could keep retrying with; starting again costs one
    // cheap round trip to /session and keeps "one authorisation, one session"
    // true without exception.
    const claim = claimAdmission(token);
    if (!claim.ok) {
      if (claim.reason === "used") {
        res.status(409).json({ error: "That call has already been connected." });
        return;
      }
      res.status(401).json({ error: "This call needs a fresh admission. Start it again." });
      return;
    }

    const { surface, sessionId } = claim.admission;
    // The output voice travels as a query parameter rather than in the body,
    // because the body is the SDP offer and nothing else. Validated against the
    // list of voices that exist: an unknown one fails the whole provider call
    // rather than degrading, and a mistyped parameter would read to a visitor
    // as a broken microphone.
    const exchange = await exchangeOffer({
      sdp,
      surface,
      voice: liveVoice(req.query.voice),
      signal: abortSignalFor(req),
    });
    if (!exchange.ok) {
      res.status(exchange.status).json({ error: exchange.error });
      return;
    }

    // The server half of `SURFACE_LIMITS[surface].maxSessionSeconds`. The
    // browser runs its own countdown so the agent can say goodbye first; this
    // is what happens to a browser whose countdown has been removed. Both ids
    // go with it: OpenAI's, to drop the call, and ours, to close the row the
    // owner's page reads.
    scheduleHangup({
      liveSessionId: exchange.sessionId,
      voiceSessionId: sessionId,
      afterSeconds: SURFACE_LIMITS[surface].maxSessionSeconds,
    });

    console.info(
      `[voice] connected session=${sessionId} surface=${surface} live=${exchange.sessionId}`,
    );

    // `Location` is what the ported browser client reads the live session's id
    // out of. It names a session, not a credential — the key stays here.
    res.setHeader("Location", exchange.location);
    res.type("application/sdp").send(exchange.answer);
  }),
);

/**
 * The request's own abort signal, so a visitor who closes the tab mid-handshake
 * stops an exchange nobody is waiting for. Express 4 does not expose one, and
 * `req.on("close")` fires for a completed response too, so the listener is
 * removed as soon as the response is finished.
 */
function abortSignalFor(req: Request): AbortSignal {
  const controller = new AbortController();
  const onClose = (): void => {
    if (!req.res?.writableEnded) controller.abort();
  };
  req.once("close", onClose);
  req.res?.once("finish", () => req.off("close", onClose));
  return controller.signal;
}
