import { Seo } from "@/components/Seo";
import { Prose } from "@/components/home/luxe/ProgramSections";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { LuxePageHero } from "@/components/luxe/LuxePageHero";
import { GoldRule, Section, SectionTitle } from "@/components/luxe/Section";
import { DOC_TRAINING, documentationThankYou as c } from "@/content/leadMagnetsDocumentation";
import { FramedImage, Rise } from "./parts";

type Tier = "ce" | "edu";

const EVENT_DETAILS = "Live on Zoom. Your Zoom link is in your confirmation email.";

/**
 * "Add it to your calendar", without Kajabi's calendar service: the web
 * calendars take the event in their own add-event address, and Apple Calendar
 * and desktop Outlook open the .ics file shipped in public/downloads.
 */
function calendarHref(name: (typeof c.steps.email.calendars)[number]): string {
  const title = encodeURIComponent(DOC_TRAINING.name);
  const details = encodeURIComponent(EVENT_DETAILS);
  const start = DOC_TRAINING.startsAtUtc;
  const end = DOC_TRAINING.endsAtUtc;
  // 20260925T200000Z -> 2026-09-25T20:00:00Z, the form the Outlook web apps read.
  const iso = (stamp: string) =>
    `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}Z`;
  const outlookQuery = `path=%2Fcalendar%2Faction%2Fcompose&rru=addevent&subject=${title}&startdt=${encodeURIComponent(iso(start))}&enddt=${encodeURIComponent(iso(end))}&body=${details}`;

  switch (name) {
    case "Google":
      return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${start}/${end}&details=${details}`;
    case "Office 365":
      return `https://outlook.office.com/calendar/0/deeplink/compose?${outlookQuery}`;
    case "Outlook.com":
      return `https://outlook.live.com/calendar/0/deeplink/compose?${outlookQuery}`;
    case "Yahoo":
      return `https://calendar.yahoo.com/?v=60&title=${title}&st=${start}&et=${end}&desc=${details}`;
    default:
      return DOC_TRAINING.ics;
  }
}

/**
 * /dos-and-donts-ty (General Admission, with CEU) and /dos-donts-ty
 * (Educational Access) — where the workshop's two checkouts land. One page,
 * as her two Kajabi pages were one page: the CE one names its tier and adds
 * the CEU step.
 */
export function DocumentationThankYou({ tier }: { tier: Tier }) {
  const steps = [
    { key: "email", title: c.steps.email.title, body: c.steps.email.body },
    { key: "worksheets", title: c.steps.worksheets.title, body: c.steps.worksheets.body },
    ...(tier === "ce" ? [{ key: "ceu", title: c.steps.ceu.title, body: c.steps.ceu.body }] : []),
    { key: "replay", title: c.steps.replay.title, body: c.steps.replay.body },
  ];

  const rows: ReadonlyArray<readonly [string, string]> = [
    c.confirm.rows.date,
    c.confirm.rows.time,
    c.confirm.rows.format,
    [c.confirm.registration.label, c.confirm.registration[tier]],
  ];

  return (
    <>
      <Seo title={c.seo[tier].title} description={c.seo.description} noindex />

      <LuxePageHero
        title={c.title}
        lede={c.lede}
        tone="green"
        aside={
          <GlassCard accent="gold" interactive={false} spotlight={false} className="mx-auto w-full max-w-md p-6 sm:p-8">
            <span className="eyebrow-luxe">{c.confirm.title}</span>
            <p className="text-balance font-display text-[1.4rem] font-medium leading-snug text-white">{c.confirm.course}</p>
            <GoldRule className="mt-5" width="w-12" />
            <dl className="mt-5 divide-y divide-white/10">
              {rows.map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4 py-2.5">
                  <dt className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-gold">{label}</dt>
                  <dd className="copy-luxe text-right text-sm tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
          </GlassCard>
        }
      />

      <Section surface="raised" space="lg" aurora="gold" auroraIntensity={0.5} aria-label={c.steps.title} containerClassName="max-w-4xl">
        <SectionTitle eyebrow={c.steps.eyebrow} title={c.steps.title} />
        <ol className="mt-10 list-none space-y-4">
          {steps.map((step, i) => (
            <li key={step.key}>
              <Rise delay={0.05 * i}>
                <GlassCard accent={i % 2 === 0 ? "gold" : "plum"} interactive={false} spotlight={false} className="flex gap-5 p-6 sm:gap-7 sm:p-7">
                  <span aria-hidden className="shrink-0 text-[1.8rem] font-bold leading-none tabular-nums text-gold">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-pretty font-display text-[1.2rem] font-medium leading-snug text-white sm:text-[1.35rem]">
                      {step.title}
                    </h3>
                    <p className="copy-luxe mt-2.5 text-pretty text-[0.95rem]">{step.body}</p>

                    {step.key === "email" && (
                      <div className="mt-5 flex flex-wrap gap-2.5">
                        {c.steps.email.calendars.map((name) => {
                          const href = calendarHref(name);
                          const external = href.startsWith("https://");
                          return (
                            <LuxeButton
                              key={name}
                              variant="glass"
                              size="sm"
                              href={href}
                              target={external ? "_blank" : undefined}
                              className="min-h-[40px] normal-case tracking-[0.04em]"
                            >
                              + {name}
                            </LuxeButton>
                          );
                        })}
                      </div>
                    )}

                    {step.key === "worksheets" && (
                      <ul className="mt-5 flex list-none flex-col gap-2.5 sm:flex-row sm:flex-wrap">
                        {c.steps.worksheets.links.map((link) => (
                          <li key={link.label}>
                            <LuxeButton variant="foil" size="sm" href={link.href} target="_blank" className="min-h-[40px]">
                              {link.label}
                            </LuxeButton>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </GlassCard>
              </Rise>
            </li>
          ))}
        </ol>
      </Section>

      <Section surface="deep" space="lg" aurora="plum" auroraIntensity={0.5} aria-label="A note from Yvette" containerClassName="max-w-5xl">
        <div className="grid items-center gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-14">
          <Rise className="mx-auto w-full max-w-sm">
            <FramedImage image={c.message.photo} />
          </Rise>
          <Rise delay={0.1} className="min-w-0">
            <Prose paragraphs={c.message.paragraphs} />
            <p className="mt-6 font-display text-[1.25rem] italic text-white">{c.message.signature}</p>
            <GoldRule className="mt-8" />
            <p className="copy-luxe mt-6 text-sm">
              {c.questions}{" "}
              <a
                href={`mailto:${c.email}`}
                className="text-gold underline decoration-gold/40 underline-offset-[6px] transition-colors duration-300 ease-luxe hover:decoration-gold"
              >
                {c.email}
              </a>
            </p>
          </Rise>
        </div>
      </Section>
    </>
  );
}

export function DocumentationThankYouCe() {
  return <DocumentationThankYou tier="ce" />;
}

export function DocumentationThankYouEdu() {
  return <DocumentationThankYou tier="edu" />;
}
