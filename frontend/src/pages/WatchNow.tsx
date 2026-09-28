import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { motion } from "motion/react";
import { Seo } from "@/components/Seo";
import { QuoteCard, rise } from "@/components/home/luxe/ProgramSections";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { GoldRule, Section } from "@/components/luxe/Section";
import { Container } from "@/components/ui/Container";
import { Aurora } from "@/components/luxe/Aurora";
import { watchNow as w } from "@/content/freedomMasterclass";
import { useEntranceMotion } from "@/hooks/useEntranceMotion";
import { usePageData } from "@/hooks/usePageData";
import { api } from "@/lib/api";
import { DEFAULT_ACTION_GUIDE, greetingName } from "@/lib/masterclass";
import { playableVideo, type PlayableVideo } from "@/lib/videoEmbed";

/** The two public fields of the `masterclass` setting (services/settings.ts). */
interface MasterclassSettings {
  videoUrl?: string;
  actionGuideUrl?: string;
}

async function loadMasterclassSettings(): Promise<MasterclassSettings> {
  const settings = await api.settings();
  const value = settings.masterclass;
  return value && typeof value === "object" ? (value as MasterclassSettings) : {};
}

/**
 * The page a masterclass registration lands on — /watch-now?email=…&name=….
 *
 * Her Kajabi thank-you page, step for step: the "do not close the window"
 * banner, Step 1 the action guide, Step 2 the video, the Lounge invitation and a
 * client's words. The video is hers to set without a developer: Settings → Your
 * website → Free masterclass → "Masterclass video". Until she does, Step 2 shows
 * the masterclass cover and says the video is coming soon, never an empty
 * player.
 *
 * Client-rendered only (not in render.ts) and noindex: it greets the visitor by
 * the name in the query string, which is theirs, not a crawler's. The name is
 * shown only if it looks like a name — see `greetingName`.
 */
export default function WatchNow() {
  const [params] = useSearchParams();
  const name = greetingName(params.get("name"));
  const settings = usePageData("settings:masterclass", loadMasterclassSettings);
  const loaded = settings.status === "ready" ? settings.data : null;
  const guide = loaded?.actionGuideUrl?.trim() || DEFAULT_ACTION_GUIDE;

  return (
    <>
      <Seo title={w.seo.title} description={w.seo.description} noindex />

      <p
        role="note"
        className="bg-gold-foil px-4 py-2.5 text-center text-[0.68rem] font-bold uppercase tracking-[0.22em] text-night-deep"
      >
        {w.banner}
      </p>

      <Header name={name} />
      <StepOne guide={guide} />
      <StepTwo settings={settings.status === "loading" ? "loading" : loaded} />
      <LoungeSection />
      <Section surface="deep" space="md" aria-label="From a client" containerClassName="max-w-2xl">
        <QuoteCard quote={w.testimonial.quote} name={w.testimonial.name} accent="plum" />
      </Section>
    </>
  );
}

/* ── Welcome ─────────────────────────────────────────────────────────── */

function Header({ name }: { name: string | null }) {
  const reduce = useEntranceMotion();

  return (
    <section className="relative overflow-hidden bg-night-deep" aria-label="Your next steps">
      <Aurora tone="mixed" intensity={0.8} />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-night"
      />
      <Container className="relative z-[1] max-w-4xl py-10 text-center sm:py-12 lg:py-14">
        <motion.div {...rise(reduce)}>
          <p className="text-foil font-display text-[1.5rem] italic leading-tight sm:text-[1.9rem]">
            {name ? `${w.greeting}, ${name}.` : `${w.greeting}.`}
          </p>
          <h1 className="mt-3 text-balance font-display text-[2.4rem] font-normal leading-[1.06] text-white sm:text-[3.2rem] lg:text-[3.6rem]">
            {w.title}
          </h1>
          <GoldRule className="mx-auto mt-6" />
        </motion.div>
      </Container>
    </section>
  );
}

