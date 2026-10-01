import { Seo } from "@/components/Seo";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxePageHero } from "@/components/luxe/LuxePageHero";
import { GoldRule, Section } from "@/components/luxe/Section";
import { profileAuditThankYou as c } from "@/content/leadMagnetsDocumentation";
import { FramedImage, Rise } from "./parts";

/**
 * /profile-audit-ty — where a Directory Makeover Audit purchase lands
 * (migration 097 points both audit offers' thank-you address here): what
 * happens next, in her four steps and her words.
 */
export default function ProfileAuditThankYou() {
  return (
    <>
      <Seo title={c.seo.title} description={c.seo.description} noindex />

      <LuxePageHero
        title={c.title}
        lede={c.lede}
        tone="mixed"
        aside={<FramedImage image={c.banner} priority className="mx-auto max-w-lg" />}
      />

      <Section surface="raised" space="lg" aurora="gold" auroraIntensity={0.5} aria-label={c.next} containerClassName="max-w-4xl">
        <Rise>
          <h2 className="text-balance font-display text-[1.7rem] font-medium leading-snug text-white sm:text-[2.1rem]">{c.next}</h2>
          <GoldRule className="mt-6" />
        </Rise>

        <ol className="mt-10 list-none space-y-4">
          {c.steps.map((step, i) => (
            <li key={step.title}>
              <Rise delay={0.05 * i}>
                <GlassCard accent={i % 2 === 0 ? "gold" : "green"} interactive={false} spotlight={false} className="p-6 sm:p-7">
                  <h3 className="text-pretty font-display text-[1.2rem] font-medium leading-snug text-white sm:text-[1.35rem]">{step.title}</h3>
                  <div className="mt-3 space-y-3">
                    {step.paragraphs.map((text) => (
                      <p key={text} className="copy-luxe text-pretty text-[0.95rem]">
                        {text}
                      </p>
                    ))}
                  </div>
                  {"perspectives" in step && (
                    <>
                      <p className="mt-4 flex flex-wrap gap-x-3 gap-y-1 text-[0.95rem] text-white">
                        {step.perspectives.map((who) => (
                          <span key={who}>✨ {who}</span>
                        ))}
                      </p>
                      <p className="copy-luxe mt-5 text-[0.95rem]">{step.receiveTitle}</p>
                      <ul className="mt-3 space-y-2">
                        {step.receive.map((item) => (
                          <li key={item} className="copy-luxe text-[0.95rem]">
                            {item}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </GlassCard>
              </Rise>
            </li>
          ))}
        </ol>
      </Section>

      <Section surface="deep" space="lg" aurora="plum" auroraIntensity={0.55} aria-label={c.help.title} containerClassName="max-w-3xl">
        <Rise className="text-center">
          <h2 className="font-display text-[1.6rem] font-medium text-white sm:text-[1.9rem]">{c.help.title}</h2>
          <p className="copy-luxe mt-4 text-pretty">
            {c.help.body} 📧{" "}
            <a
              href={`mailto:${c.help.email}`}
              className="break-all text-gold underline decoration-gold/40 underline-offset-[6px] transition-colors duration-300 ease-luxe hover:decoration-gold"
            >
              {c.help.email}
            </a>
          </p>
          <GoldRule className="mx-auto mt-10" />
          <p className="mx-auto mt-8 max-w-[34ch] text-balance font-display text-[1.5rem] italic leading-[1.35] text-white sm:text-[1.8rem]">
            {c.closing}
          </p>
        </Rise>
      </Section>
    </>
  );
}
