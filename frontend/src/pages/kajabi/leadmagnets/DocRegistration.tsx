import { Seo } from "@/components/Seo";
import { MarkedList, ProgramFaq, Pull, QuoteCard, Prose } from "@/components/home/luxe/ProgramSections";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { LuxePageHero } from "@/components/luxe/LuxePageHero";
import { GoldRule, Section, SectionTitle } from "@/components/luxe/Section";
import { DOC_TRAINING, docRegistration as c } from "@/content/leadMagnetsDocumentation";
import { cn } from "@/lib/cn";
import { CheckMark, FramedImage, Rise } from "./parts";

/**
 * /doc-registration — the sales page for The Do's & Don'ts of Clinical
 * Documentation, her live CEU workshop, section for section in her words.
 *
 * Every pair of register buttons goes to this site's checkout for the two
 * offers Kajabi sold (dos-and-donts-of-documentation-ce / -edu); migration 097
 * sends each offer's buyers on to its thank-you page (/dos-and-donts-ty,
 * /dos-donts-ty), as Kajabi did.
 */
export default function DocRegistration() {
  return (
    <>
      <Seo title={c.seo.title} description={c.seo.description} image={c.instructor.photo.src} />

      <LuxePageHero
        eyebrow={c.hero.eyebrow}
        title={c.hero.title}
        titleAccent={c.hero.titleAccent}
        tone="violet"
        lede={
          <>
            <span className="block">{c.hero.sub}</span>
            <span className="mt-5 block">{c.hero.body}</span>
          </>
        }
        actions={
          <>
            <RegisterButtons />
            <Meta items={c.hero.meta} className="w-full" />
          </>
        }
        aside={<NoteComparison flaggedTag={c.notes.flagged.tag} strongerTag={c.notes.approved.tag} />}
      />

      <Section surface="raised" space="lg" aurora="plum" auroraIntensity={0.5} aria-label={c.pain.title} containerClassName="max-w-3xl">
        <SectionTitle align="center" title={c.pain.title} titleClassName="text-[1.7rem] sm:text-[2.1rem] lg:text-[2.4rem]" />
        <Rise delay={0.08}>
          <Prose paragraphs={c.pain.paragraphs} className="mx-auto mt-8 max-w-[62ch]" />
        </Rise>
        <Pull className="mt-12">{c.pain.closing}</Pull>
      </Section>

      <Section surface="deep" space="lg" aurora="gold" auroraIntensity={0.45} aria-label={c.compare.title} containerClassName="max-w-5xl">
        <SectionTitle align="center" title={c.compare.title} titleClassName="text-[1.6rem] sm:text-[2rem] lg:text-[2.3rem]" />
        <NoteComparison flaggedTag={c.compare.flaggedTag} strongerTag={c.compare.strongerTag} wide className="mt-10" />
        <p className="copy-luxe mx-auto mt-8 max-w-[52ch] text-pretty text-center italic">{c.compare.note}</p>
      </Section>

      <Section surface="base" space="lg" aurora="violet" auroraIntensity={0.45} aria-label={c.learn.eyebrow} containerClassName="max-w-4xl">
        <SectionTitle eyebrow={c.learn.eyebrow} title={c.learn.title} />
        <Rise delay={0.06}>
          <MarkedList items={c.learn.items} variant="check" className="mt-10" />
        </Rise>
        <Rise delay={0.1} className="mx-auto mt-12 max-w-2xl">
          <QuoteCard quote={c.learn.quote.text} name={c.learn.quote.name} accent="plum" />
        </Rise>
        <ClosingCall lede={c.learn.lede} className="mt-12" />
      </Section>

      <Section surface="raised" space="lg" aurora="green" auroraIntensity={0.45} aria-label={c.who.eyebrow} containerClassName="max-w-4xl">
        <SectionTitle eyebrow={c.who.eyebrow} title={c.who.title} />
        <ul className="mt-10 grid list-none gap-4 sm:grid-cols-2">
          {c.who.items.map((item, i) => (
            <li key={item} className={i === c.who.items.length - 1 ? "sm:col-span-2" : undefined}>
              <Rise delay={0.05 * i} className="h-full">
                <GlassCard accent="green" interactive={false} spotlight={false} className="flex h-full gap-3.5 p-5 sm:p-6">
                  <CheckMark />
                  <span className="copy-luxe min-w-0 text-pretty text-[0.95rem]">{item}</span>
                </GlassCard>
              </Rise>
            </li>
          ))}
        </ul>
      </Section>

      <Section surface="deep" space="lg" aurora="plum" auroraIntensity={0.5} aria-label={c.instructor.eyebrow} containerClassName="max-w-6xl">
        <div className="grid items-start gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
          <Rise className="mx-auto w-full max-w-sm lg:sticky lg:top-28">
            <FramedImage image={c.instructor.photo} imgClassName="aspect-square object-top" />
          </Rise>
          <Rise delay={0.1} className="min-w-0">
            <span className="eyebrow-luxe">{c.instructor.eyebrow}</span>
            <h2 className="font-display text-[2rem] font-medium leading-[1.14] text-white sm:text-[2.6rem]">{c.instructor.name}</h2>
            <p className="mt-3 text-[0.72rem] font-semibold uppercase leading-relaxed tracking-[0.16em] text-gold">{c.instructor.role}</p>
            <GoldRule className="mt-7" />
            <Prose paragraphs={c.instructor.paragraphs} className="mt-7" />
            <ClosingCall lede={c.instructor.lede} className="mt-10" align="left" />
          </Rise>
        </div>
      </Section>

      <Section surface="base" space="lg" aurora="mixed" auroraIntensity={0.6} aria-label={c.included.eyebrow} containerClassName="max-w-5xl">
        <SectionTitle align="center" eyebrow={c.included.eyebrow} title={c.included.title} />

        <Kicker label={c.included.kicker} title={c.included.blockTitle} className="mt-14" />
        <div className="mt-8 grid gap-5 md:grid-cols-2">
          {c.included.tiers.map((tier, i) => (
            <Rise key={tier.name} delay={0.06 * i} className="h-full">
              <GlassCard accent={i === 0 ? "gold" : "plum"} interactive={false} className="flex h-full flex-col p-6 sm:p-8">
                <h3 className="font-display text-[1.4rem] font-medium text-white sm:text-[1.6rem]">{tier.name}</h3>
                <p className="mt-3 text-[2.2rem] font-bold leading-none tabular-nums text-gold">{tier.price}</p>
                <p className="copy-luxe mt-2 text-sm">{tier.sub}</p>
                <GoldRule className="mt-5" width="w-12" />
                <ul className="mt-5 flex-1 space-y-3">
                  {tier.items.map((item) => (
                    <li key={item} className="flex gap-3">
                      <CheckMark />
                      <span className="copy-luxe min-w-0 text-pretty text-[0.95rem]">{item}</span>
                    </li>
                  ))}
                </ul>
                <LuxeButton variant={i === 0 ? "foil" : "glass"} size="md" to={tier.to} className="mt-7 w-full">
                  {tier.cta}
                </LuxeButton>
              </GlassCard>
            </Rise>
          ))}
        </div>

        <Kicker label={c.details.kicker} title={c.details.blockTitle} className="mt-16" />
        <Rise className="mt-8">
          <GlassCard accent="neutral" interactive={false} spotlight={false} className="p-6 sm:p-8">
            <dl className="divide-y divide-white/10">
              {c.details.rows.map(([label, value]) => (
                <div key={label} className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-6">
                  <dt className="w-32 shrink-0 text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-gold">{label}</dt>
                  <dd className="copy-luxe text-[0.95rem]">{value}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-6 space-y-4">
              {c.details.approvals.map((approval) => (
                <p key={approval.label} className="copy-luxe text-pretty text-sm">
                  <strong className="font-semibold text-white">{approval.label}</strong> {approval.body}
                </p>
              ))}
            </div>
          </GlassCard>
        </Rise>

        <Kicker label={c.modules.kicker} title={c.modules.blockTitle} className="mt-16" />
        <ol className="mt-8 grid list-none gap-4 md:grid-cols-2">
          {c.modules.items.map((module, i) => (
            <li key={module.num}>
              <Rise delay={0.04 * i} className="h-full">
                <GlassCard accent={i % 2 === 0 ? "gold" : "plum"} interactive={false} spotlight={false} className="flex h-full gap-5 p-6">
                  <span aria-hidden className="shrink-0 text-[1.6rem] font-bold leading-none tabular-nums text-gold">
                    {module.num}
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-pretty font-display text-[1.15rem] font-medium leading-snug text-white sm:text-[1.25rem]">
                      {module.title}
                    </h3>
                    <p className="mt-1 text-[0.72rem] font-semibold uppercase tabular-nums tracking-[0.16em] text-gold">{module.mins}</p>
                    <p className="copy-luxe mt-3 text-pretty text-[0.95rem]">{module.body}</p>
                  </div>
                </GlassCard>
              </Rise>
            </li>
          ))}
        </ol>
        <p className="copy-luxe mt-8 text-center text-sm">{c.modules.total}</p>
      </Section>

      <Section surface="raised" space="lg" aurora="violet" auroraIntensity={0.5} aria-label={c.ai.title} containerClassName="max-w-3xl">
        <SectionTitle align="center" title={c.ai.title} titleClassName="text-[1.6rem] sm:text-[2rem] lg:text-[2.3rem]" />
        <Rise delay={0.08}>
          <p className="copy-luxe mx-auto mt-8 max-w-[62ch] text-pretty text-center">{c.ai.body}</p>
        </Rise>
        <Pull className="mt-12">{c.ai.line}</Pull>
      </Section>

      <Section surface="deep" space="lg" aurora="gold" auroraIntensity={0.45} aria-label={c.testimonials.kicker} containerClassName="max-w-5xl">
        <Kicker label={c.testimonials.kicker} title={c.testimonials.blockTitle} />
        <div className="mt-8 grid gap-5 md:grid-cols-2">
          {c.testimonials.items.map((item, i) => (
            <Rise key={item.name} delay={0.05 * i} className="h-full">
              <QuoteCard quote={item.quote} name={item.name} accent={i % 2 === 0 ? "gold" : "plum"} />
            </Rise>
          ))}
        </div>
      </Section>

      <ProgramFaq eyebrow={c.faq.eyebrow} title={c.faq.title} items={c.faq.items} />

      <Section surface="deep" space="xl" aurora="mixed" auroraIntensity={0.9} aria-label={c.final.title} containerClassName="max-w-3xl">
        <SectionTitle align="center" title={c.final.title} body={c.final.body} />
        <div className="mt-10 flex flex-col items-center gap-5">
          <RegisterButtons centered />
          <Meta items={c.final.meta} className="justify-center text-center" />
        </div>
      </Section>
    </>
  );
}

/* ── Pieces ─────────────────────────────────────────────────────────── */

function RegisterButtons({ centered = false }: { centered?: boolean }) {
  return (
    <div className={cn("flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:flex-wrap", centered && "items-center justify-center")}>
      <LuxeButton variant="foil" size="lg" to={DOC_TRAINING.checkout.ce.to} className="w-full sm:w-auto">
        {DOC_TRAINING.checkout.ce.label}
      </LuxeButton>
      <LuxeButton variant="glass" size="lg" to={DOC_TRAINING.checkout.edu.to} className="w-full sm:w-auto">
        {DOC_TRAINING.checkout.edu.label}
      </LuxeButton>
    </div>
  );
}

/** "Live on Zoom • September 25, 2026 • …" */
function Meta({ items, className }: { items: readonly string[]; className?: string }) {
  return (
    <p className={cn("flex flex-wrap gap-x-2 gap-y-1 text-sm font-light leading-[1.7] text-orchid-faint", className)}>
      {items.map((item, i) => (
        <span key={item} className="inline-flex gap-2">
          {i > 0 && <span aria-hidden>•</span>}
          {item}
        </span>
      ))}
    </p>
  );
}

function ClosingCall({ lede, className, align = "center" }: { lede: string; className?: string; align?: "left" | "center" }) {
  return (
    <div className={cn("flex flex-col gap-6", align === "center" ? "items-center text-center" : "items-start", className)}>
      <p className="text-balance font-display text-[1.3rem] italic leading-[1.4] text-white sm:text-[1.5rem]">{lede}</p>
      <RegisterButtons centered={align === "center"} />
    </div>
  );
}

function Kicker({ label, title, className }: { label: string; title: string; className?: string }) {
  return (
    <div className={cn("text-center", className)}>
      <span className="eyebrow-luxe">{label}</span>
      <h3 className="text-balance font-display text-[1.5rem] font-medium leading-snug text-white sm:text-[1.8rem]">{title}</h3>
    </div>
  );
}

/** Her two sample notes: the vague one flagged, the specific one approved. */
function NoteComparison({
  flaggedTag,
  strongerTag,
  wide = false,
  className,
}: {
  flaggedTag: string;
  strongerTag: string;
  wide?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-4", wide && "md:grid-cols-2", className)}>
      <GlassCard accent="neutral" interactive={false} spotlight={false} className="p-5 sm:p-6">
        <span className="inline-flex rounded-full border border-red-400/40 bg-red-500/[0.1] px-3 py-1 text-[0.68rem] font-bold uppercase tracking-[0.16em] text-red-300">
          {flaggedTag}
        </span>
        <p className="copy-luxe mt-4 text-pretty font-mono text-[0.9rem]">{c.notes.flagged.text}</p>
      </GlassCard>
      <GlassCard accent="green" interactive={false} spotlight={false} className="p-5 sm:p-6">
        <span className="inline-flex rounded-full border border-green-bright/40 bg-green-bright/[0.1] px-3 py-1 text-[0.68rem] font-bold uppercase tracking-[0.16em] text-green-bright">
          {strongerTag}
        </span>
        <p className="copy-luxe mt-4 text-pretty font-mono text-[0.9rem]">{c.notes.approved.text}</p>
      </GlassCard>
    </div>
  );
}
