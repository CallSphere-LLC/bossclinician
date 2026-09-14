import { useEffect } from "react";
import { motion } from "motion/react";
import { useEntranceMotion } from "@/hooks/useEntranceMotion";
import { Section, SectionTitle } from "@/components/luxe/Section";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton, LuxePill } from "@/components/luxe/LuxeButton";
import { footer } from "@/content/site";

const EASE_LUXE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const VIEWPORT = { once: true, margin: "-12% 0px -8% 0px" } as const;

/**
 * The four topics, with the leading emoji the live site sets on each. The
 * glyph is decorative — `aria-hidden` keeps screen readers on the words — and
 * sits at its own optical size so it does not fight the uppercase tracking of
 * the label beside it.
 */
const TOPICS = [
  { emoji: "📈", label: "Practice Strategy" },
  { emoji: "💡", label: "CEO Mindset" },
  { emoji: "💰", label: "Pricing Tips" },
  { emoji: "👑", label: "Group Practice" },
] as const;


/**
 * Live Instagram feed.
 *
 * The same LightWidget embed bossclinician.com serves, so both sites render the
 * identical grid of @bossclinician's latest posts from one widget Yvette
 * already controls — changing the layout there changes it on both.
 *
 * `aspect-square` is the load-time reservation: the widget is a 3×3 grid of
 * square cells, so its natural ratio is 1:1 and holding that space keeps the
 * footer from jumping when the iframe paints. LightWidget's own script then
 * posts the true height and overrides it, which is what keeps the frame correct
 * if the widget is ever reconfigured to a different row count.
 */
const LIGHTWIDGET_ID = "06ef2db14840566cbcf395b4a422fe14";
const LIGHTWIDGET_SCRIPT = "https://cdn.lightwidget.com/widgets/lightwidget.js";

function InstagramFeed({ reduce }: { reduce: boolean | null }) {
  useEffect(() => {
    if (document.querySelector(`script[src="${LIGHTWIDGET_SCRIPT}"]`)) return;
    const s = document.createElement("script");
    s.src = LIGHTWIDGET_SCRIPT;
    s.async = true;
    document.body.appendChild(s);
  }, []);

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={VIEWPORT}
      transition={{ duration: 0.8, ease: EASE_LUXE }}
      // Capped width, not just centred: the widget is a 3x3 grid, so its height
      // tracks its width exactly. Left to fill the container it rendered a
      // 1342px square at desktop — a single block taller than the viewport,
      // with 440px Instagram tiles. 672px keeps the tiles at a natural ~215px.
      className="relative mx-auto mt-12 max-w-2xl overflow-hidden rounded-2xl border border-gold/20 shadow-[0_40px_90px_-40px_rgba(0,0,0,0.95)]"
    >
      <iframe
        src={`https://lightwidget.com/widgets/${LIGHTWIDGET_ID}.html`}
        title="Latest posts from @bossclinician on Instagram"
        scrolling="no"
        loading="lazy"
        className="lightwidget-widget block aspect-square w-full border-0"
      />
    </motion.div>
  );
}

const AVATAR_GRADIENT =
  "linear-gradient(135deg, #4B2E83 0%, #7B5EA7 36%, #B9A2D6 62%, #C9A46A 100%)";

/** One rise recipe for the whole section; only the delay changes. */
function rise(reduce: boolean | null, delay: number) {
  return {
    initial: reduce ? false : { opacity: 0, y: 24 },
    whileInView: { opacity: 1, y: 0 },
    viewport: VIEWPORT,
    transition: { duration: 0.8, delay: reduce ? 0 : delay, ease: EASE_LUXE },
  };
}

function CameraGlyph({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" className={className}>
      <rect
        x="3.3"
        y="3.3"
        width="17.4"
        height="17.4"
        rx="5.2"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <circle cx="12" cy="12" r="4.1" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="17.05" cy="6.95" r="1.05" fill="currentColor" />
    </svg>
  );
}

export function LuxeInstagram() {
  const reduce = useEntranceMotion();

  return (
    <Section
      surface="base"
      space="md"
      aurora="mixed"
      auroraIntensity={0.55}
      aria-label="Instagram"
    >
      <SectionTitle
        align="center"
        eyebrow="FOLLOW ALONG ON INSTAGRAM"
        title="More strategy. Keeping it real. From a therapist who's been there."
        className="max-w-3xl"
        titleClassName="text-[1.8rem] leading-[1.14] sm:text-[2.4rem] lg:text-[2.8rem]"
      />

      <motion.div {...rise(reduce, 0.06)} className="mx-auto mt-12 max-w-md">
        <GlassCard accent="plum" interactive={false} className="p-7 text-center">
          <span
            aria-hidden
            className="mx-auto flex h-16 w-16 items-center justify-center rounded-full shadow-[0_16px_36px_-14px_rgba(123,94,167,0.9)] ring-1 ring-white/20"
            style={{ background: AVATAR_GRADIENT }}
          >
            <CameraGlyph className="h-7 w-7 text-night-deep/85" />
          </span>

          <p className="mt-5 font-display text-xl text-white">{footer.instagramHandle}</p>

          <p className="copy-luxe mt-2 text-pretty text-sm">
            Private practice strategy for clinicians building on their own terms
          </p>

          <ul className="mt-5 flex list-none flex-wrap justify-center gap-2">
            {TOPICS.map((topic) => (
              <li key={topic.label}>
                <LuxePill>
                  <span aria-hidden className="mr-1.5 text-[0.8rem] leading-none tracking-normal">
                    {topic.emoji}
                  </span>
                  {topic.label}
                </LuxePill>
              </li>
            ))}
          </ul>
        </GlassCard>
      </motion.div>

      <InstagramFeed reduce={reduce} />

      <motion.div {...rise(reduce, 0.14)} className="mt-9 text-center">
        <LuxeButton variant="foil" size="md" href={footer.instagram} target="_blank">
          Follow on Instagram
          <svg
            aria-hidden
            viewBox="0 0 20 8"
            fill="none"
            className="h-2 w-5 shrink-0 transition-transform duration-500 ease-luxe group-hover:translate-x-1.5"
          >
            <path
              d="M0 4h17.2M14 0.9 18 4l-4 3.1"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </LuxeButton>
      </motion.div>
    </Section>
  );
}
