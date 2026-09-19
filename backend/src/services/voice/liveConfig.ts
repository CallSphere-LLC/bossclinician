/**
 * liveConfig.ts — what the model is told, and which models are told it.
 *
 * Ported from the CallSphere site's `lib/live-config.ts`, with three deliberate
 * differences:
 *
 *  - The persona is Boss Clinician's, copied from `BOSS_CLINICIAN_PERSONA` in
 *    the frontend contract. Copied rather than imported, because the backend
 *    cannot reach across that boundary; if the two ever disagree, the frontend
 *    contract is the canonical one.
 *  - The surface's rules are read from this file rather than from the request.
 *    The browser says which surface it thinks it is on, the server decides what
 *    that surface actually is (`resolveSurface`), and the words the model is
 *    given follow the server's answer. A bundle that could post its own
 *    instructions could talk the concierge out of every rule below.
 *  - The model names come from the contract, which both halves read, so the
 *    voice and the brain cannot be named differently by the two sides.
 *
 * What this config governs is the window BEFORE the handshake. The browser
 * re-registers `delegation.responses` once its data channel is open — it has to,
 * because the tools are the DOM's and only it knows which of them exist on the
 * page — and that overwrites the instructions and the tool list set here. This
 * is deliberate, not a race: the server's copy is what the agent opens its
 * mouth with, and the browser's copy is what it thinks with a moment later.
 *
 * Pure data and one builder, so it can be read without a key.
 */

import { LIVE_BACKEND_MODEL, LIVE_MODEL, type VoiceSurface } from "./contract";

/** The GPT-Live output voices. `coral` and `shimmer` read as warm female. */
export const LIVE_VOICES = [
  "alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse", "marin", "cedar",
] as const;
export type LiveVoice = (typeof LIVE_VOICES)[number];

/** One voice on all three surfaces: it is one assistant, not three. */
export const CONCIERGE_VOICE: LiveVoice = "coral";

/**
 * The voice a caller asked for, if it is one that exists.
 *
 * Validated rather than trusted because the value goes into the body of a
 * billable provider call, and an unknown voice there fails the whole session
 * rather than degrading — a mistyped query parameter would read as "the
 * microphone is broken".
 */
export function liveVoice(requested: unknown): LiveVoice {
  return typeof requested === "string" && (LIVE_VOICES as readonly string[]).includes(requested)
    ? (requested as LiveVoice)
    : CONCIERGE_VOICE;
}

/**
 * The model names, from the contract, with an override each.
 *
 * The overrides exist so a model can be swapped on a running deployment without
 * a release; they are unset, and the contract's verified names are what run.
 */
export const liveModel = (): string => process.env.OPENAI_LIVE_MODEL?.trim() || LIVE_MODEL;
export const backendModel = (): string =>
  process.env.OPENAI_BACKEND_MODEL?.trim() || LIVE_BACKEND_MODEL;

/**
 * Who the concierge is, on every surface. A copy of `BOSS_CLINICIAN_PERSONA`
 * from frontend/src/voice/contract.ts.
 *
 * The line about Yvette is not politeness. This app is one woman's practice and
 * her name is on the door; an assistant that lets a visitor believe they are
 * talking to her is the one failure here that damages something real.
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
  "Greet warmly and offer to navigate pages and explain their details in simple language, one detail at a time.",
  "An offer is not consent: never start a tour or navigate just because you greeted someone. Wait for their yes or explicit request.",
  "After consent, use start_guided_tour and explain only its returned page or section. Wait for the person to say next or continue before next_tour_stop.",
  "Answer questions in place without advancing. Never chain tour steps or bypass the tour tools with navigate_to. They can ask questions, skip, or stop anytime.",
  "Do not ask for permission for every sentence: the initial yes starts the tour, and next sets their pace. A specific request to open a page authorizes that navigation.",
].join(" ");

/**
 * What each surface adds to the persona.
 *
 * The server's copy. The browser has its own wording on each policy object, and
 * replaces this one after the handshake; this is what the agent greets somebody
 * with in the second before that.
 */
export const SURFACE_INSTRUCTIONS: Record<VoiceSurface, string> = {
  public: `You are on the public site, talking to someone who may never have heard of Boss Clinician. Help them work out which of the offers fits where they are — building a practice, scaling one, or getting out of platform work — and take them to the page that says so. You have no access to anybody's account, so if they ask about their own orders or courses, say that signing in is what unlocks that and offer to take them to the sign-in page.`,

  member: `You are in a member's own portal, and they are signed in. You may read back their own courses, progress, orders and receipts, and nothing belonging to anyone else — every lookup you make is scoped to them by the server, so if something comes back empty, it is empty for them. Help them find where they left off and answer questions about what they own.`,

  admin: `You are in the owner's admin, talking to Yvette or someone she has given an account. You may look things up freely, and you may carry out real changes ONLY through the two-step path: propose the action, wait for her to approve it in so many words, then run it. Never take silence, a change of subject or a vague "sure" as approval, and never run a deletion or a refund on a spoken yes alone — those need the approval card clicked. Say what a change will do in her words before you ask, not in the API's.`,
};

/** Persona plus the surface's rules, which is what either half sends. */
export function conciergeInstructions(surface: VoiceSurface): string {
  return `${BOSS_CLINICIAN_PERSONA}\n\n${SURFACE_INSTRUCTIONS[surface]}`;
}

/**
 * The session body for `POST {base}/live/sessions`.
 *
 * GPT-Live runs a fast speech model in front and delegates the thinking to a
 * text model behind it. The persona belongs to the front half, because that is
 * the voice; the surface's rules and the tools belong to the delegated half,
 * because that is what decides. The source this is ported from passed its
 * `instructions` argument to the delegate only and left the outer session on a
 * constant — worth keeping straight here, since the outer half is what speaks.
 *
 * `tools` is empty by design: the browser pushes its own list over the data
 * channel as soon as the channel opens, for the reason in the file header.
 */
export function liveSessionConfig(input: {
  surface: VoiceSurface;
  tools?: unknown[];
  voice?: LiveVoice;
}): Record<string, unknown> {
  return {
    model: liveModel(),
    instructions: BOSS_CLINICIAN_PERSONA,
    audio: { output: { voice: input.voice ?? CONCIERGE_VOICE } },
    delegation: {
      type: "responses",
      responses: {
        model: backendModel(),
        instructions: conciergeInstructions(input.surface),
        tools: input.tools ?? [],
        reasoning: { effort: "low" },
        max_output_tokens: 4096,
        tool_choice: "auto",
        // One tool at a time. Every tool here moves the page the human is
        // looking at, and two of them firing together is a navigation racing a
        // spotlight for the same screen.
        parallel_tool_calls: false,
      },
    },
  };
}
