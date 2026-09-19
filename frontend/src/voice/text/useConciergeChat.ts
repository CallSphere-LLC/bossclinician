/**
 * useConciergeChat.ts — the typed half of the concierge.
 *
 * Addendum 2 of the build contract is the reason this file exists: someone who
 * types must get everything someone who talks gets. So this hook is the text
 * transport's answer to the voice kernel — same agent, same tools, same tour,
 * different wire. It builds the surface's tool list with `buildVoiceTools`,
 * posts the conversation to `/api/voice/chat`, runs whatever tool calls come
 * back HERE in the browser (that is where the router, the page and the cursor
 * are), and keeps going until the agent has something to say.
 *
 * What is deliberately NOT in here: any branch on "is this voice or text?"
 * beyond `ctx.mode`, which tools may use to phrase themselves and nothing else.
 * A capability that exists by voice and not by typing would be a bug, and the
 * single shared registry is what stops one appearing.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useNavigate } from "react-router";
import { createVoiceApiClient } from "@/voice/kernel";
import { buildVoiceTools } from "@/voice/tools";
import {
  answerApprovalByChat,
  getApprovalServerSnapshot,
  getApprovalSnapshot,
  requestApproval,
  subscribeApprovals,
  type PendingApproval,
} from "@/voice/ui/approval-store";
// The leaf, never the ui barrel: one sentence must not drag the spoken widget
// into a page the server renders. `demotion.ts` imports nothing but a type.
import { demotedNotice } from "@/voice/ui/demotion";
import type {
  ConciergeChatMessage,
  ConciergeChatRequest,
  ConciergeTool,
  ToolFn,
  VoiceApiClient,
  VoiceContext,
  VoiceSurface,
  VoiceSurfacePolicy,
  VoiceTranscriptAppend,
} from "@/voice/contract";
import type { ChatMessage } from "@/types";
import {
  ConciergeLoopError,
  readApprovalAnswer,
  runConciergeTurn,
  type ConciergeTurn,
} from "./conciergeLoop";

/** The text model's endpoint, as the voice broker's sibling. */
import { streamConciergeChat } from "./chat-stream";

/** Where a conversation is filed so the owner can read it back. */
const TRANSCRIPT_PATH = "/voice/transcript";

/**
 * How much of the conversation travels with each turn. Long enough that the
 * agent remembers the thread of a real exchange, short enough that a widget
 * left open all afternoon does not post a novel on every line.
 */
const HISTORY_TURNS = 20;

/**
 * The realtime SDK wraps a tool descriptor before handing it to the model; over
 * text there is nothing to wrap, because `ConciergeTool` already IS the
 * descriptor the chat route wants. That the injected `tool()` collapses to the
 * identity function here is the entire point of the contract's shape: one
 * registry, two transports, no second implementation of anything.
 */
const identityTool: ToolFn = (options) => options;

/**
 * Path + search + hash, read at the instant a tool or a round asks for it.
 *
 * Exported because the first-visit offer builds a context of its own and must
 * answer "where am I" the same way this transport does.
 */
export function currentLocation(): string {
  if (typeof window === "undefined") return "/";
  const { pathname, search, hash } = window.location;
  return `${pathname}${search}${hash}`;
}

export type ConciergeChatHandle = {
  /** The conversation as the panel draws it. Tool traffic never appears here. */
  messages: ChatMessage[];
  /** True while a turn is in flight, including the tool calls inside it. */
  sending: boolean;
  /** Visible provider tokens from the current round; finalized into messages once. */
  streamingReply: string;
  /** The last failure, for a widget that wants to say more than the transcript does. */
  error: string | null;
  /** The row the owner's admin page will show this conversation under. */
  sessionId: string | null;
  /** The change waiting on the owner's yes or no, if there is one. */
  pendingApproval: PendingApproval | null;
  /** Type a line. Resolves with the finished turn, or null if there was none. */
  send: (text: string) => Promise<ConciergeTurn | null>;
  /** Put a line in the panel the agent did not have to be asked for. */
  say: (text: string) => void;
  /** Replace the opening greeting before any human message; never interrupt a conversation. */
  greet: (text: string) => void;
};

