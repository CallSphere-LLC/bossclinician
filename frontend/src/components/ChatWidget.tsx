import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { api } from "@/lib/api";
import type { ChatMessage } from "@/types";
import { chatSessionId, rememberChatSessionId } from "@/lib/chatSession";
import { cn } from "@/lib/cn";
import { useVoiceAgent } from "@/hooks/useVoiceAgent";

const HISTORY_KEY = "bc_chat_history";
const TEASER_DISMISSED_KEY = "bc_chat_teaser_dismissed";

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

function teaserDismissed(): boolean {
  try {
    return localStorage.getItem(TEASER_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

const GREETING: ChatMessage = {
  role: "assistant",
  content:
    "Hi, I'm the Boss Clinician assistant. Ask me about working with Yvette, the B.O.S.S Blueprint, or where to start!",
};

const STARTER_SUGGESTIONS = [
  "What is the B.O.S.S Blueprint?",
  "How do I apply for 1:1 coaching?",
  "I'm seeing too many clients — help",
];

// Short rotating lines shown near the launcher — derived from real site content
// (services, pain points, and offers in src/content/site.ts and content/courses.ts).
// Each line must stand alone: they swap in place, so nothing is on screen to
// continue from. Keep them 3-5 words and under ~28 characters so they fit the
// bubble on one line at its narrowest (min(80vw, 17rem)).
const TEASER_LINES = [
  "Start your private practice",
  "Leaving Alma or Headway?",
  "Raise your rates",
  "Get credentialed faster",
  "Find your ideal clients",
  "Grow into a group practice",
  "Pass your next audit",
  "Book your free masterclass",
];

const TEASER_INTERVAL_MS = 3600;

/** How long the teaser stays on screen before retracting to just the launcher. */
const TEASER_VISIBLE_MS = 11000;

function ChatTeaser({ onOpen }: { onOpen: () => void }) {
  const prefersReducedMotion = useReducedMotion();
  const [dismissed, setDismissed] = useState(teaserDismissed);
  const [visible, setVisible] = useState(false);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const show = setTimeout(() => setVisible(true), 900);
    // Retract on its own. The bubble is ~272px wide and anchored above the
    // launcher, which on a 390px screen parks it permanently over whatever is
    // in the lower-right — on the home page that is the Instagram grid and the
    // Follow CTA. Retracting keeps the prompt without letting it hold a corner
    // of the viewport hostage; the launcher stays, so the chat is still one tap
    // away, and nothing is written to storage so it returns on the next visit.
    const hide = setTimeout(() => setVisible(false), 900 + TEASER_VISIBLE_MS);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, []);

  useEffect(() => {
    if (dismissed || prefersReducedMotion) return;
    const timer = setInterval(() => {
      setIndex((i) => (i + 1) % TEASER_LINES.length);
    }, TEASER_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [dismissed, prefersReducedMotion]);

  function dismiss(e: MouseEvent) {
    e.stopPropagation();
    setDismissed(true);
    try {
      localStorage.setItem(TEASER_DISMISSED_KEY, "1");
    } catch {
      // The bubble stays gone for this visit either way.
    }
  }

  return (
    <AnimatePresence>
      {visible && !dismissed && (
        <motion.div
          initial={{ opacity: 0, y: prefersReducedMotion ? 0 : 12, scale: prefersReducedMotion ? 1 : 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: prefersReducedMotion ? 0 : 8, scale: prefersReducedMotion ? 1 : 0.96 }}
          transition={
            prefersReducedMotion
              ? { duration: 0.15 }
              : { type: "spring", stiffness: 320, damping: 28 }
          }
          className="absolute bottom-full right-0 z-10 mb-3 w-[min(80vw,17rem)] sm:w-72"
        >
          <button
            type="button"
            onClick={onOpen}
            aria-label="Open the Boss Clinician chat assistant"
            className="glass glass-edge group relative block w-full rounded-2xl px-4 py-3 pr-8 text-left transition-transform duration-300 ease-luxe hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
          >
            <span className="block text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-gold/85">
              Boss Clinician Assistant
            </span>
            <span
              aria-hidden="true"
              className="relative mt-1.5 block min-h-[1.5rem] text-sm leading-snug text-white/85"
            >
              <AnimatePresence mode="wait">
                {prefersReducedMotion ? (
                  <span className="block">{TEASER_LINES[0]}</span>
                ) : (
                  <motion.span
                    key={index}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                    className="block"
                  >
                    {TEASER_LINES[index]}
                  </motion.span>
                )}
              </AnimatePresence>
            </span>
            {/* speech-bubble tail pointing at the launcher */}
            <span
              aria-hidden="true"
              className="absolute -bottom-1.5 right-6 h-3 w-3 rotate-45 border-b border-r border-white/12 bg-night-raised"
            />
          </button>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss chat suggestion"
            // 21x21 was an awkward miss-tap next to the teaser's own click
            // area; the padded box reaches a comfortable touch size while the
            // glyph stays small.
            className="absolute right-0.5 top-0.5 flex h-11 w-11 items-center justify-center rounded-full text-white/35 transition-colors hover:bg-white/10 hover:text-white"
          >
            <CloseIcon size={13} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const history = loadHistory();
    return history.length ? history : [GREETING];
  });
  const [suggestions, setSuggestions] = useState<string[]>(STARTER_SUGGESTIONS);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = useReducedMotion();

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
  }, [messages, open]);

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
    setInput("");
    setSuggestions([]);
    setLoading(true);

    try {
      const res = await api.chat(chatSessionId(), trimmed);
      rememberChatSessionId(res.sessionId);
      setMessages((prev) => [...prev, { role: "assistant", content: res.reply }]);
      setSuggestions(res.suggestions ?? []);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "I'm having trouble connecting right now. Please email bossclinician@gmail.com or try again shortly.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void sendMessage(input);
  }

  const panelTransition = prefersReducedMotion
    ? { duration: 0 }
    : { type: "spring" as const, stiffness: 320, damping: 30 };

  return (
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
            className="glass glass-edge mb-4 flex h-[28rem] w-[min(92vw,22rem)] flex-col overflow-hidden rounded-3xl sm:h-[32rem] sm:w-96"
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
                className="rounded-full p-1.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
              >
                <CloseIcon />
              </button>
            </div>

            <div
              ref={scrollRef}
              role="log"
              aria-live="polite"
              className="flex-1 space-y-3 overflow-y-auto px-4 py-4"
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
                        : "bg-white/[0.05] text-orchid ring-1 ring-inset ring-white/[0.07]",
                    )}
                  >
                    {m.content}
                  </p>
                </div>
              ))}
              {loading && (
                <div className="flex justify-start">
                  <span className="inline-flex items-center gap-1 rounded-2xl bg-white/[0.05] px-4 py-2.5 ring-1 ring-inset ring-white/[0.07]">
                    <Dot delay={0} />
                    <Dot delay={0.15} />
                    <Dot delay={0.3} />
                  </span>
                </div>
              )}
            </div>

            {suggestions.length > 0 && (
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

            <VoiceBar />

            <form onSubmit={handleSubmit} className="flex items-center gap-2 border-t border-white/[0.07] p-3">
              <label htmlFor="chat-input" className="sr-only">
                Message
              </label>
              <input
                id="chat-input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask a question…"
                className="flex-1 rounded-full border border-white/12 bg-white/[0.05] px-4 py-2.5 text-sm text-white outline-none transition-colors duration-300 placeholder:text-white/30 focus-visible:border-gold/55"
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                aria-label="Send message"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gold-foil text-night-deep transition-opacity disabled:opacity-40"
              >
                <SendIcon />
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {!open && <ChatTeaser onOpen={() => setOpen(true)} />}

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
          {!prefersReducedMotion && (
            <motion.span
              aria-hidden="true"
              className="absolute inset-0 -z-10 rounded-full bg-gold"
              animate={{ scale: [1, 1.4, 1], opacity: [0.35, 0, 0.35] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
            />
          )}
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
          </motion.button>
        </div>
      )}
    </div>
  );
}

