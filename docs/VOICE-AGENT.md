# The voice concierge — build contract

One machine, three faces. A visitor, a member or Yvette presses a mic button and talks to
"Boss Clinician AI": it answers, **navigates the app for them**, **moves a cursor onto what it is
talking about**, and **reads the page out loud**. Ported from the CallSphere website
(`/opt/call_sphere_official_website/frontend`), rebuilt for this stack (React + Vite +
react-router + Express, not Next.js).

## The two contract files — read both before writing a line

- `frontend/src/voice/contract.ts` — surfaces, policies, tools, approval, page snapshots.
- `backend/src/services/voice/contract.ts` — identity, surface resolution, limits, recording store.

**Do not edit either.** If one of them is wrong for your slice, say so in your report; a contract
edited by six agents at once is not a contract.

## Shape

```
frontend/src/voice/
  contract.ts      ← the seam (written, frozen)
  kernel/          ← WebRTC + GPT-Live protocol + the React hook          [agent: kernel]
  tools/           ← navigate / read page / point — the agent's hands     [agent: tools]
  ui/              ← launcher, orb, cursor, captions, approval card       [agent: ui]
  surfaces/        ← one policy object per surface + mounting             [agent: surfaces]
backend/src/services/voice/
  contract.ts      ← the seam (written, frozen)
  liveSession.ts, admission.ts                                            [agent: broker]
  sessionStore.ts, recordingStore.ts                                      [agent: persistence]
backend/src/routes/voice/                                                 [agent: broker]
backend/src/routes/admin/voiceSessions.ts                                 [agent: persistence]
```

## How a call actually works

1. Browser `POST /api/voice/session` `{surface, path}` → server reads **its own cookies**, resolves
   the real surface (`resolveSurface`), opens a `voice_sessions` row, returns a one-use admission.
2. Browser opens `RTCPeerConnection`, creates the `oai-events` data channel, and `POST`s its SDP
   offer to `/api/voice/connect` as `application/sdp` with `Authorization: Bearer <admission>`.
3. The server trades that offer with OpenAI GPT-Live (`POST {OPENAI_BASE_URL}/live/sessions`,
   `{session: liveSessionConfig(...), transport: {type:"webrtc", sdp}}`) and returns the answer SDP.
   **The OpenAI key never reaches the browser.** The admission is consumed on use.
4. Audio flows peer-to-peer; events flow over the data channel through `LiveProtocol`.
5. Tools run **in the browser** (they touch the DOM and the router) and their results go back as
   `function_call_output`.

Model: `gpt-live-1`. Persona: it introduces itself as **"I'm Boss Clinician AI"** — warm, smooth,
female voice (`coral`). Never implies it is Yvette.

## Role-based access — enforced twice, on purpose

- **Policy (browser):** the model is only *told* about the destinations and tools its surface owns.
  A public session's catalog contains no `/admin` path, so it cannot ask for one.
- **Server:** `resolveSurface` re-decides from cookies on every admission, and every privileged
  tool call is an authenticated API call that the existing admin/member middleware guards anyway.

The browser copy is UX. The server copy is security. Neither is optional.

## Decisions already made (do not relitigate)

| | |
|---|---|
| Admin | May run **full actions, but only after the owner approves** — by voice ("yes, do it"), in the chat, or by clicking the approval card. `propose_admin_action` → approval → `run_approved_action`. Destructive actions never accept a voice-only yes. |
| Member | Reads **the signed-in member's own data** aloud (their courses, progress, orders, receipts). Server-scoped to their session — no cross-member reads, ever. |
| Guardrails | Per-IP burst limit + one-use admission + hard session cap; recording-disclosure banner **before** the mic opens; transcripts persisted with an admin page. |
| Recordings | Stored via the `RecordingStore` interface. **S3 is the target**, local Docker volume is the default that runs today (this box has no AWS credentials). One env switch, no rewrite. |

## House rules that will bite you

- **Never run `npm run build` or `tsc -b`.** 8 GB / 2 cores, shared with another product's k3s
  cluster; a parallel build invites the OOM killer and it usually kills Postgres. Run at most your
  own single vitest file: `npx vitest run src/voice/<yours>.test.ts`.
