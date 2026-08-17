import { cn } from "@/lib/cn";

type Tone = "plum" | "gold" | "green" | "violet" | "mixed";

const TONES: Record<Tone, [string, string]> = {
  plum: ["rgba(123,94,167,0.34)", "rgba(75,46,131,0.22)"],
  violet: ["rgba(75,46,131,0.40)", "rgba(123,94,167,0.18)"],
  gold: ["rgba(201,164,106,0.20)", "rgba(123,94,167,0.24)"],
  green: ["rgba(74,124,107,0.26)", "rgba(123,94,167,0.22)"],
  mixed: ["rgba(123,94,167,0.32)", "rgba(201,164,106,0.16)"],
};

interface AuroraProps {
  tone?: Tone;
  /** 0–1. Scales the whole field; drop it on copy-dense sections. */
  intensity?: number;
  className?: string;
}

/**
 * Ambient light field behind a dark section.
 *
 * Two large blurred radials on long, offset drift cycles. Rendered as plain
 * divs with CSS transforms (not canvas/WebGL) so it composites on the GPU,
 * costs no main-thread frames, and degrades to a static gradient under
 * `prefers-reduced-motion`.
 *
 * Always `aria-hidden` + `pointer-events-none`: it is decoration only.
 */
export function Aurora({ tone = "plum", intensity = 1, className }: AuroraProps) {
  const [a, b] = TONES[tone];

  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
      style={{ opacity: intensity }}
    >
      <div
        className="animate-aurora-a absolute -left-[18%] -top-[28%] h-[75vw] max-h-[900px] w-[75vw] max-w-[900px] rounded-full blur-[90px] will-change-transform"
        style={{ background: `radial-gradient(circle, ${a} 0%, transparent 68%)` }}
      />
      <div
        className="animate-aurora-b absolute -bottom-[32%] -right-[16%] h-[68vw] max-h-[820px] w-[68vw] max-w-[820px] rounded-full blur-[100px] will-change-transform"
        style={{ background: `radial-gradient(circle, ${b} 0%, transparent 70%)` }}
      />
    </div>
  );
}

/**
 * Hairline seam between two dark sections. Without it, stacked near-black
 * bands merge into one undifferentiated field and the page loses rhythm.
 */
export function SectionSeam({ className }: { className?: string }) {
  return <div aria-hidden className={cn("rule-faint w-full", className)} />;
}
