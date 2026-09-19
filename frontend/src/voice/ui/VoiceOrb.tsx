/**
 * VoiceOrb — the concierge made visible.
 *
 * It is the same idea as the CallSphere orb and deliberately none of its
 * colour: a layered gradient disc whose swell and glow are driven, every
 * animation frame, by the REAL audio going in and out of the call. Nothing
 * here is a decorative loop — when the orb grows, that is the agent's voice,
 * and when it ripples faintly, that is the microphone hearing the room.
 *
 * The level is read with `readLevels()` inside the frame loop rather than held
 * in React state, because sixty renders a second to move one transform is how
 * a page starts to stutter. Everything the loop writes is a transform, an
 * opacity or a shadow, so it stays on the compositor.
 *
 * Colour follows the surface it is standing on. The console has one accent and
 * one only, so the admin orb is gold from edge to core; the public and member
 * pages keep the plum halo the rest of the site uses.
 */

import { useEffect, useRef, useState } from "react";
import type { VoiceSurface } from "@/voice/contract";

type Levels = { agent: number; mic: number };

const PALETTE: Record<"gold" | "luxe", { core: string; glowInner: string; glowOuter: string }> = {
  // Admin: the console's single accent, lit from within.
  gold: {
    core: "radial-gradient(circle at 32% 28%, #FBF0D8 0%, #E8CE9A 24%, #C9A46A 58%, #8C6B34 100%)",
    glowInner: "201,164,106",
    glowOuter: "140,107,52",
  },
  // Public and member: gold heart, plum halo — the marketing palette.
  luxe: {
    core: "radial-gradient(circle at 32% 28%, #FBF0D8 0%, #E8CE9A 20%, #C9A46A 46%, #7B5EA7 82%, #4B2E83 100%)",
    glowInner: "201,164,106",
    glowOuter: "123,94,167",
  },
};

export function VoiceOrb({
  speaking,
  readLevels,
  surface = "public",
  size = 40,
}: {
  /** True while the agent is talking. Drives the ring and the fallback pulse. */
  speaking: boolean;
  /** The kernel's analyser tap. Absent before a call opens, or in a typed chat. */
  readLevels?: (() => Levels | null) | null;
  surface?: VoiceSurface;
  size?: number;
}) {
  const coreRef = useRef<HTMLSpanElement | null>(null);
  const glowRef = useRef<HTMLSpanElement | null>(null);

  // The loop is started once and must see today's props, not the ones it was
  // created with, so both live behind refs it reads each frame.
  const speakingRef = useRef(speaking);
  speakingRef.current = speaking;
  const readLevelsRef = useRef(readLevels);
  readLevelsRef.current = readLevels;

  const tone = surface === "admin" ? PALETTE.gold : PALETTE.luxe;

  // A page-wide CSS rule already flattens transitions and keyframes for someone
  // who asked for less movement, but it cannot reach a style written by hand in
  // an animation frame — so the orb asks for itself, and keeps asking, because
  // the preference can change while the page is open.
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (!reduced) return;
    // Two steady states rather than a pulse: still legible as "she is talking",
    // with nothing moving.
    if (coreRef.current) coreRef.current.style.transform = speaking ? "scale(1.1)" : "scale(1)";
    if (glowRef.current) {
      glowRef.current.style.opacity = speaking ? "0.9" : "0.45";
      glowRef.current.style.boxShadow = `0 0 14px 6px rgba(${tone.glowInner},0.5)`;
    }
  }, [reduced, speaking, tone.glowInner]);

  useEffect(() => {
    if (reduced) return;

    let frame = 0;
    let level = 0; // smoothed, 0..1

    const tick = () => {
      frame = requestAnimationFrame(tick);
      const levels = readLevelsRef.current?.() ?? null;

      let target = 0.06; // the idle breath
      if (levels) {
        // The curves are perceptual, not linear: a quiet voice should still
        // visibly move the orb, and a loud one should not blow it up.
        const agent = Math.min(1, Math.pow(levels.agent * 3.4, 0.75));
        const mic = Math.min(1, Math.pow(levels.mic * 3, 0.8));
        if (agent > 0.06) target = 0.15 + 0.85 * agent;
        else if (mic > 0.08) target = 0.08 + 0.25 * mic;
        else target = 0.05;
      } else if (speakingRef.current) {
        // No analyser yet — a gentle synthetic pulse, so the orb is never dead
        // while the agent is plainly talking.
        target = 0.4 + 0.35 * Math.abs(Math.sin(performance.now() / 200));
      }

      // Fast attack, slow release, which is how loudness is actually heard.
      level += (target - level) * (target > level ? 0.35 : 0.12);

      const core = coreRef.current;
      if (core) core.style.transform = `scale(${(1 + level * 0.42).toFixed(3)})`;

      const glow = glowRef.current;
      if (glow) {
        glow.style.opacity = (0.35 + level * 0.65).toFixed(3);
        const spread = 4 + level * 16;
        const blur = 8 + level * 22;
        glow.style.boxShadow =
          `0 0 ${blur.toFixed(1)}px ${spread.toFixed(1)}px rgba(${tone.glowInner},${(0.4 + level * 0.5).toFixed(3)}), ` +
          `0 0 ${(blur * 1.6).toFixed(1)}px ${(spread * 1.5).toFixed(1)}px rgba(${tone.glowOuter},${(0.25 + level * 0.4).toFixed(3)})`;
      }
    };

    tick();
    return () => cancelAnimationFrame(frame);
  }, [reduced, tone.glowInner, tone.glowOuter]);

  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <span ref={glowRef} className="absolute inset-0 rounded-full" style={{ willChange: "opacity, box-shadow" }} />
      <span
        ref={coreRef}
        className="absolute inset-0 rounded-full"
        style={{
          willChange: "transform",
          background: tone.core,
          boxShadow: "inset 0 0 8px rgba(255,255,255,0.45)",
        }}
      />
      {speaking && !reduced && (
        <span className="absolute inset-0 rounded-full border border-gold/50 motion-safe:animate-ping" />
      )}
    </span>
  );
}