- **SSR is real.** `npm run build` also builds `src/entry-server.tsx`. Every voice module must be
  client-only: no top-level `window`/`document`, and the launcher is `React.lazy` + mounted from an
  effect. A stray DOM touch at import time breaks the server render of the whole site.
- `@/` → `frontend/src`. Next.js `@/lib/...` imports in the source you are porting are **not** the
  same alias — rewrite them.
- `router.push(...)` → react-router `useNavigate()`. Same-tab, so the call survives.
- Admin UI copy is read by a non-technical business owner. No "webhook", "JSON", "slug", "token".
- Comments explain **why**, not what. Match the surrounding prose style — this repo writes in
  sentences, not labels. No `// TODO`, no placeholder implementations.
- Touch only the files your slice owns. Report anything you needed but did not own.

## Source map (what to port from where)

All paths under `/opt/call_sphere_official_website/frontend`:

| Need | Source |
|---|---|
| GPT-Live wire protocol | `lib/live-protocol.ts` |
| Session/agent/transport shim (no SDK — it is all local) | `lib/live-session.client.ts` |
| Audio tap + caption store | `lib/voice-agent-live.client.ts` |
| Call orchestration, connect/retry/teardown | `components/VoiceAgentLauncher.tsx` (1750 lines — take the spine, leave the CallSphere-specific demo machinery) |
| Destination catalog pattern | `lib/voice/navigation-registry.ts` |
| Tool factories | `lib/voice/agent-tools.client.ts` |
| Page reading | `lib/voice/page-reader.client.ts` |
| Cursor + caption pill | `lib/voice/spotlight.client.ts`, `lib/voice/spotlight-pointer.ts`, `components/voice/VoiceSpotlight.tsx` |
| Orb | `components/voice/MiniVoiceOrb.tsx` |
| Approval card | `components/admin-assistant/ApprovalCard.tsx` |
| Server broker | `lib/public-realtime-connect.server.ts`, `app/api/voice-agent/connect/route.ts`, `lib/live-config.ts` |

## The seams between slices — the exact exports each agent must provide

These signatures are the handshake. Provide yours exactly; assume the others exist.

**`frontend/src/voice/kernel/index.ts`** — owned by *kernel*

```ts
export type VoiceStatus = "idle" | "requesting-mic" | "connecting" | "live" | "ending" | "error";

export type VoiceSessionHandle = {
  status: VoiceStatus;
  error: string | null;
  /** True while the agent is speaking — drives the orb and the cursor's caption. */
  isSpeaking: boolean;
  captions: CaptionLine[];
  sessionId: string | null;
  secondsRemaining: number | null;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  /** Poll once per animation frame. Never React state — 60fps of setState is a jank machine. */
  readLevels: () => { agent: number; mic: number };
  /** Inject a typed/spoken-for-them turn (used by the chat approval path). */
  say: (text: string) => void;
};

export function useVoiceSession(input: {
  policy: VoiceSurfacePolicy;
  /** The UI passes a closure that builds the tool list once the SDK shim is loaded. */
  buildTools: (toolFn: ToolFn) => unknown[];
  onTranscriptLine?: (line: { role: "user" | "agent"; text: string; atMs: number }) => void;
}): VoiceSessionHandle;

/** Fetch wrapper with credentials + member CSRF. */
export function createVoiceApiClient(): VoiceApiClient;
```

**`frontend/src/voice/tools/index.ts`** — owned by *tools*

```ts
export function buildVoiceTools(
  policy: VoiceSurfacePolicy, toolFn: ToolFn, ctx: VoiceContext,
): ConciergeTool[];

/** Spotlight store, consumed by <VoiceSpotlight/> through useSyncExternalStore. */
export type SpotlightState = {
  rect: { top: number; left: number; width: number; height: number };
  label: string;
  caption: string | null;
} | null;
export function subscribeSpotlight(onChange: () => void): () => void;
export function getSpotlightSnapshot(): SpotlightState;
```