/* ── Step 1: the action guide ────────────────────────────────────────── */

function StepLabel({ label, title }: { label: string; title: string }) {
  return (
    <h2 className="text-balance font-display text-[1.7rem] font-medium leading-[1.15] text-white sm:text-[2.2rem]">
      <span className="text-foil mb-2 block text-[0.72rem] font-sans font-bold uppercase not-italic tracking-[0.24em]">
        {label}
      </span>
      {title}
    </h2>
  );
}

function StepOne({ guide }: { guide: string }) {
  const reduce = useEntranceMotion();
  const { image } = w.step1;

  return (
    <Section surface="base" space="md" aurora="plum" auroraIntensity={0.55} aria-label={w.step1.title} containerClassName="max-w-5xl">
      <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-12">
        <motion.div {...rise(reduce)} className="min-w-0 text-center lg:text-left">
          <StepLabel label={w.step1.label} title={w.step1.title} />
          <p className="copy-luxe mt-5 text-pretty">{w.step1.body}</p>
          <LuxeButton
            variant="foil"
            size="lg"
            href={guide}
            target="_blank"
            className="mt-8 w-full sm:w-auto"
          >
            <svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10" />
            </svg>
            {w.step1.cta}
          </LuxeButton>
        </motion.div>

        <motion.div {...rise(reduce, 0.1)} className="min-w-0">
          <GlassCard interactive={false} spotlight={false} className="overflow-hidden p-2">
            <img
              src={image.src}
              alt={image.alt}
              width={image.width}
              height={image.height}
              loading="eager"
              decoding="async"
              className="aspect-video h-auto w-full max-w-full rounded-xl object-cover"
            />
          </GlassCard>
        </motion.div>
      </div>
    </Section>
  );
}

/* ── Step 2: the video ───────────────────────────────────────────────── */

function StepTwo({ settings }: { settings: MasterclassSettings | null | "loading" }) {
  const reduce = useEntranceMotion();

  // Decided after mount: the page's own host is part of recognising a link to
  // this site's uploads, and the server render has no window to ask.
  const [host, setHost] = useState<string | undefined>(undefined);
  useEffect(() => setHost(window.location.host), []);

  const video = settings === "loading" || settings === null ? null : playableVideo(settings.videoUrl, host);

  return (
    <Section surface="raised" space="md" aurora="violet" auroraIntensity={0.5} aria-label={w.step2.title} containerClassName="max-w-4xl">
      <motion.div {...rise(reduce)} className="text-center">
        <StepLabel label={w.step2.label} title={w.step2.title} />
      </motion.div>

      <motion.div {...rise(reduce, 0.08)} className="mt-8">
        {settings === "loading" ? (
          <div
            role="status"
            aria-label="Loading the masterclass"
            className="aspect-video w-full animate-pulse rounded-2xl border border-white/10 bg-white/[0.04]"
          />
        ) : video ? (
          <Player video={video} />
        ) : (
          <ComingSoon />
        )}
      </motion.div>
    </Section>
  );
}

function Player({ video }: { video: PlayableVideo }) {
  const frame = "aspect-video w-full overflow-hidden rounded-2xl border border-white/10 bg-black shadow-glass";
  const { poster } = w.step2;

  if (video.kind === "file") {
    return (
      <div className={frame}>
        {/* No autoplay: a 60-minute talk starting with sound is not a welcome. */}
        <video
          src={video.src}
          poster={poster.src}
          controls
          playsInline
          preload="metadata"
          title={w.step2.videoTitle}
          className="size-full bg-black object-contain"
        />
      </div>
    );
  }

  if (video.kind === "frame") {
    return (
      <div className={frame}>
        <iframe
          src={video.src}
          title={w.step2.videoTitle}
          allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          className="size-full border-0"
        />
      </div>
    );
  }

  // A host the site's security policy will not frame: the cover, and a button
  // that opens the video where it lives.
  return (
    <Cover>
      <LuxeButton variant="foil" size="lg" href={video.href} target="_blank">
        <svg viewBox="0 0 16 16" aria-hidden className="h-3 w-3" fill="currentColor">
          <path d="M4.8 3.1 12.6 8l-7.8 4.9Z" />
        </svg>
        {w.step2.openLabel}
      </LuxeButton>
    </Cover>
  );
}

