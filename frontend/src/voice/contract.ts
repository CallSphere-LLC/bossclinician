/**
 * contract.ts — the one seam every part of the voice concierge is built against.
 *
 * The concierge is the same machine on all three surfaces of this app (the public
 * site, a member's portal, the owner's admin). What differs between them is
 * DATA, not code: where it may travel, what it may do, what it may say, and who
 * the server will open a session for. That difference is a `VoiceSurfacePolicy`.
 *
 * Consequences worth stating, because they are the reason for the shape:
 *  - Open/closed: a new destination, tool or surface is a new object in a list.
 *    The kernel (WebRTC + the live protocol) never learns about any of them.
 *  - Dependency inversion: tools receive a `VoiceContext` — navigate, where am
 *    I, ask for approval — so no tool imports React, the router or a fetch
 *    client. That is also what makes them testable without a DOM.
 *  - Role-based access is enforced TWICE and deliberately: the policy decides
 *    what the model is even told it can do, and the server re-decides on every
 *    admission and every privileged tool call. The browser copy is UX; the
 *    server copy is security.
 *
 * SSR-safe: types + pure data only. No `window`, no imports with side effects.
 */

/* ============================== surfaces =============================== */

/** Which of the three faces of the app a session is running on. */
export type VoiceSurface = "public" | "member" | "admin";

/** Who the server must have authenticated before it opens a session. */
export type VoiceAudience = "anonymous" | "member" | "admin";

/* ============================ destinations ============================= */

export type VoiceDestination = {
  /** Stable key the model picks from. Unique within a surface. */
  key: string;
  /** In-app path, always absolute, always same-tab (the call stays live). */
  path: string;
  /** Human label for logs and the transcript. */
  label: string;
  /** Natural-language ways a person asks for this place. */
  aliases: string[];
  /** One grounded line the agent leans on after it arrives. */
  narration: string;
  /**
   * Surfaces allowed to travel here. A public session can never be handed an
   * admin path: the catalog it is given simply does not contain one.
   */
  surfaces: readonly VoiceSurface[];
};

/* =============================== tools ================================= */

/**
 * The capabilities a policy can switch on. Each maps to exactly one factory in
 * tools/registry.ts. Adding one is: a name here, a factory there, a line in the
 * policies that want it.
 */
export type VoiceToolName =
  | "navigate_to"
  | "go_back"
  | "read_current_page"
  | "point_at"
  | "stop_pointing"
  | "search_site"
  | "my_account_summary"
  | "admin_operation_catalog"
  | "propose_admin_action"
  | "run_approved_action"
  | "start_guided_tour"
  | "next_tour_stop"
  | "end_guided_tour";

/**
 * What a tool is given instead of reaching for globals. The launcher supplies
 * it; tests supply a fake.
 */
export type VoiceContext = {
  /** Same-tab client navigation (react-router). Never a full page load. */
  navigate: (path: string) => void;
  /** Current location key, read fresh on every call (path + search + hash). */
  getLocation: () => string;
  /** The session's surface, so a tool can refuse a cross-surface request. */
  surface: VoiceSurface;
  /** Voice or text. Affects phrasing only, never what is allowed. */
  mode: ConciergeMode;
  /**
   * The row this conversation is being recorded against, read at the moment a
   * tool runs; null before the server has opened one.
   *
   * A FUNCTION, for the same reason `getLocation` is one: the context is built
   * once, before the session exists, so a plain value captured there would be
   * null forever and every audit entry would quietly go unwritten. A tool needs
   * this to file its entry against the right conversation — the alternative, a
   * tool guessing or reaching for the most recent session, would file one
   * person's approvals against another person's call, and a wrong audit trail
   * is worse than an empty one: it looks like evidence.
   */
  getSessionId: () => string | null;
  /** Actual latest human turn, never model-supplied consent. */
  getUserTurn?: () => { id: number; text: string } | null;
  /**
   * Ask the human to approve a privileged action, in the UI and out loud. It
   * resolves when they answer by voice OR in the approval card / chat, and
   * resolves `false` on timeout. Only ever present for the admin surface.
   */
  requestApproval?: (request: ApprovalRequest) => Promise<ApprovalOutcome>;
  /** Server calls, already carrying the session's credentials. */
  call: VoiceApiClient;
};

