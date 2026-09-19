/**
 * VoiceSpotlight — the concierge's cursor.
 *
 * When the agent talks about something on the page, a cursor glides onto it
 * and a small pill says what it is, exactly the way a person sharing their
 * screen hovers the mouse over what they are describing. It does not dim the
 * page, it does not cut a hole in it, and it does not take the pointer away:
 * everything here is `pointer-events: none`, so the visitor keeps full control
 * of the page while being shown around it.
 *
 * Where the target is and when to stop pointing belong to the tools slice,
 * which publishes a rect and a label. So does the rule for where the cursor
 * rests on that rect: `pointerAnchor` is imported rather than reimplemented,
 * because a placement rule kept in two places is a placement rule that will
 * disagree with itself the first time either copy is touched. This component
 * subscribes and renders, and nothing else.
 *
 * It is mounted by whichever concierge is on the page — spoken or typed — so
 * it never touches a call, a microphone or an audio level.
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  getSpotlightServerSnapshot,
  getSpotlightSnapshot,
  pointerAnchor,
  subscribeSpotlight,
  type Viewport,
} from "@/voice/tools";
import { useOnlyOne } from "./only-one";

/**
 * The pill is capped in CSS rather than in script so the cap is the browser's
 * job on every resize: sixteen rems where there is room, and the width of the
 * screen less its gutters where there is not. A phone must never be made wider
 * by something the concierge is pointing at.
 */
const CAPTION_MAX_WIDTH = "min(16rem, calc(100vw - 2rem))";

const GLIDE = { type: "spring", stiffness: 220, damping: 26 } as const;

export function VoiceSpotlight({ speaking }: { speaking?: boolean } = {}) {
  const mine = useOnlyOne("voice-spotlight");
  const target = useSyncExternalStore(
    subscribeSpotlight,
    getSpotlightSnapshot,
    getSpotlightServerSnapshot,
  );
  const [viewport, setViewport] = useState<Viewport | null>(null);

  // The viewport is measured in an effect, never during render: this component
  // is part of a page that is rendered on the server before it is ever shown.
  useEffect(() => {
    const measure = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
    };
  }, []);

  const anchor = mine && target && viewport ? pointerAnchor(target.rect, viewport) : null;
  // The label says what the thing is; the caption is the sentence being spoken
  // about it. While the agent is quiet — or the conversation is typed and there
  // is no such thing as quiet — the label is the honest choice.
  const pill = target && speaking !== false && target.caption ? target.caption : target?.label;

  return (
    <AnimatePresence>
      {anchor && (
        <motion.div
          key="voice-pointer"
          aria-hidden="true"
          className="pointer-events-none fixed left-0 top-0 z-[80]"
          initial={{ opacity: 0, scale: 0.6, x: anchor.x, y: anchor.y }}
          animate={{ opacity: 1, scale: 1, x: anchor.x, y: anchor.y }}
          exit={{ opacity: 0, scale: 0.6 }}
          transition={{ opacity: { duration: 0.2 }, default: GLIDE }}
        >
          {/* A soft ring where the tip rests, so the eye finds the cursor at all. */}
          <span className="absolute -left-2.5 -top-2.5 h-5 w-5 rounded-full bg-gold/45 motion-safe:animate-ping" />
          <svg width="28" height="28" viewBox="0 0 24 24" className="relative drop-shadow-[0_2px_8px_rgba(0,0,0,0.55)]">
            <path
              d="M3 2.5 20 11l-7.4 1.9L9.2 20z"
              fill="#C9A46A"
              stroke="#0A0713"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
          </svg>

          {pill && (
            <motion.div
              className={`absolute top-6 w-max rounded-xl border border-hairline bg-surface-raised/95 px-3 py-1.5 text-xs font-semibold text-ink shadow-[0_10px_30px_-10px_rgba(0,0,0,0.65)] backdrop-blur ${
                anchor.captionSide === "right" ? "left-6" : "right-2"
              }`}
              style={{ maxWidth: CAPTION_MAX_WIDTH }}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
            >
              {pill}
            </motion.div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
