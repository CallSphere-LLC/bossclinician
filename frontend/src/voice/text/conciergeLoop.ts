/**
 * conciergeLoop.ts — the text transport's turn, with nothing React or browser
 * shaped left in it.
 *
 * The typed concierge is the same agent as the spoken one; only the wire
 * differs. Where the voice kernel streams events over a data channel, this
 * posts the conversation to `/api/voice/chat`, gets back either a reply or a
 * list of tool calls, runs those tool calls HERE — in the browser, where the
 * router, the DOM and the cursor are — and posts again with their output. That
 * loop is the whole of the text transport, and it is written as a plain
 * function taking an injected `send` so it can be reasoned about, and tested,
 * without a server, a DOM or a rendered component.
 *
 * Two things this file is stubborn about, because both are failure modes a
 * person feels immediately:
 *
 *  - A model that keeps calling tools and never speaks is a spinner that never
 *    stops. The round cap turns that into an error somebody can read.
 *  - A tool that throws is not the end of the turn. The throw becomes the tool
 *    output, the model gets told what went wrong, and it can apologise or try
 *    something else — which is exactly what a person standing in front of a
 *    half-finished action needs to hear.
 */

import type {
  ConciergeChatMessage,
  ConciergeChatRequest,
  ConciergeChatResponse,
  ConciergeTool,
  VoiceSurface,
} from "@/voice/contract";

/**
 * How many times one typed line may go to the model before the turn is
 * abandoned. A real answer takes two or three — travel somewhere, read the
 * page, then speak — so six leaves room for a guided-tour stop with several
 * beats while still cutting a confused model off long before a person would
 * have given up on their own.
 */
export const MAX_TOOL_ROUNDS = 6;

/**
 * A page read of a long article is far more text than the model needs and more
 * than the route should carry, so tool output is clipped with the truncation
 * said out loud rather than silently.
 */
export const MAX_TOOL_OUTPUT_CHARS = 4_000;

/**
 * How many messages may travel in one request.
 *
 * The route refuses a conversation longer than forty, and a turn GROWS: every
 * tool call adds a line, so a long chat plus a busy walkthrough stop can cross
 * that line halfway through a turn the person is already watching. The oldest
 * messages are dropped instead, because the recent ones are the conversation
 * and the ancient ones are the small talk.
 */
export const MAX_WIRE_MESSAGES = 36;

export type ConciergeFailureReason = "stalled" | "round-cap";

/**
 * A turn that ended without an answer. It carries the reason because the two
 * cases deserve different words in front of a person: one is the model saying
 * nothing at all, the other is it going round in circles.
 */
export class ConciergeLoopError extends Error {
  readonly reason: ConciergeFailureReason;

  constructor(reason: ConciergeFailureReason, message: string) {
    super(message);
    this.name = "ConciergeLoopError";
    this.reason = reason;
  }
}

/** The part of a tool the server is allowed to see: never its `execute`. */
export function toolDescriptors(tools: readonly ConciergeTool[]): ConciergeChatRequest["tools"] {
  return tools.map((entry) => ({
    name: entry.name,
    description: entry.description,
    parameters: entry.parameters,
  }));
}

/**
 * A tool's return value as the model will read it.
 *
 * `undefined` becomes `"null"` rather than an empty string because a tool that
 * quietly returned nothing still ran, and a blank output reads to the model as
 * a failure it will try to work around.
 */
export function toolOutputContent(value: unknown): string {
  let text: string;
  if (value === undefined) {
    text = "null";
  } else if (typeof value === "string") {
    text = value;
  } else {
    try {
      text = JSON.stringify(value) ?? String(value);
    } catch {
      // A value with a cycle in it (a DOM node that leaked into a result) is
      // still worth reporting as something rather than crashing the turn.
      text = String(value);
    }
  }
  return text.length > MAX_TOOL_OUTPUT_CHARS
    ? `${text.slice(0, MAX_TOOL_OUTPUT_CHARS)}… (shortened)`
    : text;
}

/** What one typed line produced, once the loop has run itself out. */
export type ConciergeTurn = {
  /** The answer to show. Never empty — an empty answer is an error instead. */
  reply: string;
  /**
   * Anything the agent said on its way through the tool calls, in order. It is
   * shown as it arrives, the way a person narrating a walkthrough talks while
   * they move rather than only at the end.
   */
  interim: string[];
  /** The row the server hung this conversation on, for the transcript. */
  sessionId: string | null;
  /** Which tools actually ran, so the caller can react to a `start_guided_tour`. */
  toolNames: string[];
  /**
   * The surface the server granted, which may be lower than the one asked for.
   * Null only while a server that predates the field is still answering.
   */
  grantedSurface: VoiceSurface | null;
  /** Trips to the server this turn took. Useful in a test, and in a log. */
  rounds: number;
};