**`frontend/src/voice/ui/index.ts`** — owned by *ui*. This is the composition root: it builds the
`VoiceContext` (navigate from `useNavigate`, `call` from `createVoiceApiClient`, `requestApproval`
from its own approval store), calls `buildVoiceTools`, and drives `useVoiceSession`.

```ts
export function VoiceConcierge(props: { policy: VoiceSurfacePolicy }): JSX.Element;
```

**`frontend/src/voice/surfaces/index.ts`** — owned by *surfaces*

```ts
export const PUBLIC_POLICY: VoiceSurfacePolicy;
export const MEMBER_POLICY: VoiceSurfacePolicy;
export const ADMIN_POLICY: VoiceSurfacePolicy;
/** Which policy belongs to a pathname. */
export function policyForPath(pathname: string): VoiceSurfacePolicy;
```

**Backend** — *broker* owns `POST /api/voice/session`, `POST /api/voice/connect` and mounting in
`app.ts`. *persistence* owns the migration (`067_voice_sessions.sql`), `sessionStore.ts`,
`recordingStore.ts`, `POST /api/voice/transcript`, `PUT /api/voice/recording`, the admin API and
`frontend/src/pages/admin/VoiceSessions.tsx` (default export `VoiceSessions`). The *surfaces* agent
adds its route and nav entry in `AdminApp.tsx`.

## Addendum 1 — the first-run walkthrough

A newcomer should not have to know what to ask. The **first** time a person opens a surface, the
concierge introduces itself and offers, in one breath, to show them around:

> "I'm Boss Clinician AI. Would you like me to walk you through the whole dashboard, or would you
> rather just ask me things?"

(the public site says "the whole site"; the portal says "your portal"). That is `firstVisitGreeting`
on the policy. It is an **offer, not an ambush**: it asks, then waits. If they decline, the answer
is remembered and they are never asked again.

On "yes", the agent walks `policy.tour` — an ordered `TourStop[]` — end to end: travel to the stop,
read the page, then point at each `beat` in turn and explain it, pausing for questions and resuming
where it left off. Every page of the surface appears in its tour, and every stop covers what the
page is actually for, not just its title.

Progress is a `TourProgress` persisted **server-side** (so it follows the person to another device)
with a localStorage mirror for anonymous visitors. A dropped call or a refresh resumes at the same
stop; it never restarts from the top, and it never re-offers a tour someone already finished.

Tools: `start_guided_tour`, `next_tour_stop`, `end_guided_tour` — owned by the *tools* slice.
Itineraries — owned by the *surfaces* slice. Persistence — owned by the *persistence* slice.

## Addendum 2 — the text chatbot does all of this too

The existing `frontend/src/components/ChatWidget.tsx` must gain the **same** behaviour: it
navigates the app, moves the cursor onto what it is describing, reads the page, and runs the same
first-run walkthrough — typed instead of spoken.

This is why `buildVoiceTools` returns `ConciergeTool` descriptors with a local `execute`: the tool
registry is **transport-agnostic**. Two transports consume one registry:

- **voice** — GPT-Live over WebRTC (`kernel/`).
- **text** — a browser-side chat loop against `POST /api/voice/chat` (`text/`), which runs the text
  model server-side and returns tool calls for the browser to execute.

Tool execution is client-side in both cases, because that is where the DOM and the router live. No
tool may branch on `ctx.mode` for anything except phrasing — a capability that exists by voice and
not by text is a bug.

## Addendum 3 — reconciliations (arbitrated after the kernel slice landed)

The kernel port surfaced eight seams that two slices each had an opinion about. These are the
rulings; they are now in the contracts.

1. **The persona lives in `BOSS_CLINICIAN_PERSONA`** (frontend contract) and every policy's
   `instructions` **begins with it**. The browser re-sends `delegation.responses.instructions` after
   the handshake, overwriting the broker's copy — so a persona held only on the server survives
   only until the handshake. The broker still sets it, for the window before that.
2. **Models come from the server.** `VoiceSessionResponse` now carries `backendModel` and `voice`;
   the browser echoes them instead of hardcoding a second name. Verified reachable with this
   deployment's key: `gpt-live-1` (voice) and `gpt-6-astra` (delegation brain).