/**
 * The app's own API, with whatever this app's surfaces actually use to
 * authenticate — which is not one mechanism, and not a thing to reimplement.
 * An implementation DELEGATES: `lib/memberApi.ts` holds the member's bearer
 * token in module state, and `lib/adminTransport.ts` carries the admin cookie
 * session (the `adminCsrf` check it satisfies is an Origin check, not a token
 * header — do not invent one). Paths are relative to `/api`.
 *
 * Injected so a tool never owns a fetch client and a test never needs a server.
 */
export type VoiceApiClient = {
  patch?: <T>(path: string, body?: unknown) => Promise<T>;
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  /**
   * Most of this app's admin mutations are PUTs — a lead's status and a post's
   * published flag have no POST equivalent — so a client without `put` is a
   * concierge that can propose an action it can never carry out.
   */
  put<T>(path: string, body?: unknown): Promise<T>;
  del<T>(path: string): Promise<T>;
};

/**
 * The realtime SDK shim's `tool()` is injected, never imported, so the tool
 * modules stay out of the initial bundle and off the server render path.
 */
export type ToolFn = (options: unknown) => unknown;

/**
 * What a built tool actually is, once `toolFn` has wrapped it.
 *
 * This shape is the reason the concierge behaves identically whether someone is
 * TALKING to it or TYPING at it: the tools are plain descriptors with a local
 * `execute`, so the voice transport (GPT-Live over WebRTC) and the text
 * transport (a chat loop against the app's own model route) consume the very
 * same list. Navigation, the cursor and page reading run in the browser in both
 * cases — only the model's transport differs. Nothing about a tool may assume
 * it is being called by a voice session.
 */
export type ConciergeTool = {
  name: VoiceToolName | string;
  description: string;
  /** JSON Schema for the arguments, as both transports send to the model. */
  parameters: Record<string, unknown>;
  strict?: boolean;
  /** Runs in the browser. Returns the model-facing result (JSON-serialisable). */
  execute: (args: Record<string, unknown>) => Promise<unknown> | unknown;
};

/** Which way the human is conversing. Tools may narrate slightly differently —
 * "as you can see highlighted" reads oddly when it was typed — but they must
 * never gate a capability on it. */
export type ConciergeMode = "voice" | "text";

/** A capability: one self-contained factory, assembled by the registry. */
export type VoiceToolFactory = (toolFn: ToolFn, ctx: VoiceContext) => unknown;

/* ============================= guided tour ============================= */

/**
 * One stop on the walkthrough.
 *
 * The tour is an ITINERARY — data, like the destination catalog — because the
 * thing that dates fastest about a guided tour is the product it describes. A
 * new admin page becomes one more stop, not a change to the tour engine.
 *
 * `beats` are what the agent points at and explains once it has arrived, in
 * order. Each beat's `focus` is a human label the spotlight resolves against
 * the live page (the same labels `point_at` accepts), so a beat that no longer
 * matches anything is skipped rather than fatal — a renamed button must not
 * strand a first-time visitor mid-tour.
 */
export type TourStop = {
  /** Destination key from the same surface's catalog. */
  destination: string;
  /** What this page is for, in one or two sentences the agent can lean on. */
  purpose: string;
  beats: { focus: string; say: string }[];
};

/** Where a walkthrough got to, so it survives a refresh or a dropped call. */
export type TourProgress = {
  surface: VoiceSurface;
  /** Index of the stop currently being narrated. */
  index: number;
  /** Set once the visitor has finished or declined the tour. */
  completed: boolean;
  updatedAt: number;
};

/* ============================== approval =============================== */

export type ApprovalRequest = {
  /** Stable id of the action the agent wants to run. */
  actionId: string;
  /** What the owner will see and hear, in her words, not the API's. */
  title: string;
  summary: string;
  /** Field-by-field preview of the change. Rendered as a diff-ish list. */
  details: { label: string; value: string }[];
  /** "Destructive" gets a heavier confirmation and never a voice-only yes. */
  risk: "normal" | "destructive";
};

