import { Seo } from "@/components/Seo";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { LuxePageHero } from "@/components/luxe/LuxePageHero";
import { Section } from "@/components/luxe/Section";
import { optIn as c } from "@/content/leadMagnets";
import { Rise } from "./parts";

/**
 * /opt-in — her Kajabi page here was an unfinished template (its copy was
 * still Kajabi's bracketed placeholders), so this address offers the free
 * guides that do exist, each linking to its own sign-up page.
 */
export default function OptIn() {
  return (
    <>
      <Seo title={c.seo.title} description={c.seo.description} />

      <LuxePageHero eyebrow={c.eyebrow} title={c.title} lede={c.lede} tone="violet" align="center" />

      <Section surface="base" space="md" aria-label={c.eyebrow} containerClassName="max-w-6xl">
        <ul className="grid list-none gap-5 sm:grid-cols-2">
          {c.guides.map((guide, i) => (
            <li key={guide.to}>
              <Rise delay={0.05 * i} className="h-full">
                <GlassCard accent={i % 2 === 0 ? "gold" : "plum"} interactive={false} className="flex h-full flex-col overflow-hidden">
                  <img
                    src={guide.image}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="aspect-[16/10] h-auto w-full object-cover object-top"
                  />
                  <div className="flex flex-1 flex-col p-6 sm:p-7">
                    <h2 className="text-balance font-display text-[1.35rem] font-medium leading-snug text-white sm:text-[1.5rem]">
                      {guide.title}
                    </h2>
                    <p className="copy-luxe mt-3 flex-1 text-pretty text-[0.95rem]">{guide.body}</p>
                    <LuxeButton variant="foil" size="md" to={guide.to} className="mt-6 self-start">
                      {guide.cta}
                    </LuxeButton>
                  </div>
                </GlassCard>
              </Rise>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}
