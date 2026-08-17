import { useId } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";

interface ProgressRingProps {
  percent: number;
  /** Outer diameter in pixels. The stroke scales with it. */
  size?: number;
  /** Spoken instead of "62%", which is not what anyone came to the shelf to learn. */
  label: string;
  /** Swaps the arc for a filled tick at 100%. */
  showCheck?: boolean;
  className?: string;
}

/**
 * The progress ring on a library card.
 *
 * SVG rather than a conic-gradient background: the arc has to be a real element
 * so it can carry the progressbar semantics, and a gradient stroke is what makes
 * it read as foil rather than as a loading spinner.
 *
 * `aria-valuetext` carries the sentence, not the number. "62%" leaves a
 * screen-reader user to work out 62% of what; "8 of 13 lessons finished" is the
 * thing the sighted reader takes from the ring at a glance.
 */
export function ProgressRing({
  percent,
  size = 46,
  label,
  showCheck = true,
  className,
}: ProgressRingProps) {
  const gradientId = useId();
  const clamped = Math.min(100, Math.max(0, Math.round(percent)));
  const complete = clamped >= 100;

  const stroke = Math.max(3, Math.round(size * 0.085));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      aria-valuetext={label}
      className={cn("relative shrink-0", className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden focusable="false">
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#A07840" />
            <stop offset="45%" stopColor="#F0DCB4" />
            <stop offset="100%" stopColor="#C9A46A" />
          </linearGradient>
        </defs>

        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.10)"
          strokeWidth={stroke}
        />

        {/* Rotated so zero sits at twelve o'clock; SVG arcs start at three. */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          className="transition-[stroke-dashoffset] duration-700 ease-luxe"
        />
      </svg>

      <span className="absolute inset-0 grid place-items-center">
        {complete && showCheck ? (
          <Check aria-hidden className="size-[45%] text-gold-bright" strokeWidth={3} />
        ) : (
          <span
            aria-hidden
            className="font-body font-semibold text-white/85"
            style={{ fontSize: Math.max(9, Math.round(size * 0.26)) }}
          >
            {clamped}
          </span>
        )}
      </span>
    </div>
  );
}