export function useConciergeChat(input: {
  policy: VoiceSurfacePolicy;
  /** Seeds the panel — a greeting, or a conversation restored from storage. */
  initialMessages: ChatMessage[];
  /** What the agent says when the conversation cannot reach the server. */
  failureMessage: string;
}): ConciergeChatHandle {
  const { policy, failureMessage } = input;
  const navigate = useNavigate();
  const [messages, setMessages] = useState<ChatMessage[]>(input.initialMessages);
  const [sending, setSending] = useState(false);
  const [streamingReply, setStreamingReply] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  // navigate()'s identity changes on every route change, and a tool list
  // rebuilt mid-conversation would lose the guided tour's place. A ref keeps
  // the tools pointing at the current router without being rebuilt by it.
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  const clientRef = useRef<VoiceApiClient | null>(null);
  const toolsRef = useRef<{ policy: VoiceSurfacePolicy; tools: ConciergeTool[] } | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  // Which lesser surface the person has already been told about, so a lapsed
  // session is explained once rather than at the top of every answer.
  const demotedRef = useRef<VoiceSurface | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const sendingRef = useRef(false);
  const userTurnRef = useRef<{ id: number; text: string } | null>(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  /**
   * Everything the browser side needs is built on the first send, never during
   * a render. This widget is part of the server-rendered marketing shell, and a
   * fetch client or a tool list constructed at module or render time would run
   * on the server where neither has anything to talk to.
   */
  const apiClient = useCallback((): VoiceApiClient => {
    clientRef.current ??= createVoiceApiClient(policy.surface);
    return clientRef.current;
  }, [policy.surface]);

  const conciergeTools = useCallback((): ConciergeTool[] => {
    if (toolsRef.current?.policy === policy) return toolsRef.current.tools;
    const context: VoiceContext = {
      navigate: (path) => navigateRef.current(path),
      getLocation: currentLocation,
      surface: policy.surface,
      mode: "text",
      getSessionId: () => sessionIdRef.current,
      getUserTurn: () => userTurnRef.current,
      call: apiClient(),
      // Only the owner's surface can be asked to approve anything, so only it
      // is handed the means to ask. A member's concierge has no approval path
      // because it has nothing to approve.
      ...(policy.surface === "admin" ? { requestApproval } : {}),
    };
    const tools = buildVoiceTools(policy, identityTool, context) as ConciergeTool[];
    toolsRef.current = { policy, tools };
    return tools;
  }, [apiClient, policy]);

  const pending = useSyncExternalStore(
    subscribeApprovals,
    getApprovalSnapshot,
    getApprovalServerSnapshot,
  );
  const pendingApproval = pending[0] ?? null;
  const pendingRef = useRef(pendingApproval);
  pendingRef.current = pendingApproval;

  /**
   * A conversation belongs to the surface it was opened on.
   *
   * Walking from the marketing site into the portal changes who the server
   * thinks is speaking, so the old row is closed rather than continued — a
   * visitor's transcript must never gain a member's answers halfway down.
   */
  useEffect(() => {
    clientRef.current = null;
    sessionIdRef.current = null;
    startedAtRef.current = null;
    demotedRef.current = null;
    setSessionId(null);
  }, [policy.surface]);

  const append = useCallback((...lines: ChatMessage[]) => {
    if (lines.length > 0) setMessages((prev) => [...prev, ...lines]);
  }, []);

  const greet = useCallback((text: string) => {
    setMessages((previous) => previous.some((line) => line.role === "user")
      ? previous
      : [{ role: "assistant", content: text }]);
  }, []);

  const say = useCallback(
    (text: string) => append({ role: "assistant", content: text }),
    [append],
  );

  /**
   * File the turn where the owner reads her conversations.
   *
   * The typed transcript goes to exactly the same place as the spoken one, on
   * the row the chat route opened — which is where this conversation was marked
   * as a typed one — so the owner reads one inbox of conversations rather than
   * two lists side by side.
   */
  const persist = useCallback(
    (id: string | null, lines: { role: "user" | "agent"; text: string }[]) => {
      if (!id || lines.length === 0) return;
      const startedAt = (startedAtRef.current ??= Date.now());
      // One millisecond apart rather than all on the same stamp: the admin page
      // reads a conversation back in time order, and lines that tie sort
      // arbitrarily — which is how an answer ends up above its question.
      const atMs = Date.now() - startedAt;
      const body: VoiceTranscriptAppend = {
        sessionId: id,
        lines: lines.map((line, index) => ({
          role: line.role,
          text: line.text,
          atMs: atMs + index,
        })),
      };
      void apiClient()
        .post(TRANSCRIPT_PATH, body)
        .catch(() => {
          // A conversation the visitor is having matters more than the copy of
          // it we keep; a failed append is never shown to them.
        });
    },
    [apiClient],
  );

  const send = useCallback(
    async (text: string): Promise<ConciergeTurn | null> => {
      const trimmed = text.trim();
      if (!trimmed) return null;

      /**
       * A change waiting for a yes is answered before anything else, and it is
       * answered even though a turn is still in flight — the turn is in flight
       * precisely BECAUSE it is waiting for this line. The build contract lists
       * the chat as one of the three ways the owner may approve something, and
       * a send guard that swallowed her "yes" would quietly leave the click on
       * the card as the only one that worked.
       */
      const waiting = pendingRef.current;
      if (waiting) {
        append({ role: "user", content: trimmed });
        const answer = readApprovalAnswer(trimmed);
        if (!answer) {
          say("I need a yes or a no on the change above before I can carry on.");
          return null;
        }
        const result = answerApprovalByChat(
          waiting.request.actionId,
          answer.approved,
          answer.note,
        );
        if (!result.accepted) {
          say(
            result.reason === "needs-click"
              ? "Please click Approve on the card to confirm this change."
              : result.reason === "already-answered"
              ? "That one has already been answered."
              : "I could not match that to the change on screen — let me know what you would like to do.",
          );
        }
        return null;
      }

      if (sendingRef.current) return null;
      userTurnRef.current = { id: (userTurnRef.current?.id ?? 0) + 1, text: trimmed };
      sendingRef.current = true;
      setSending(true);
      setError(null);
      startedAtRef.current ??= Date.now();

      const history: ConciergeChatMessage[] = messagesRef.current
        .slice(-HISTORY_TURNS)
        .map((line) => ({ role: line.role, content: line.content }));
      history.push({ role: "user", content: trimmed });
      append({ role: "user", content: trimmed });

      try {
        const turn = await runConciergeTurn({
          surface: policy.surface,
          sessionId: sessionIdRef.current,
          history,
          tools: conciergeTools(),
          getLocation: currentLocation,
          send: async (request: ConciergeChatRequest) => {
            setStreamingReply("");
            const response = await streamConciergeChat(request,
              (delta) => setStreamingReply((text) => text + delta),
              (session) => {
                sessionIdRef.current = session.sessionId;
                setSessionId(session.sessionId);
              });
            return response;
          },
          onInterim: (line) => {
            setStreamingReply("");
            append({ role: "assistant", content: line });
          },
          /**
           * The server re-decides who is speaking on every turn, and it
           * degrades quietly — so a member whose sign-in lapsed while the panel
           * sat open would otherwise just watch the assistant become unable to
           * open their own library, with nothing said about why. This is said
           * once, before the answer it explains.
           */
          onSurface: (granted) => {
            if (demotedRef.current === granted) return;
            // The same sentence the spoken concierge says, from the same
            // module: one situation deserves one explanation, and it already
            // returns null when nothing was taken away.
            const notice = demotedNotice(policy.surface, granted);
            if (!notice) return;
            demotedRef.current = granted;
            say(notice);
          },
        });
        sessionIdRef.current = turn.sessionId;
        setSessionId(turn.sessionId);
        append({ role: "assistant", content: turn.reply });
        persist(turn.sessionId, [
          { role: "user", text: trimmed },
          ...turn.interim.map((line) => ({ role: "agent" as const, text: line })),
          { role: "agent", text: turn.reply },
        ]);
        return turn;
      } catch (failure) {
        const reason =
          failure instanceof ConciergeLoopError
            ? failure.message
            : failure instanceof Error
              ? failure.message
              : String(failure);
        setError(reason);
        /**
         * A loop that gave up says so in its own words — "it kept working
         * without answering" is a true thing a person can act on, and hiding it
         * behind "trouble connecting" would send someone to email support over
         * a turn that would have worked if they asked again. Anything else is
         * the connection, and for that the app's own apology, with the address
         * of a real person in it, is the better sentence.
         */
        say(failure instanceof ConciergeLoopError ? failure.message : failureMessage);
        return null;
      } finally {
        sendingRef.current = false;
        setSending(false);
        setStreamingReply("");
      }
    },
    [append, apiClient, conciergeTools, failureMessage, persist, policy.surface, say],
  );

  return { messages, sending, streamingReply, error, sessionId, pendingApproval, send, say, greet };
}
