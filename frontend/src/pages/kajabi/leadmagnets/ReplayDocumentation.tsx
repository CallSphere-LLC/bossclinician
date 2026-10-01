import { useEffect, useState } from "react";
import { Seo } from "@/components/Seo";
import { GlassCard } from "@/components/luxe/GlassCard";
import { Section } from "@/components/luxe/Section";
import { replayDocumentation as c } from "@/content/leadMagnetsDocumentation";
import { MeetYvetteSection, RecordingFooter } from "./RecordingPage";
import { RecordingPlayer, Rise } from "./parts";

const CLOSES_AT = Date.parse(c.closesAt);

interface Remaining {
  days: number;
  hours: number;
  mins: number;
  secs: number;
}

function remainingAt(now: number): Remaining | null {
  const left = Math.max(0, CLOSES_AT - now);
  if (left === 0) return null;
  const total = Math.floor(left / 1000);
  return {
    days: Math.floor(total / 86_400),
    hours: Math.floor((total % 86_400) / 3_600),
    mins: Math.floor((total % 3_600) / 60),
    secs: total % 60,
  };
}

/**
 * /replay-documentation — the replay of The Do's & Don'ts of Clinical
 * Documentation, under the countdown to the end of its 60-day window, as on her
 * Kajabi page.
 *
 * The clock is read only after mount, so the server render (and a visitor with
 * scripts off) shows the page with zeros rather than a time the browser would
 * immediately contradict. When the window has closed, the player gives way to
 * a sentence saying so; her Kajabi countdown redirected to a page that no
 * longer exists.
 */
export default function ReplayDocumentation() {
  const [remaining, setRemaining] = useState<Remaining | null | "pending">("pending");

  useEffect(() => {
    const tick = () => setRemaining(remainingAt(Date.now()));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const closed = remaining === null;
  const shown: Remaining = remaining && remaining !== "pending" ? remaining : { days: 0, hours: 0, mins: 0, secs: 0 };
  const units: Array<[keyof Remaining, string]> = [
    ["days", c.countdownLabels.days],
    ["hours", c.countdownLabels.hours],
    ["mins", c.countdownLabels.mins],
    ["secs", c.countdownLabels.secs],
  ];

  return (
    <>
      <Seo title={c.seo.title} description={c.seo.description} noindex />

      <Section surface="base" space="lg" aurora="violet" auroraIntensity={0.7} aria-label={c.title} containerClassName="max-w-5xl" className="pt-28 sm:pt-32">
        <Rise>
          <div role="timer" aria-live="off" className="mx-auto grid max-w-xl grid-cols-4 gap-3">
            {units.map(([key, label]) => (
              <GlassCard key={key} accent="gold" interactive={false} spotlight={false} className="flex flex-col items-center p-3 sm:p-4">
                <span className="text-[1.9rem] font-bold leading-none tabular-nums text-white sm:text-[2.4rem]">
                  {String(shown[key]).padStart(2, "0")}
                </span>
                <span className="mt-2 text-[0.64rem] font-semibold tracking-[0.18em] text-gold">{label}</span>
              </GlassCard>
            ))}
          </div>
        </Rise>

        <Rise delay={0.08}>
          <h1 className="mt-12 text-balance text-center font-display text-[2rem] font-medium leading-[1.12] text-white sm:text-[2.6rem]">
            {c.title}
          </h1>
        </Rise>

        <Rise delay={0.12} className="mt-10">
          {closed ? (
            <GlassCard accent="neutral" interactive={false} spotlight={false} className="p-8 text-center">
              <p className="copy-luxe text-pretty">{c.closed}</p>
            </GlassCard>
          ) : (
            <RecordingPlayer url={c.videoUrl} title={c.videoTitle} />
          )}
        </Rise>
      </Section>

      <MeetYvetteSection meet={c.meet} />
      <RecordingFooter copyright={c.copyright} />
    </>
  );
}