export type ApprovalOutcome = {
  approved: boolean;
  /** How the human answered — recorded on the session for the audit log. */
  via: "voice" | "chat" | "click" | "timeout" | "cancelled";
  /** Free-text amendment ("yes but make it a draft"), when they gave one. */
  note?: string;
};

/* =============================== policy ================================ */

/**
 * Everything that makes one surface's concierge different from another's.
 * This object is the ONLY thing a new surface has to write.
 */
export type VoiceSurfacePolicy = {
  surface: VoiceSurface;
  /** Who the server must have authenticated first. */
  audience: VoiceAudience;
  /** Spoken identity. All three say "I am Boss Clinician AI". */
  agentName: string;
  /** GPT-Live output voice. Warm female across the app. */
  voice: LiveVoice;
  /** Surface-specific system instructions, appended to the shared persona. */
  instructions: string;
  /** What the agent opens with once the mic is live. */
  greeting: string;
  /**
   * What it opens with the FIRST time this person arrives on this surface. It
   * introduces itself and offers the walkthrough in one breath, then waits —
   * an offer, never an ambush. Declining is remembered, so the offer is made
   * once and the visitor is never asked again.
   */
  firstVisitGreeting: string;
  /** The walkthrough for this surface, in the order a newcomer should see it. */
  tour: readonly TourStop[];
  /** Capabilities switched on here. Anything absent is not even described. */
  tools: readonly VoiceToolName[];
  /** Where it may travel on this surface. */
  destinations: readonly VoiceDestination[];
  /** Hard cap on one call, in seconds. */
  maxSessionSeconds: number;
  /** Whether audio is captured and stored for this surface. */
  recordAudio: boolean;
};

/**
 * The one spoken identity, shared by every surface.
 *
 * It lives here, and every policy's `instructions` begins with it, because the
 * browser has the last word on instructions: the session shim re-sends them as
 * `delegation.responses.instructions` once GPT-Live confirms the session, which
 * overwrites whatever the broker set at mint time. A persona defined only on
 * the server is therefore a persona that survives exactly until the handshake
 * completes — which is the subtle way an agent ends up introducing itself
 * wrong on the very first real call.
 */
export const BOSS_CLINICIAN_PERSONA = [
  "You are Boss Clinician AI, the voice of Boss Clinician — Yvette Howard's coaching practice for",
  "therapists building independent private practices. Introduce yourself as \"Boss Clinician AI\".",
  "You are NOT Yvette and must never imply that you are her, speak as her, or answer as though her",
  "personal clinical judgement were yours; when someone wants her, offer to take them to the page",
  "where they can reach her. Be warm, brief and concrete. Speak in the visitor's language. Listen",
  "while you speak and adapt the moment you are corrected. You can move around this app yourself:",
  "take people to pages, point at what you are describing, and read what is on the screen. Never",
  "invent a record, a price or a result, and never claim an action succeeded unless a tool told you",
  "it did. You are not a clinician: do not give personal medical, legal or financial advice.",
  "When speaking aloud, use a calm, warm, reassuring tone and an unhurried conversational pace. Use short sentences and natural pauses. Avoid an excited sales pitch, exaggerated emphasis, or rushing. Stay clear and audible; do not whisper.",
  "Greet warmly and offer to navigate pages and explain their details in simple language, one detail at a time.",
  "An offer is not consent: never start a tour or navigate just because you greeted someone. Wait for their yes or explicit request.",
  "After consent, use start_guided_tour and explain only its returned page or section. Wait for the person to say next or continue before next_tour_stop.",
  "Answer questions in place without advancing. Never chain tour steps or bypass the tour tools with navigate_to. They can ask questions, skip, or stop anytime.",
  "Do not ask for permission for every sentence: the initial yes starts the tour, and next sets their pace. A specific request to open a page authorizes that navigation.",
].join(" ");

/** The GPT-Live output voices. `coral` and `shimmer` read as warm female. */
export const LIVE_VOICES = [
  "alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse", "marin", "cedar",
] as const;
export type LiveVoice = (typeof LIVE_VOICES)[number];

/* ======================== browser ⇄ server shapes ====================== */

/** POST /api/voice/session — mint a one-use admission for a call. */
export type VoiceSessionRequest = {
  surface: VoiceSurface;
  /** Where the visitor is standing when they press the button. */
  path: string;
};