3. **Members authenticate with a bearer header, not a cookie.** The member refresh cookie is
   `path=/api/auth` and never reaches `/api/voice/*`. Every voice route MUST read
   `Authorization: Bearer` for members as well as the admin cookie session, or `resolveSurface`
   quietly demotes every signed-in member to `public`.
4. **There is no CSRF token header in this app** — `memberAuthCsrf`/`adminCsrf` are Origin and
   `Sec-Fetch-Site` checks that a same-origin fetch already satisfies. Do not invent one.
5. **The output voice travels as a validated `?voice=` query param** on `/api/voice/connect`; the
   broker checks it against `LIVE_VOICES` and falls back to `coral`.
6. **`VoiceSessionHandle` exposes the server's verdict**: `activeSurface` and `recording`, so the UI
   can say "you're on the public concierge because you're signed out" and show the disclosure from
   what the server actually decided rather than what the browser hoped for.
7. **Recordings stream in chunks, they do not upload at the end.** `MediaRecorder.stop()` plus one
   `PUT` does not survive a closed tab, which is precisely how a recording feature ends up with
   nothing in it. Audio posts every few seconds to `PUT /api/voice/recording?sessionId=…&seq=N`,
   and the store appends. This is why CallSphere streamed too.
8. `VoiceApiClient` deliberately has no `put` — a tool has no business shipping audio. The recording
   upload is its own function in the kernel's `api-client.ts`.

## Addendum 4 — rulings after the tools slice

1. **`VoiceApiClient` gains `put` and `del`.** Most admin mutations here are PUTs, so a client
   without `put` is a concierge that can propose an action it can never run.
2. **`createVoiceApiClient` DELEGATES, it does not reimplement.** `lib/memberApi.ts` holds the
   member bearer in module state; `lib/adminTransport.ts` carries the admin cookie session. Paths
   are relative to `/api` (`/member/library`, `/admin/leads/12`, `/voice/tour-progress`).
3. **`adminCsrf` and `memberAuthCsrf` are Origin / `Sec-Fetch-Site` checks, not token headers** —
   verified in `backend/src/auth/adminSession.ts` and `auth/memberCsrf.ts`. A same-origin fetch
   satisfies them. Nobody adds a CSRF token.
4. **Two gates, both must pass.** A destination is navigable only if the catalog allows it for the
   surface AND its path is not under a higher surface's prefix. Belt and braces on purpose.
5. **One caption clock.** The renderer of captions owns it, feeding `captionFocusContext` →
   `spotlightSpokenText` per active word. Do not port a second clock.
6. **A `risk: "destructive"` approval ignores a spoken yes** and keeps the card up until a click or
   a timeout. The tool-side gate is then a second line of defence that never fires in normal use.

## September 19 release: streaming, operation catalog, and verification

The text concierge now requests real provider streaming. `POST /api/voice/chat` uses SSE only
when `Accept: text/event-stream` is explicitly requested; existing JSON clients retain JSON.
The stream sends `session`, visible `delta` fragments, then one authoritative `done` envelope
containing the final text and complete tool calls. Provider failures send `error`. The browser
must receive `done` before executing any tool; an interrupted stream cannot execute partial
arguments. Proxy buffering is disabled through `X-Accel-Buffering: no`. The widget displays
provider fragments as they arrive, with a cursor that respects reduced-motion preferences.
The transport uses the existing authenticated member fetch, including cookies and bearer-token
refresh. Session identification arrives before tools run so first-turn approvals can be audited.

Both voice and text still execute the same navigation, page-reading, pointing, tour, account,
and approval tools. Public narration and chat suggestions no longer sell the retired one-to-one
offers. Guided itineraries cover concrete registered destination pages; individual record/detail
routes depend on real records and are reached through their list pages, not invented identifiers.

### Approved admin changes

The four existing specific actions remain: publish/unpublish a blog post, update an enquiry's
status, and add a contact note. `admin_operation_catalog` additionally discovers **40 CRUD
operations across 14 resources**. Thirteen support create/update/delete: blog, courses,
testimonials, resources, tags, segments, contacts, members, forms, events, sequences,
assessments, and automations. Pages support update by slug only.

