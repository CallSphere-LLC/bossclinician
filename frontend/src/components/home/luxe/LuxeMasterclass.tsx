import { motion } from "motion/react";
import { useEntranceMotion } from "@/hooks/useEntranceMotion";
import { Section } from "@/components/luxe/Section";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton } from "@/components/luxe/LuxeButton";

const EASE_LUXE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const VIEWPORT = { once: true, margin: "-12% 0px -8% 0px" } as const;

// Neither /masterclass nor /practice-reset-planner exists as a route yet, so
// both offers land on the Resource Hub, where the masterclass and the planner
// are actually hosted. Repoint both when the dedicated routes ship.
const OFFER_ROUTE = "/resources";

/**
 * One rise recipe for the whole stack; only the delay changes. Reduced-motion
 * users get `initial={false}`, i.e. the final state on mount — never a blank
 * element waiting on an observer that will never usefully fire.
 */
function rise(reduce: boolean | null, delay: number) {
  return {
    initial: reduce ? false : { opacity: 0, y: 24 },
    whileInView: { opacity: 1, y: 0 },
    viewport: VIEWPORT,
    transition: { duration: 0.85, delay: reduce ? 0 : delay, ease: EASE_LUXE },
  };
}

/**
 * The lead magnet, and the brightest moment on the page.
 *
 * Every other section is lit from the edges by drifting aurora; this one adds a
 * fixed pool of plum light directly under the headline so the type reads as
 * *illuminated* rather than merely placed on black. That contrast is the whole
 * job of the band — it should feel like a spotlit stage after a dark corridor.
 */
export function LuxeMasterclass() {
  const reduce = useEntranceMotion();

  return (
    <Section
      surface="deep"
      space="lg"
      aurora="plum"
      auroraIntensity={1.15}
      aria-label="Free masterclass"
      containerClassName="max-w-3xl text-center"
    >
      <div className="relative">
        {/* The pool of light. Anchored to the headline rather than the section
            so it stays put while the aurora behind it drifts. */}
        <motion.div
          aria-hidden
          initial={reduce ? false : { opacity: 0, scale: 0.9 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={VIEWPORT}
          transition={{ duration: 1.8, ease: EASE_LUXE }}
          className="pointer-events-none absolute left-1/2 top-[30%] -z-10 h-[34rem] w-[min(150%,60rem)] -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            background:
              "radial-gradient(ellipse at center, rgba(123,94,167,0.30) 0%, rgba(75,46,131,0.15) 40%, transparent 72%)",
          }}
        />

        {/* ── Play mark ───────────────────────────────────────────────────
            Decorative only: the real affordance is the button below, so this
            is aria-hidden rather than a second, silent link to the same page. */}
        <motion.div
          aria-hidden
          initial={reduce ? false : { opacity: 0, scale: 0.82 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={VIEWPORT}
          transition={{ duration: 1, ease: EASE_LUXE }}
          className="relative mx-auto mb-9 h-16 w-16"
        >
          <span
            className="absolute -inset-6 rounded-full blur-xl"
            style={{
              background:
                "radial-gradient(circle, rgba(201,164,106,0.28) 0%, transparent 70%)",
            }}
          />
          {/* Concentric outer hairline: one ring reads as an icon, two read as
              a halo radiating outward. */}
          <span className="absolute inset-[-0.9rem] rounded-full border border-gold/[0.16]" />
          <span className="animate-pulse-glow absolute inset-0 rounded-full border border-gold/50 shadow-[0_0_38px_-10px_rgba(201,164,106,0.7)]" />
          <svg viewBox="0 0 24 24" className="absolute inset-0 h-full w-full">
            <defs>
              <linearGradient id="luxe-play-foil" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#E8CE9A" />
                <stop offset="55%" stopColor="#C9A46A" />
                <stop offset="100%" stopColor="#A07840" />
              </linearGradient>
            </defs>
            {/* Vertices are nudged right so the triangle's centroid — not its
                bounding box — sits on the ring's centre. */}
            <path d="M9.8 8.5 L16 12 L9.8 15.5 Z" fill="url(#luxe-play-foil)" />
          </svg>
        </motion.div>

        <motion.span {...rise(reduce, 0.08)} className="eyebrow-luxe">
          FREE MASTERCLASS
        </motion.span>

        <motion.h2
          {...rise(reduce, 0.16)}
          className="text-balance font-display text-[2rem] font-medium leading-[1.1] text-white sm:text-[2.8rem] lg:text-[3.3rem]"
        >
          How to Create a Private Practice That Supports Your Income, Energy and Future
        </motion.h2>

        <motion.p
          {...rise(reduce, 0.28)}
          className="text-foil mt-5 text-balance font-display text-xl italic sm:text-2xl"
        >
          Without seeing 25 to 30 clients forever.
        </motion.p>

        <motion.p {...rise(reduce, 0.38)} className="copy-luxe mx-auto mt-7 max-w-xl text-pretty">
          A free masterclass for established clinicians whose practice is working, but who do not
          want their income, schedule, and future to depend on staying clinically maxed out. Learn
          why being fully booked can still leave you maxed out, and what needs to change so the
          practice supports your next season. Includes the complimentary Practice Freedom Audit.
        </motion.p>

        <motion.div {...rise(reduce, 0.48)}>
          <LuxeButton variant="foil" size="lg" to={OFFER_ROUTE} className="mt-10">
            Watch the Free Masterclass
          </LuxeButton>
        </motion.div>
      </div>

      {/* ── Secondary offer ─────────────────────────────────────────────────
          Held well clear of the primary CTA and dropped to a quieter material
          weight, so the eye finishes the masterclass pitch before it discovers
          there is a second free thing. */}
      <motion.div {...rise(reduce, 0.1)} className="mt-10">
        <GlassCard
          accent="gold"
          interactive={false}
          className="mx-auto flex max-w-xl flex-col items-center justify-between gap-5 p-6 text-left sm:flex-row"
        >
          <p className="min-w-0">
            <strong className="block text-sm font-semibold text-white">
              Also Free: The Practice Reset Planner
            </strong>
            <span className="copy-luxe block text-sm">
              30 days to work less, earn more, and rebuild your practice your way.
            </span>
          </p>

          <LuxeButton
            variant="outline"
            size="sm"
            to={OFFER_ROUTE}
            className="min-h-[44px] shrink-0"
          >
            Download
          </LuxeButton>
        </GlassCard>
      </motion.div>
    </Section>
  );
}