export type ConciergeTurnInput = {
  surface: VoiceSurface;
  /** Null until the server has named the conversation; it does that on the first reply. */
  sessionId: string | null;
  /** The conversation so far, newest last, already including this turn's user line. */
  history: readonly ConciergeChatMessage[];
  tools: readonly ConciergeTool[];
  /**
   * Read fresh on every round, never captured once: a tool call in round one
   * may well have navigated, and the model must be told where the person is
   * standing NOW, not where they were when they pressed send.
   */
  getLocation: () => string;
  send: (request: ConciergeChatRequest) => Promise<ConciergeChatResponse>;
  /**
   * Called with anything the agent says on its way through the tool calls, as
   * it says it. A walkthrough that announces "let me take you there" before it
   * travels reads like someone talking while they walk; holding every word
   * until the last tool has finished reads like a frozen window.
   */
  onInterim?: (text: string) => void;
  /**
   * Called with the surface the server granted, as soon as it says so — which
   * is before the answer, so a person can be told why the answer is going to be
   * thinner than they expected rather than after the fact.
   */
  onSurface?: (granted: VoiceSurface) => void;
  maxRounds?: number;
};

export async function runConciergeTurn(input: ConciergeTurnInput): Promise<ConciergeTurn> {
  const maxRounds = input.maxRounds ?? MAX_TOOL_ROUNDS;
  const byName = new Map(input.tools.map((entry) => [entry.name, entry] as const));
  const messages: ConciergeChatMessage[] = [...input.history];
  const interim: string[] = [];
  const toolNames: string[] = [];
  let sessionId = input.sessionId;
  let grantedSurface: VoiceSurface | null = null;

  for (let round = 1; round <= maxRounds; round += 1) {
    const response = await input.send({
      sessionId,
      surface: input.surface,
      path: input.getLocation(),
      messages: messages.slice(-MAX_WIRE_MESSAGES),
      tools: toolDescriptors(input.tools),
    });
    if (response.sessionId) sessionId = response.sessionId;
    if (response.surface && response.surface !== grantedSurface) {
      grantedSurface = response.surface;
      input.onSurface?.(response.surface);
    }

    const spoken = response.reply?.trim() ?? "";
    const calls = response.toolCalls ?? [];

    if (calls.length === 0) {
      if (spoken) {
        return { reply: spoken, interim, sessionId, toolNames, grantedSurface, rounds: round };
      }
      throw new ConciergeLoopError(
        "stalled",
        "The assistant came back with nothing to say and nothing to do.",
      );
    }

    // The model often narrates before it acts — "let me show you" — and that
    // line is worth showing immediately rather than holding until the tools
    // have finished. It also goes back on the wire so the model can see what
    // it has already told the person.
    if (spoken) {
      interim.push(spoken);
      input.onInterim?.(spoken);
      messages.push({ role: "assistant", content: spoken });
    }

    // Strictly in order, one at a time. Travelling to a page and then pointing
    // at something on it is the common pair, and running those two at once
    // points at a page that has not arrived yet.
    for (const call of calls) {
      const tool = byName.get(call.name);
      let content: string;
      if (!tool) {
        content = toolOutputContent({
          ok: false,
          error: `There is no tool called "${call.name}" on this surface.`,
        });
      } else {
        toolNames.push(call.name);
        try {
          content = toolOutputContent(await tool.execute(call.arguments ?? {}));
        } catch (error) {
          content = toolOutputContent({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      messages.push({ role: "tool", toolCallId: call.id, name: call.name, content });
    }
  }

  throw new ConciergeLoopError(
    "round-cap",
    "The assistant kept working without answering, so I stopped it.",
  );
}

/* ============================ approval by typing ======================== */

const YES_WORDS = [
  "yes", "yep", "yeah", "yup", "sure", "ok", "okay", "approve", "approved",
  "confirm", "confirmed", "go ahead", "do it", "send it", "please do",
];

const NO_WORDS = [
  "no", "nope", "nah", "cancel", "stop", "don't", "do not", "reject", "decline",
  "not now", "never mind", "nevermind", "hold off", "leave it",
];

/** What the owner typed at an approval card, read as an answer. */
export type ApprovalAnswer = { approved: boolean; note?: string };

/**
 * Yes or no, from a line typed while a change is waiting.
 *
 * Only the OPENING of the line decides, and the rest is kept as the note. That
 * is what lets "yes, but make it a draft" approve the change and still carry
 * the amendment, while refusing to read "I don't think anyone would say no to
 * that" as consent: an approval must come from the front of the sentence,
 * where a person puts their answer, not from a word found anywhere in it.
 *
 * A line that answers neither returns null, and the caller asks again. Silence
 * and ambiguity both mean "not yet", never "go".
 */
export function readApprovalAnswer(raw: string): ApprovalAnswer | null {
  const text = raw.trim().toLowerCase().replace(/^[\s"'(]+/, "");
  if (!text) return null;

  const match = (words: string[]): string | null => {
    for (const word of words) {
      if (text === word) return word;
      // A word boundary made of punctuation or a space, so "nope." answers and
      // "nothing" does not.
      if (text.startsWith(word) && /^[\s,.!;:—-]/.test(text.slice(word.length))) return word;
    }
    return null;
  };

  // No is checked first: "no, go ahead and cancel it" must not be read as a yes
  // because "go ahead" appears later in the line.
  const refused = match(NO_WORDS);
  if (refused) return withNote(false, raw.trim().slice(refused.length));
  const agreed = match(YES_WORDS);
  if (agreed) return withNote(true, raw.trim().slice(agreed.length));
  return null;
}

function withNote(approved: boolean, rest: string): ApprovalAnswer {
  const note = rest.replace(/^[\s,.!;:—-]+/, "").trim();
  return note ? { approved, note } : { approved };
}