export type VoiceSessionResponse = {
  /** One-use bearer token for the SDP exchange. Never an OpenAI secret. */
  admission: string;
  /** Row id the transcript, recording and audit entries hang off. */
  sessionId: string;
  /** The surface the SERVER decided on — may be lower than the one asked for. */
  surface: VoiceSurface;
  maxSessionSeconds: number;
  /** True when this call is being recorded, so the UI can say so first. */
  recording: boolean;
  /**
   * The model that runs behind the live voice, named by the SERVER.
   *
   * The browser re-registers the delegation config when it installs its tools,
   * so both sides name a backend model — and two independently hardcoded names
   * is a brain that swaps mid-handshake. The server is the one holding the API
   * key, so the server decides and the browser echoes.
   */
  backendModel: string;
  /** The output voice the server chose for this surface. Same reasoning. */
  voice: LiveVoice;
};

/**
 * POST /api/voice/connect — body is `application/sdp`, the browser's offer;
 * `Authorization: Bearer <admission>`. The response is the SDP answer as
 * `application/sdp`. The OpenAI key never leaves the server, and the admission
 * is consumed, so a replay cannot open a second session.
 */
export type VoiceConnectError = { error: string };

/** POST /api/voice/transcript — append lines as they finalise. */
export type VoiceTranscriptAppend = {
  sessionId: string;
  lines: { role: "user" | "agent"; text: string; atMs: number }[];
};

/* =========================== text transport ============================ */

/**
 * POST /api/voice/chat — the text half of the concierge.
 *
 * The browser sends the conversation so far plus the tool descriptors its
 * surface owns; the server runs the text model and returns either a reply or
 * tool calls to execute locally. The browser executes them (navigate, point,
 * read the page), appends the outputs and calls again. The loop lives in the
 * browser because that is where the DOM and the router are — the server never
 * pretends to know what is on screen.
 */
export type ConciergeChatMessage =
  | { role: "user" | "assistant"; content: string }
  | { role: "tool"; toolCallId: string; name: string; arguments?: Record<string, unknown>; content: string };

export type ConciergeChatRequest = {
  sessionId: string | null;
  surface: VoiceSurface;
  path: string;
  messages: ConciergeChatMessage[];
  /** Descriptors only — never the `execute` functions. */
  tools: { name: string; description: string; parameters: Record<string, unknown> }[];
};

export type ConciergeChatResponse = {
  sessionId: string;
  /**
   * The surface the SERVER granted this turn — which may be lower than the one
   * the page asked for, when a session has quietly expired. The voice path
   * learns this from the admission; without it here, a signed-out person typing
   * on an admin URL gets an assistant that is mysteriously unable to do
   * anything, and no way to be told why. Parity between the two transports is
   * the whole premise, and that includes being told bad news.
   */
  surface: VoiceSurface;
  /** Spoken-equivalent reply text, if the model produced one this turn. */
  reply: string | null;
  /** Tool calls for the browser to execute and report back. */
  toolCalls: { id: string; name: string; arguments: Record<string, unknown> }[];
};

/* ============================== captions =============================== */

export type CaptionLine = {
  id: string;
  role: "user" | "agent";
  text: string;
  final: boolean;
};

/* ============================= page reading ============================ */

export type Kpi = { label: string; value: string };

export type PageSnapshot = {
  path: string;
  title: string;
  headings: string[];
  kpis: Kpi[];
  /** Short slice of the main body copy, viewport first. */
  excerpt: string;
  /** Labels `point_at` can be asked to focus. */
  focusTargets: string[];
  /** True when there was almost nothing to narrate (SPA still painting). */
  sparse: boolean;
};

/**
 * Opt-in narration markers. Authors tag an element with `data-narrate` (and
 * optionally `data-narrate-label`) to say "read this"; `data-narrate-skip`
 * removes a subtree. Chrome (nav/header/footer/aside) is skipped regardless.
 */
export const NARRATE_ATTR = "data-narrate";
export const NARRATE_LABEL_ATTR = "data-narrate-label";
export const NARRATE_SKIP_ATTR = "data-narrate-skip";
