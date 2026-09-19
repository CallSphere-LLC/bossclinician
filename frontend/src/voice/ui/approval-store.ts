/**
 * approval-store.ts — the owner's yes or no, wherever it comes from.
 *
 * A privileged action never runs on the agent's say-so. It calls
 * `requestApproval(...)`, which puts a card in front of the owner and returns a
 * promise; the promise settles when she answers, and it settles either way.
 * There are four ways an answer arrives and the store treats them as one:
 *
 *   • by voice — she says "yes, do it" and the agent calls back,
 *   • in the chat — she types a line into the card,
 *   • by click — she presses the button on the card,
 *   • by running out of time — silence is not consent, so it becomes a no.
 *
 * Two rules are worth stating out loud, because they are the whole point of
 * this file. A *destructive* change never accepts a spoken yes: a misheard word
 * must not be able to delete anything, so the card demands a click, rather than a spoken or typed
 * confirmation. And every answer records HOW it arrived, because the audit
 * trail of "who agreed to this" is worth as much as the change itself.
 *
 * The store is deliberately free of React, the DOM and any transport. That is
 * what lets the very same card and the very same rules serve the spoken
 * concierge and the typed one, and it is what lets the rules below be tested
 * without a browser.
 */

import type { ApprovalOutcome, ApprovalRequest } from "@/voice/contract";

/**
 * How long a card waits before it gives up. Long enough to read a field-by-field
 * preview and think about it, short enough that a forgotten card does not sit
 * on screen holding a half-finished request open.
 */
export const APPROVAL_TIMEOUT_MS = 90_000;

/** A request still waiting for an answer, as the card renders it. */
export type PendingApproval = {
  request: ApprovalRequest;
  /** Wall-clock moment this one turns into a "no" by itself. */
  expiresAt: number;
};

/**
 * What answering returned. An answer can be turned away — a spoken yes to a
 * destructive change, or an answer to something already settled — and the
 * caller needs to know which, because the agent has to say why nothing
 * happened rather than fall silent.
 */
export type AnswerResult = {
  accepted: boolean;
  reason?: "unknown-request" | "already-answered" | "needs-click";
};

export type ApprovalStore = {
  /** The `requestApproval` a `VoiceContext` is handed. */
  request: (request: ApprovalRequest) => Promise<ApprovalOutcome>;
  answerByVoice: (actionId: string, approved: boolean, note?: string) => AnswerResult;
  answerByChat: (actionId: string, approved: boolean, note?: string) => AnswerResult;
  answerByClick: (actionId: string, approved: boolean, note?: string) => AnswerResult;
  /** Called with no id when the call ends: nothing outlives the conversation. */
  cancel: (actionId?: string) => void;
  subscribe: (onChange: () => void) => () => void;
  getSnapshot: () => readonly PendingApproval[];
  getServerSnapshot: () => readonly PendingApproval[];
};

/** One shared empty array, so a server render and an idle browser agree. */
const NOTHING_PENDING: readonly PendingApproval[] = Object.freeze([]);

/** How many settled ids to remember, purely so a late second answer can be told
 *  "you already answered that" instead of "I have no idea what you mean". */
const SETTLED_MEMORY = 20;

export function createApprovalStore(options?: {
  timeoutMs?: number;
  now?: () => number;
}): ApprovalStore {
  const timeoutMs = options?.timeoutMs ?? APPROVAL_TIMEOUT_MS;
  const now = options?.now ?? (() => Date.now());

  type Entry = {
    pending: PendingApproval;
    settle: (outcome: ApprovalOutcome) => void;
    timer: ReturnType<typeof setTimeout>;
  };

  const entries = new Map<string, Entry>();
  const settled: string[] = [];
  const listeners = new Set<() => void>();
  // useSyncExternalStore compares snapshots by identity, so the list is rebuilt
  // once per change and handed out unchanged in between.
  let snapshot: readonly PendingApproval[] = NOTHING_PENDING;

  function publish() {
    snapshot = entries.size === 0
      ? NOTHING_PENDING
      : Object.freeze(Array.from(entries.values(), (entry) => entry.pending));
    for (const listener of listeners) listener();
  }

  function finish(actionId: string, outcome: ApprovalOutcome) {
    const entry = entries.get(actionId);
    if (!entry) return false;
    clearTimeout(entry.timer);
    entries.delete(actionId);
    settled.push(actionId);
    if (settled.length > SETTLED_MEMORY) settled.shift();
    entry.settle(outcome);
    publish();
    return true;
  }

  function answer(
    actionId: string,
    approved: boolean,
    via: ApprovalOutcome["via"],
    note?: string,
  ): AnswerResult {
    const entry = entries.get(actionId);
    if (!entry) {
      return {
        accepted: false,
        reason: settled.includes(actionId) ? "already-answered" : "unknown-request",
      };
    }
    // A spoken yes is not enough for something that cannot be undone. A spoken
    // NO always is — stopping a destructive change can never be the unsafe
    // reading of a misheard word.
    if (approved && via !== "click" && entry.pending.request.risk === "destructive") {
      return { accepted: false, reason: "needs-click" };
    }
    finish(actionId, note === undefined ? { approved, via } : { approved, via, note });
    return { accepted: true };
  }

  return {
    request(request) {
      return new Promise<ApprovalOutcome>((resolve) => {
        // A second proposal carrying an id that is already on screen replaces
        // the first, rather than stacking two cards for one change.
        finish(request.actionId, { approved: false, via: "cancelled" });
        const timer = setTimeout(() => {
          finish(request.actionId, { approved: false, via: "timeout" });
        }, timeoutMs);
        entries.set(request.actionId, {
          pending: { request, expiresAt: now() + timeoutMs },
          settle: resolve,
          timer,
        });
        publish();
      });
    },
    answerByVoice: (actionId, approved, note) => answer(actionId, approved, "voice", note),
    answerByChat: (actionId, approved, note) => answer(actionId, approved, "chat", note),
    answerByClick: (actionId, approved, note) => answer(actionId, approved, "click", note),
    cancel(actionId) {
      const ids = actionId ? [actionId] : Array.from(entries.keys());
      for (const id of ids) finish(id, { approved: false, via: "cancelled" });
    },
    subscribe(onChange) {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => NOTHING_PENDING,
  };
}

/**
 * The one store the app uses. It is a module singleton on purpose: the card is
 * mounted once per surface while the request comes from a tool that has no way
 * to reach that component, and a typed conversation and a spoken one must land
 * in the same queue.
 */
const store = createApprovalStore();

export const requestApproval = store.request;
export const answerApprovalByVoice = store.answerByVoice;
export const answerApprovalByChat = store.answerByChat;
export const answerApprovalByClick = store.answerByClick;
export const cancelPendingApprovals = store.cancel;
export const subscribeApprovals = store.subscribe;
export const getApprovalSnapshot = store.getSnapshot;
export const getApprovalServerSnapshot = store.getServerSnapshot;
