import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useLocation } from "react-router";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ChatMessage } from "@/types";
import type { VoiceSurfacePolicy } from "@/voice/contract";
import { cn } from "@/lib/cn";
import { footer } from "@/content/site";
import { createVoiceApiClient } from "@/voice/kernel";
import { policyForPath } from "@/voice/surfaces";
import { readApprovalAnswer, useConciergeChat, useFirstVisitOffer } from "@/voice/text";

/**
 * The voice controls and approval card belong to the voice slice and are pulled in
 * only once somebody opens the panel.
 *
 * Two reasons, both hard requirements rather than tidiness: this widget is
 * rendered into every server-rendered marketing page, and those modules touch
 * the DOM; and a visitor who never opens the chat should not pay for the
 * concierge's bundle on first paint.
 */
const VoiceConcierge = lazy(() =>
  import("@/voice/ui").then((module) => ({ default: module.VoiceConcierge })),
);
const ApprovalHost = lazy(() =>
  import("@/voice/ui").then((module) => ({ default: module.ApprovalHost })),
);

const HISTORY_KEY = "bc_chat_history";

/**
 * Both readers are guarded rather than left to throw.
 *
 * The widget is part of every server-rendered marketing page, where there is no
 * storage at all, and in a browser with storage blocked (private mode, an
 * embedded context) a read is a security error. Either way a visitor gets a
 * fresh conversation, which is the right answer — the alternative is a page
 * that fails to render over a saved chat log.
 */
function loadHistory(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? (JSON.parse(raw) as ChatMessage[]) : [];
  } catch {
    return [];
  }
}

const PUBLIC_GREETING =
  "Hi, welcome! I'm Boss Clinician AI.";

/**
 * What the panel opens with.
 *
 * The marketing site keeps the line it has always had — it is sales copy that
 * has been through more hands than this widget — while the portal and the admin
 * use their own policy's greeting, so the assistant introduces itself the same
 * way whether the person typed at it or spoke to it.
 */
function panelGreeting(policy: VoiceSurfacePolicy): string {
  return policy.surface === "public" ? PUBLIC_GREETING : policy.greeting;
}

const FAILURE_MESSAGE =
  `I'm having trouble connecting right now. Please email ${footer.contactEmail} or try again shortly.`;

const TOUR_CHOICES = ["Yes, show me around", "No thanks, I'll ask"];

const STARTER_SUGGESTIONS = [
  "What is the B.O.S.S Blueprint?",
  "Tell me about the B.O.S.S. Boardroom",
  "I'm seeing too many clients — help",
];