/**
 * Voice control strip.
 *
 * Sits between the transcript and the text input so the two modes read as one
 * assistant rather than two products: whatever the visitor says by voice, and
 * wherever the agent navigates them, stays in the same panel they were typing
 * in. Voice is opt-in per session — the microphone is never opened until this
 * button is pressed.
 */
function VoiceBar() {
  const { status, error, muted, speaking, transcript, start, stop, toggleMute } = useVoiceAgent();
  const live = status === "live";
  const lastLine = transcript.at(-1);

  return (
    <div className="border-t border-white/[0.07] px-3 py-2.5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => (live || status === "connecting" ? stop() : void start())}
          aria-label={live ? "End voice conversation" : "Start voice conversation"}
          className={cn(
            "flex min-h-[2.5rem] items-center gap-2 rounded-full px-4 text-[0.7rem] font-bold uppercase tracking-[0.14em] transition-all duration-300",
            live
              ? "bg-red-500/90 text-white"
              : "bg-gold-foil text-night-deep hover:-translate-y-0.5",
            status === "connecting" && "opacity-70",
          )}
        >
          <MicIcon />
          {live ? "End" : status === "connecting" ? "Connecting…" : "Talk"}
        </button>

        {live && (
          <>
            <button
              type="button"
              onClick={toggleMute}
              aria-pressed={muted}
              aria-label={muted ? "Unmute microphone" : "Mute microphone"}
              className="flex min-h-[2.5rem] min-w-[2.5rem] items-center justify-center rounded-full border border-white/12 px-3 text-[0.65rem] font-semibold uppercase tracking-wide text-orchid transition-colors hover:border-gold/45 hover:text-gold"
            >
              {muted ? "Muted" : "Mute"}
            </button>
            <span
              aria-live="polite"
              className="flex items-center gap-1.5 text-[0.65rem] uppercase tracking-[0.14em] text-gold/80"
            >
              <span
                aria-hidden
                className={cn(
                  "h-1.5 w-1.5 rounded-full bg-gold",
                  speaking ? "animate-pulse" : "opacity-50",
                )}
              />
              {speaking ? "Speaking" : "Listening"}
            </span>
          </>
        )}
      </div>

      {live && lastLine && (
        <p className="mt-2 line-clamp-2 text-xs leading-snug text-orchid-dim">
          <span className="text-gold/70">{lastLine.role === "user" ? "You: " : "Assistant: "}</span>
          {lastLine.text}
        </p>
      )}

      {error && (
        <p role="alert" className="mt-2 text-xs leading-snug text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}

function MicIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M5 11a7 7 0 0 0 14 0M12 18v3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
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
