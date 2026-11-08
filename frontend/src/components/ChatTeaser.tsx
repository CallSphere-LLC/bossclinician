import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

/**
 * The speech bubble beside the closed chat launcher.
 *
 * A gold circle in the corner says "chat", and most visitors assume that means a
 * help-desk box that answers questions. This one also reads the page someone is
 * on, takes them to other pages and gives a tour, so the bubble types those
 * abilities out one at a time, in the visitor's own words rather than ours.
 *
 * It types each line twice round, then rests on the first one. Closing it keeps
 * it closed for the rest of the visit, and opening the chat retires it the
 * same way. With reduced motion the first line simply sits there.
 */

const LINES = [
  "Hi! Ask me anything about Boss Clinician.",
  "I can read this page and explain it simply.",
  "Looking for something? I'll take you right there.",
  "New here? I can show you around, page by page.",
  "Rather talk? Switch to voice and just ask.",
];

const DISMISS_KEY = "bc_chat_teaser_dismissed";
const APPEAR_AFTER_MS = 2500;
const TYPE_MS = 34;
const ERASE_MS = 14;
const HOLD_MS = 2300;
const CYCLES = 2;

function wasDismissed(): boolean {
  try { return sessionStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; }
}

export function rememberChatTeaserDismissed(): void {
  try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch { /* Hidden for this page view anyway. */ }
}

export function ChatTeaser({ onOpen }: { onOpen: () => void }) {
  const reduceMotion = useReducedMotion();
  const [visible, setVisible] = useState(false);
  const [lineIndex, setLineIndex] = useState(0);
  const [shown, setShown] = useState(reduceMotion ? LINES[0] : "");
  const [settled, setSettled] = useState(Boolean(reduceMotion));

  useEffect(() => {
    if (wasDismissed()) return;
    const timer = window.setTimeout(() => setVisible(true), APPEAR_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, []);

  // One timer drives the whole typewriter: type the line, hold it, erase it,
  // move to the next. After the last cycle it types the first line and stops.
  useEffect(() => {
    if (!visible || settled || reduceMotion) return;
    const line = LINES[lineIndex % LINES.length];
    let index = 0;
    let erasing = false;
    let timer = 0;
    const lastLap = lineIndex >= LINES.length * CYCLES;

    const tick = () => {
      if (!erasing) {
        index += 1;
        setShown(line.slice(0, index));
        if (index < line.length) { timer = window.setTimeout(tick, TYPE_MS); return; }
        if (lastLap) { setSettled(true); return; }
        erasing = true;
        timer = window.setTimeout(tick, HOLD_MS);
        return;
      }
      index -= 1;
      setShown(line.slice(0, index));
      if (index > 0) { timer = window.setTimeout(tick, ERASE_MS); return; }
      timer = window.setTimeout(() => setLineIndex((n) => n + 1), 260);
    };
    timer = window.setTimeout(tick, 200);
    return () => window.clearTimeout(timer);
  }, [visible, lineIndex, settled, reduceMotion]);

  function dismiss() {
    rememberChatTeaserDismissed();
    setVisible(false);
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="chat-teaser"
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 12, scale: 0.94, filter: "blur(6px)" }}
          animate={{ opacity: 1, x: 0, scale: 1, filter: "blur(0px)" }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 8, scale: 0.96, filter: "blur(4px)" }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          style={{ transformOrigin: "100% 80%" }}
          className="chat-teaser absolute bottom-1 right-[4.6rem] w-[min(16.5rem,calc(100vw-7rem))]"
        >
          <div className="glass-edge relative rounded-2xl rounded-br-md border border-hairline bg-surface-raised/[0.97] backdrop-blur-md shadow-[0_18px_40px_-18px_rgba(0,0,0,0.55)]">
            <button
              type="button"
              onClick={onOpen}
              aria-label="Open chat assistant. Ask a question, have this page explained, or be taken to any page."
              className="block w-full rounded-2xl rounded-br-md py-3 pl-4 pr-9 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
            >
              <span aria-hidden="true" className="flex items-center gap-2 text-[0.7rem] font-semibold text-ink-soft">
                <span className="relative flex size-2">
                  <span className="absolute inset-0 rounded-full bg-emerald-400 motion-safe:animate-ping motion-safe:opacity-60" />
                  <span className="relative size-2 rounded-full bg-emerald-400" />
                </span>
                Boss Clinician AI
              </span>
              <span aria-hidden="true" className="mt-1.5 block min-h-[2.6rem] text-[0.9rem] leading-snug text-ink">
                {shown}
                {!settled && (
                  <span className="chat-teaser-caret ml-px inline-block h-[1.05em] w-[2px] translate-y-[0.18em] rounded-full bg-gold motion-safe:animate-pulse" />
                )}
              </span>
            </button>
            <button
              type="button"
              onClick={dismiss}
              aria-label="Hide chat tip"
              className="absolute right-1 top-1 flex size-8 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-ink/10 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