export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const location = useLocation();

  /**
   * Which concierge this is depends on where the visitor is standing.
   *
   * The same widget is the sales assistant on the marketing site, the member's
   * own assistant inside the portal and the owner's in the admin; what changes
   * between them is the policy — where it may travel, what it may do and whose
   * data it may read — and nothing else. `policyForPath` hands back one of
   * three shared objects, so this is a comparison, not an allocation, on every
   * route change.
   */
  const policy = policyForPath(location.pathname);

  const [initialMessages] = useState<ChatMessage[]>(() => {
    const history = loadHistory();
    return history.length ? history : [{ role: "assistant", content: panelGreeting(policy) }];
  });

  /**
   * The typed transport. It runs the very same tools the spoken concierge runs
   * — navigating, pointing the cursor, reading the page out, answering from the
   * member's own records and asking the owner before it changes anything — so
   * everything below is a panel around one agent rather than a second, lesser
   * chatbot.
   */
  const concierge = useConciergeChat({
    policy,
    initialMessages,
    failureMessage: FAILURE_MESSAGE,
  });
  const { messages, sending, streamingReply, pendingApproval } = concierge;

  const [suggestions, setSuggestions] = useState<string[]>(STARTER_SUGGESTIONS);
  const [input, setInput] = useState("");
  const [conciergeMounted, setConciergeMounted] = useState(false);
  const [voiceContainer, setVoiceContainer] = useState<HTMLDivElement | null>(null);
  const [voiceActive, setVoiceActive] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = useReducedMotion();

  // The client is two functions over the app's own fetch and holds no state, so
  // building one per call costs nothing and keeps it out of the render.
  const voiceApi = useCallback(() => createVoiceApiClient(policy.surface), [policy.surface]);
  const offer = useFirstVisitOffer({
    policy,
    call: voiceApi,
    // Decided when the panel opens rather than when the page does: a visitor
    // who never opens the chat should not cost a request on every page.
    active: open,
  });
  // Keyed by surface rather than a plain flag: the same widget mounted inside
  // the portal or the admin is a different concierge with its own walkthrough,
  // and its offer has not been made just because the visitor's was.
  const offeredRef = useRef<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(messages));
    } catch {
      // A conversation that works matters more than one that survives a reload.
    }
  }, [messages]);

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingReply, open]);

  /**
   * Once opened, the concierge's own overlays stay mounted for the rest of the
   * visit. The cursor is mid-sentence about something on the page when someone
   * collapses the panel to look at it properly, and a pointer that vanished at
   * that exact moment would be the most annoying possible time to lose it.
   */
  useEffect(() => {
    if (open) setConciergeMounted(true);
  }, [open]);

  /**
   * The unprompted opening line: the walkthrough offer for a newcomer, or the
   * standing invitation to finish one that was left half-done. Both come from
   * the same decision the spoken concierge makes, so nobody is offered a tour
   * twice because they switched from talking to typing.
   */
  useEffect(() => {
    if (!offer.openingLine || offeredRef.current === policy.surface) return;
    offeredRef.current = policy.surface;
    concierge.greet(offer.openingLine);
    if (offer.offering) setSuggestions(TOUR_CHOICES);
  }, [concierge, offer.openingLine, offer.offering, policy.surface]);

  /**
   * A waiting approval is the one time typing is allowed mid-turn: the turn is
   * held open precisely because it is waiting for the owner's yes or no.
   */
  const busy = sending && !pendingApproval;

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    // The guard comes before the input is cleared, so a second press while a
    // turn is still running cannot swallow what somebody had typed.
    if (!trimmed || busy) return;
    setInput("");
    setSuggestions([]);

    // Both of these have to be read before the turn runs: answering the offer
    // is what clears it.
    const answeringOffer = offer.offering;
    const refused = answeringOffer && readApprovalAnswer(trimmed)?.approved === false;

    const turn = await concierge.send(trimmed);
    if (!answeringOffer || !turn) return;

    /**
     * Only a plain no is recorded as a no.
     *
     * A declined walkthrough is a finished one as far as the tour is concerned,
     * and `start_guided_tour` refuses a finished tour outright — so writing
     * that flag on a sentence that merely failed to start the tour ("yes —
     * where should we begin?") would lock someone out of the tour they just
     * asked for. Anything short of a refusal simply closes the offer: it has
     * been made, that much is remembered, and nothing is written.
     */
    if (refused) offer.decline();
    else offer.close();
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void sendMessage(input);
  }

  const panelTransition = prefersReducedMotion
    ? { duration: 0 }
    : { type: "spring" as const, stiffness: 320, damping: 30 };

  return (
    <>
      {/* Keep the call mounted while the chat is collapsed or changes pages.
          Its controls are portaled into the open panel; its page overlays stay outside. */}
      {conciergeMounted && (
        <Suspense fallback={null}>
          <VoiceConcierge policy={policy} container={voiceContainer} onActiveChange={setVoiceActive} />
        </Suspense>
      )}

      {/*
       * The owner's confirmation, whichever way she answers it: by clicking the
       * card, by typing into it, by typing into the panel below, or out loud on
       * a call. The host shows nothing until something is actually waiting, and
       * words it could not deliver — she was still typing when the question
       * timed out — are handed back to the conversation rather than lost.
       */}
      {conciergeMounted && !voiceActive && policy.surface === "admin" && (
        <Suspense fallback={null}>
          <ApprovalHost
            onUndelivered={(text) => {
              // Her words reach here when the question had already settled,
              // which usually means the turn is still finishing. Rather than
              // drop them, they go into the box where she can send them.
              if (busy) setInput(text);
              else void sendMessage(text);
            }}
          />
        </Suspense>
      )}

      <div className="fixed bottom-5 right-5 z-[60] sm:bottom-8 sm:right-8">
        <AnimatePresence>
          {open && (
            <motion.div
              role="dialog"
              aria-modal="false"
              aria-label="Boss Clinician chat assistant"
              initial={{ opacity: 0, y: 20, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.96 }}
              transition={panelTransition}
              className="glass glass-edge mb-4 flex h-[28rem] max-h-[calc(100dvh-6rem)] w-[min(92vw,22rem)] flex-col overflow-hidden rounded-3xl sm:h-[32rem] sm:w-96"
            >
              <div className="relative flex items-center justify-between border-b border-white/[0.07] bg-night-raised/70 px-5 py-4 text-white">
                <div aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-rule-gold opacity-50" />
                <div>
                  <p className="font-display text-[0.95rem] font-semibold">
                    Boss <em className="text-foil italic">Clinician</em> Assistant
                  </p>
                  <p className="mt-0.5 text-[0.68rem] uppercase tracking-[0.16em] text-gold/60">
                    Usually replies instantly
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close chat"
                  className="rounded-full p-1.5 text-white/60 transition-colors hover:bg-ink/10 hover:text-white"
                >
                  <CloseIcon />
                </button>
              </div>

              <div
                ref={scrollRef}
                role="log"
                aria-live="polite"
                className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4"
              >
                {messages.map((m, i) => (
                  <div
                    key={i}
                    className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
                  >
                    <p
                      className={cn(
                        "max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                        m.role === "user"
                          ? "bg-plum-bright/25 text-white ring-1 ring-inset ring-plum-bright/30"
                          : "bg-ink/[0.05] text-orchid ring-1 ring-inset ring-ink/[0.07]",
                      )}
                    >
                      {m.content}
                    </p>
                  </div>
                ))}
                {streamingReply && (
                  <div className="flex justify-start" data-testid="chat-streaming-reply">
                    <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-ink/[0.05] px-4 py-2.5 text-sm leading-relaxed text-orchid ring-1 ring-inset ring-ink/[0.07]">
                      {streamingReply}
                      <span aria-hidden="true" className="ml-0.5 inline-block h-3.5 w-0.5 bg-current motion-safe:animate-pulse" />
                    </p>
                  </div>
                )}
                {sending && !streamingReply && (
                  <div className="flex justify-start">
                    <span className="inline-flex items-center gap-1 rounded-2xl bg-ink/[0.05] px-4 py-2.5 ring-1 ring-inset ring-ink/[0.07]">
                      <Dot delay={0} />
                      <Dot delay={0.15} />
                      <Dot delay={0.3} />
                    </span>
                  </div>
                )}
              </div>

              {suggestions.length > 0 && !voiceActive && (
                <div className="flex flex-wrap gap-2 border-t border-white/[0.07] px-4 py-3">
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => void sendMessage(s)}
                      className="rounded-full border border-white/12 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-orchid transition-colors duration-300 hover:border-gold/45 hover:text-gold"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}

              <div ref={setVoiceContainer} className="max-h-[55%] shrink-0 overflow-y-auto border-t border-white/[0.07] px-3 py-2" />

              <form onSubmit={handleSubmit} className="flex shrink-0 items-center gap-2 border-t border-white/[0.07] p-3">
                <label htmlFor="chat-input" className="sr-only">
                  {pendingApproval ? "Answer yes or no to the change waiting above" : "Message"}
                </label>
                <input
                  id="chat-input"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={pendingApproval ? "Type yes or no…" : "Ask a question…"}
                  className="min-w-0 flex-1 rounded-full border border-white/12 bg-white/[0.05] px-4 py-2.5 text-sm text-white outline-none transition-colors duration-300 placeholder:text-white/30 focus-visible:border-gold/55"
                />
                <button
                  type="submit"
                  disabled={busy || !input.trim()}
                  aria-label="Send message"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gold-foil text-night-deep transition-opacity disabled:opacity-40"
                >
                  <SendIcon />
                </button>
              </form>
            </motion.div>
          )}
        </AnimatePresence>

        {/*
         * The launcher is hidden while the panel is open.
         *
         * It used to swap its icon to an X, which put two identical "close this"
         * controls on screen at once — the panel header's X and the launcher
         * directly beneath it. The header X is the one that reads as belonging to
         * the panel, so it is now the only way to close, and the corner is freed
         * for the conversation instead of a redundant button.
         */}
        {!open && (
          <div className="relative">
            <motion.span
              aria-hidden="true"
              className="absolute inset-0 -z-10 rounded-full bg-gold motion-reduce:hidden"
              animate={prefersReducedMotion ? undefined : { scale: [1, 1.4, 1], opacity: [0.35, 0, 0.35] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.button
              type="button"
              onClick={() => setOpen(true)}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              aria-expanded={false}
              aria-label="Open chat assistant"
              className={cn(
                "flex h-14 w-14 items-center justify-center rounded-full bg-gold-foil text-night-deep",
                "shadow-[0_14px_36px_-12px_rgba(201,164,106,0.75)] ring-[6px] ring-gold/15",
                "transition-shadow duration-300",
              )}
            >
              <ChatIcon />
              {voiceActive && <span aria-label="Voice call active" className="absolute right-0 top-0 h-3 w-3 rounded-full bg-emerald-400 ring-2 ring-night-deep" />}
            </motion.button>
          </div>
        )}
      </div>
    </>
  );
}

function Dot({ delay }: { delay: number }) {
  return (
    <motion.span
      className="h-1.5 w-1.5 rounded-full bg-gold/70"
      animate={{ opacity: [0.3, 1, 0.3] }}
      transition={{ duration: 1, repeat: Infinity, delay }}
    />
  );
}

function ChatIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8A2.5 2.5 0 0 1 17.5 16H10l-4.5 4.5V16h-.01A2.5 2.5 0 0 1 4 13.5v-8Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CloseIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 6l12 12M18 6 6 18"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 12 20 4 13 20l-2-7-7-1Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}
