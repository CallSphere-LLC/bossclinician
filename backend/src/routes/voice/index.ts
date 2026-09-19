import { Router } from "express";
import { memberAuthCsrf } from "../../auth/memberCsrf";
import { voiceSessionRouter } from "./session";
import { voiceConnectRouter } from "./connect";
import { voiceChatRouter } from "./chat";
import { voiceTranscriptRouter } from "./transcript";
import { voiceRecordingRouter } from "./recording";
import { voiceTourProgressRouter } from "./tourProgress";
import { voiceApprovalRouter } from "./approval";

/**
 * /api/voice — everything a concierge conversation touches.
 *
 * Mounted outside /api/admin on purpose. The admin API is host-guarded
 * (`requireAdminHost` in app.ts) and these routes are not, because all three of
 * them serve every surface: the same code answers a signed-out visitor on the
 * marketing site and Yvette in her admin, and what differs is only what
 * `resolveSurface` decides from the request's own credentials. nginx routes
 * /api/voice/ to the API on both virtual hosts for the same reason — see
 * nginx/admin.conf, which otherwise bounces everything but /api/admin/ to the
 * public host, taking the admin cookie out of the request on the way.
 */
export const voiceRouter = Router();

/**
 * Cross-site refusal, on every route here.
 *
 * Two of them authenticate with an ambient cookie, and auth/memberCsrf.ts
 * explains why SameSite=Lax is not enough by itself on this host: the
 * registrable domain carries other applications, every one of them same-site to
 * this one. `/connect` authenticates with a bearer and does not need this, but
 * it costs it nothing — the check only reads Origin and Sec-Fetch-Site — and a
 * router where one route is exempt is a router where the exemption spreads.
 */
voiceRouter.use(memberAuthCsrf);

// Opening and running a conversation.
voiceRouter.use(voiceSessionRouter);
voiceRouter.use(voiceConnectRouter);
voiceRouter.use(voiceChatRouter);

// What a conversation leaves behind, owned by the persistence slice. Mounted
// here rather than beside them so there is one place that says what /api/voice
// contains. Each brings its own body parser where it needs one — the recording
// upload claims `audio/*` on its own route — so nothing competes with the
// `application/sdp` parser app.ts mounts for /api/voice/connect, and nothing
// here is reached by the global express.json() before its own parser runs.
voiceRouter.use(voiceTranscriptRouter);
voiceRouter.use(voiceRecordingRouter);
voiceRouter.use(voiceTourProgressRouter);
voiceRouter.use(voiceApprovalRouter);