The operation schemas import the validators used by the actual admin handlers. The discovery
endpoint describes one resource/action at a time. `admin.request` first calls
`/api/voice/admin-catalog/prepare` to validate and normalize the payload, then shows that exact
payload in the approval card. Execution uses the resulting fixed internal path and method;
external URLs, traversal, authentication endpoints, and unknown resources are refused.
The normal admin API remains responsible for current session and module permissions on each
read and mutation. Catalog access itself requires administrator authentication.

Members and tags have no generic GET-by-id handler; discovery reads their actual list endpoint
and filters the returned records when an id is supplied. Forms use `/api/admin/forms-v2`.
Catalog schema sizes were measured at 104–2570 JSON characters in this checkout, within the
7500-character tool-output bound. Long record lists may still be shortened for model context.

The generic operation path requires a click on **Approve**, with full field values visible in a
scrollable card. A spoken or typed yes cannot approve a sensitive/destructive request. Existing
normal-risk actions retain voice/chat approval. A note records context and does not change the
payload; revising values requires declining and creating a new proposal. Approvals expire and
are consumed once. A decline never performs the requested mutation.

This is an explicit operation catalog, **not arbitrary coverage of every admin button**.
Uploads, authentication/team credentials, payment/refund operations, and nested operations not
listed by discovery must be completed in their own screens. The assistant must explain that
limit and navigate to the appropriate page. Additions require actual route/method/schema
metadata and the same approval path, rather than allowing a model-supplied URL.

### Provider lifecycle

The implementation was checked against the current official
[GPT-Live session guidance](https://developers.openai.com/api/docs/guides/live-conversations)
and [delegation guidance](https://developers.openai.com/api/docs/guides/live-delegation).
Startup waits for `session.started`. Configuration changes are sent as
`session.update` with delegation settings. Function calls are collected from nested
`response.output_item.done` within `response.event`; the empty output snapshot of the nested
completion event is not treated as the function-call list. Each executed call returns a
`response.item.create` function result, followed by `response.create` only once pending results
are supplied. Backend completion is not evidence of played speech: playback state uses the
remote audio waveform. Transcript deltas are persisted as grouped fragments, not authoritative
turn-completion events.

Graceful close installs the `session.closed` listener before `session.close`, retains the peer
and data channel while final events drain, and releases resources after confirmation or the
15-second application timeout. Timeout produces an explicit unconfirmed-finalization console
warning. Cumulative `usage.seconds` replaces prior duration; it is not summed. Local/S3 recording
chunks are separate application recordings and do not depend on OpenAI stored-session recording.

### Evidence and release checks

Local verification completed before deployment: frontend typecheck and all **353 frontend
unit tests** passed; backend typecheck and **1192 backend tests** passed, with **274 integration
tests skipped** by the existing test harness. Focused tests cover split SSE frames, Unicode
provider fragments, early disconnect/error handling, JSON fallback, tool-call preservation,
actual schema validation, path rejection, exact approved payload, single-use execution, and
refused/destructive approvals. These tests do not establish a live provider or S3 result.

Required manual production checks for the release record:

1. Open public, member, and admin chat; confirm the greeting identifies Boss Clinician AI and
   visible reply text grows before the request completes. Ask each to navigate, read the current
   page, point at visible content, and start/advance/end a tour.
2. Ask admin chat to create a disposable tag. Confirm no tag exists before approval, decline the
   first proposal, then approve a fresh proposal and verify the actual tag row. Confirm a typed
   yes leaves the sensitive approval card pending. Delete the test tag through a fresh approval.
3. Verify anonymous/member callers cannot access the admin catalog or mutate admin resources;
   verify a limited admin's catalog-driven actions retain the module API's permission rejection.
4. Start voice with a microphone, observe actual `session.started`, delegation and audible output,
   navigate while connected, then end and observe `session.closed`. Inspect persisted transcript
   and the private S3 recording through the admin session detail, including playback.
5. Verify member account reads show only that member's data and a second identity cannot append
   transcript/recording chunks to another caller's session.

Live browser/provider/storage evidence is recorded separately under `docs/verification`; do not
promote this local-test section to proof of a production pass.
