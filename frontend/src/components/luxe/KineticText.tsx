import { Fragment } from "react";
import { motion, type Transition } from "motion/react";
import { useEntranceMotion } from "@/hooks/useEntranceMotion";
import { cn } from "@/lib/cn";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

interface KineticTextProps {
  text: string;
  /** Seconds before the first word moves. Chain lines by offsetting this. */
  delay?: number;
  /** Seconds between consecutive words. */
  stagger?: number;
  /** Runs on mount (hero) rather than on scroll into view. */
  immediate?: boolean;
  className?: string;
  wordClassName?: string;
  as?: "span" | "div";
}

/**
 * Word-by-word entrance for display type.
 *
 * Each word rises out of a clipping mask instead of merely fading, so the line
 * assembles the way letterpress type is set rather than appearing all at once.
 * Splitting on words (not characters) is deliberate: per-character staggering a
 * 40-character headline creates 40 animated layers and shreds the word shapes
 * screen readers and dyslexic readers rely on.
 *
 * The full string stays in the accessible tree as one label; the visual words
 * are `aria-hidden`, so assistive tech reads a sentence, not a word list.
 */
export function KineticText({
  text,
  delay = 0,
  stagger = 0.07,
  immediate = false,
  className,
  wordClassName,
  as = "span",
}: KineticTextProps) {
  const reduce = useEntranceMotion();
  const Tag = as === "div" ? motion.div : motion.span;

  if (reduce) {
    return <span className={className}>{text}</span>;
  }

  const words = text.split(" ");
  const motionState = immediate
    ? { animate: "show" as const }
    : {
        whileInView: "show" as const,
        viewport: { once: true, margin: "-10% 0px -10% 0px" },
      };

  const transition: Transition = { duration: 0.85, ease: EASE };

  return (
    <>
      <span className="sr-only">{text}</span>
      <Tag
        aria-hidden
        initial="hidden"
        {...motionState}
        className={cn("inline", className)}
      >
        {words.map((word, i) => (
          <Fragment key={`${word}-${i}`}>
            {/* The mask must be inline-block with overflow hidden for the clip
                to work; pb/-mb keeps descenders (y, g, p) from being sheared. */}
            <span className="inline-block overflow-hidden pb-[0.12em] align-bottom">
              <motion.span
                variants={{
                  hidden: { y: "108%" },
                  show: { y: 0, transition: { ...transition, delay: delay + i * stagger } },
                }}
                className={cn("inline-block", wordClassName)}
              >
                {word}
              </motion.span>
            </span>
            {i < words.length - 1 && " "}
          </Fragment>
        ))}
      </Tag>
    </>
  );
}