/**
 * No video set yet. The cover carries a small badge rather than a paragraph —
 * text over a busy image is hard to read at any width — and the explanation
 * sits under it.
 */
function ComingSoon() {
  return (
    <div role="status">
      <Cover>
        <span className="inline-flex items-center gap-2 rounded-full border border-gold/40 bg-night-deep/85 px-4 py-2 text-[0.66rem] font-bold uppercase tracking-[0.2em] text-gold backdrop-blur-md">
          <svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <circle cx="8" cy="8" r="6.2" />
            <path d="M8 4.8V8l2.2 1.4" />
          </svg>
          Coming soon
        </span>
      </Cover>
      <p className="mt-6 text-center font-display text-[1.3rem] font-medium text-white sm:text-[1.5rem]">
        {w.step2.comingSoonTitle}
      </p>
      <p className="copy-luxe mx-auto mt-2 max-w-md text-pretty text-center text-sm">{w.step2.comingSoonBody}</p>
    </div>
  );
}

/** The masterclass cover, dimmed, with whatever the slot has to say over it. */
function Cover({ children }: { children: React.ReactNode }) {
  const { poster } = w.step2;
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-night-deep shadow-glass">
      <img
        src={poster.src}
        alt={poster.alt}
        width={poster.width}
        height={poster.height}
        loading="lazy"
        decoding="async"
        className="aspect-video h-auto w-full max-w-full object-cover brightness-[0.5] saturate-[0.8]"
      />
      <div className="absolute inset-0 flex items-center justify-center p-4 sm:p-8">{children}</div>
    </div>
  );
}

/* ── The Lounge ──────────────────────────────────────────────────────── */

function LoungeSection() {
  const reduce = useEntranceMotion();
  const { photo } = w.lounge;

  return (
    <Section surface="base" space="lg" aurora="gold" auroraIntensity={0.5} aria-label={w.lounge.title} containerClassName="max-w-5xl">
      <div className="grid items-center gap-10 md:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] md:gap-14">
        <motion.div {...rise(reduce)} className="min-w-0 text-center md:text-left">
          <p className="copy-luxe text-pretty text-[1.05rem] italic">{w.lounge.question}</p>
          <h2 className="mt-6 text-balance font-display text-[1.9rem] font-medium leading-[1.14] text-white sm:text-[2.4rem]">
            {w.lounge.title}
          </h2>
          <GoldRule className="mx-auto mt-6 md:mx-0" />
          <LuxeButton variant="foil" size="lg" to={w.lounge.to} className="mt-8 w-full sm:w-auto">
            {w.lounge.cta}
          </LuxeButton>
          <p className="copy-luxe mt-8 text-sm">
            {w.lounge.dmLead}{" "}
            <a
              href={w.lounge.dmHref}
              target="_blank"
              rel="noopener noreferrer"
              className="text-orchid underline decoration-white/25 underline-offset-[6px] transition-colors duration-300 ease-luxe hover:text-gold hover:decoration-gold/60"
            >
              {w.lounge.dmLabel}
            </a>
          </p>
        </motion.div>

        <motion.div {...rise(reduce, 0.1)} className="mx-auto w-full max-w-xs md:max-w-none">
          <GlassCard interactive={false} spotlight={false} className="overflow-hidden p-2">
            <img
              src={photo.src}
              alt={photo.alt}
              width={photo.width}
              height={photo.height}
              loading="lazy"
              decoding="async"
              className="aspect-[4/5] h-auto w-full max-w-full rounded-xl object-cover object-top"
            />
          </GlassCard>
        </motion.div>
      </div>
    </Section>
  );
}
