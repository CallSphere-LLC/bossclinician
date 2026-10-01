import { Fragment, type ReactNode } from "react";
import { Link } from "react-router";
import { motion } from "motion/react";
import { Seo } from "@/components/Seo";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxePageHero } from "@/components/luxe/LuxePageHero";
import { LuxePill } from "@/components/luxe/LuxeButton";
import { GoldRule, Section } from "@/components/luxe/Section";
import { useEntranceMotion } from "@/hooks/useEntranceMotion";
import { cn } from "@/lib/cn";
import type {
  KajabiLegalDoc,
  LegalBlock,
  LegalClause,
  LegalSpan,
  LegalText,
} from "@/content/kajabiPagesLegal";

/**
 * Renders one of the agreements in `content/kajabiPagesLegal.ts`.
 *
 * Same reading treatment as `pages/legal/Terms.tsx` — quiet hero, one 70ch
 * measure, a foil tick over each heading and a sticky index on wide screens —
 * extended with the few shapes these documents need that the site terms do
 * not: bulleted clauses, inline emphasis and links, "Section 04" labels, the
 * retreat's two room prices, and a closing contact card.
 */

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const VIEWPORT = { once: true, margin: "-10% 0px -6% 0px" } as const;

const LINK = cn(
  "text-gold underline decoration-gold/40 underline-offset-4 break-words",
  "transition-colors duration-300 hover:text-gold-bright hover:decoration-gold",
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
);

function Span({ span }: { span: LegalSpan }) {
  if (typeof span === "string") return <>{span}</>;

  let node: ReactNode = span.text;
  if (span.italic) node = <em>{node}</em>;
  if (span.bold) node = <strong className="font-semibold text-white">{node}</strong>;

  if (!span.href) return <>{node}</>;
  if (span.href.startsWith("/")) {
    return (
      <Link to={span.href} className={LINK}>
        {node}
      </Link>
    );
  }
  const web = /^https?:\/\//i.test(span.href);
  return (
    <a
      href={span.href}
      className={LINK}
      target={web ? "_blank" : undefined}
      rel={web ? "noopener noreferrer" : undefined}
    >
      {node}
    </a>
  );
}

function Text({ text }: { text: LegalText }) {
  if (typeof text === "string") return <>{text}</>;
  return (
    <>
      {text.map((span, i) => (
        <Span key={i} span={span} />
      ))}
    </>
  );
}

function Block({ block }: { block: LegalBlock }) {
  switch (block.type) {
    case "subhead":
      return <h3 className="pt-1 font-sans text-[0.98rem] font-semibold leading-snug text-white">{block.text}</h3>;

    case "list":
      return (
        <ul className="space-y-3.5">
          {block.items.map((item, i) => (
            <li key={i} className="copy-luxe flex gap-3.5 text-pretty break-words">
              <span aria-hidden className="mt-[0.72em] h-px w-3 shrink-0 bg-gold/70" />
              <span className="min-w-0">
                <Text text={item} />
              </span>
            </li>
          ))}
        </ul>
      );

    case "pricing":
      return (
        <div className="grid gap-4 sm:grid-cols-2">
          {block.options.map((option) => (
            <GlassCard key={option.name} accent="gold" interactive={false} className="p-6 text-center">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-gold">{option.eyebrow}</p>
              <p className="mt-2 font-display text-[1.25rem] font-medium leading-snug text-white">{option.name}</p>
              <p className="mt-3 font-sans text-[2rem] font-bold tabular-nums leading-none text-white">{option.price}</p>
              {option.per && <p className="mt-1.5 text-xs uppercase tracking-[0.14em] text-orchid-dim">{option.per}</p>}
              <p className="mt-4 text-sm leading-[1.6] text-orchid-dim">
                {option.note.map((line) => (
                  <span key={line} className="block">
                    {line}
                  </span>
                ))}
              </p>
            </GlassCard>
          ))}
        </div>
      );

    case "p":
    default:
      if (block.tone === "callout") {
        return (
          <p className="copy-luxe rounded-xl border border-gold/35 bg-gold/[0.06] px-5 py-4 text-pretty break-words">
            <Text text={block.text} />
          </p>
        );
      }
      return (
        <p className={cn("copy-luxe text-pretty break-words", block.tone === "note" && "italic")}>
          <Text text={block.text} />
        </p>
      );
  }
}

function Clause({ clause, reduce }: { clause: LegalClause; reduce: boolean | null }) {
  return (
    <motion.section
      id={clause.id}
      aria-labelledby={clause.heading ? `${clause.id}-heading` : undefined}
      // Clears the sticky header when the index jumps here.
      className="scroll-mt-28"
      initial={reduce ? false : { opacity: 0, y: 22 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={VIEWPORT}
      transition={{ duration: 0.7, ease: EASE }}
    >
      {clause.heading && (
        <>
          <GoldRule width="w-8" className="mb-5" />
          {clause.label && (
            <p className="mb-2 text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-gold">{clause.label}</p>
          )}
          <h2
            id={`${clause.id}-heading`}
            className="text-balance font-display text-[1.2rem] font-medium leading-[1.35] tracking-[0.02em] text-white sm:text-[1.4rem]"
          >
            {clause.heading}
          </h2>
        </>
      )}

      <div className={cn("space-y-5", clause.heading && "mt-6")}>
        {clause.blocks.map((block, i) => (
          <Fragment key={i}>
            <Block block={block} />
          </Fragment>
        ))}
      </div>
    </motion.section>
  );
}

export function KajabiLegalDocument({ doc }: { doc: KajabiLegalDoc }) {
  const reduce = useEntranceMotion();
  const index = doc.clauses.filter((clause) => clause.heading !== null);
  // Below four entries an index is chrome, not navigation.
  const hasIndex = index.length >= 4;
  const label = doc.titleAccent ? `${doc.title} ${doc.titleAccent}` : doc.title;

  return (
    <>
      <Seo
        title={doc.seo.title}
        description={doc.seo.description}
        image={doc.seo.image}
        canonicalPath={doc.seo.canonicalPath}
      />

      <LuxePageHero
        eyebrow={doc.eyebrow}
        title={doc.title}
        titleAccent={doc.titleAccent}
        tone="plum"
        lede={doc.lede}
        actions={doc.dateLine ? <LuxePill accent="gold">{doc.dateLine}</LuxePill> : undefined}
      />

      <Section surface="base" space="md" aria-label={label}>
        <div
          className={cn(
            "mx-auto",
            hasIndex
              ? "max-w-[62rem] xl:grid xl:grid-cols-[minmax(0,1fr)_15rem] xl:gap-8"
              : "max-w-[70ch]",
          )}
        >
          <article className={cn("space-y-10", hasIndex && "mx-auto max-w-[70ch] xl:mx-0")}>
            {doc.letterhead && (
              // The mark is navy on transparent — it needs a light plate to read
              // on the dark theme, as it did on Kajabi's white page.
              <div className="mx-auto w-full max-w-[16rem] rounded-2xl border border-gold/25 bg-[#f7f3ec] p-6 shadow-[0_30px_70px_-34px_rgba(0,0,0,0.9)]">
                <img
                  src={doc.letterhead.src}
                  alt={doc.letterhead.alt}
                  width={1000}
                  height={824}
                  loading="lazy"
                  decoding="async"
                  className="block h-auto w-full"
                />
              </div>
            )}

            {doc.clauses.map((clause) => (
              <Clause key={clause.id} clause={clause} reduce={reduce} />
            ))}

            {doc.contact && (
              <GlassCard accent="gold" interactive={false} className="p-7 text-center sm:p-9">
                <h2 className="font-display text-[1.4rem] font-medium leading-snug text-white sm:text-[1.6rem]">
                  {doc.contact.heading}
                </h2>
                <p className="copy-luxe mt-3 text-pretty">{doc.contact.body}</p>
                <p className="mt-5">
                  <a href={`mailto:${doc.contact.email}`} className={cn(LINK, "text-base font-semibold")}>
                    {doc.contact.email}
                  </a>
                </p>
                <div aria-hidden className="rule-faint mx-auto mt-7 w-full" />
                {doc.contact.lines.map((line) => (
                  <p key={line} className="mt-4 text-pretty text-xs leading-[1.7] text-orchid-faint">
                    {line}
                  </p>
                ))}
              </GlassCard>
            )}
          </article>

          {hasIndex && (
            <nav aria-label={`${label} sections`} className="hidden xl:block">
              <div className="sticky top-28">
                <GlassCard accent="gold" interactive={false} className="p-5">
                  <ul className="max-h-[calc(100vh-11rem)] space-y-0.5 overflow-y-auto">
                    {index.map((clause) => (
                      <li key={clause.id}>
                        <a
                          href={`#${clause.id}`}
                          className={cn(
                            "group flex min-h-[44px] items-center gap-3 rounded-lg px-2 py-2.5",
                            "text-[0.78rem] leading-snug tracking-[0.02em] text-orchid-dim",
                            "transition-colors duration-300 hover:bg-white/[0.05] hover:text-white",
                            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
                          )}
                        >
                          <span
                            aria-hidden
                            className="h-px w-3 shrink-0 bg-gold/50 transition-all duration-300 group-hover:w-5 group-hover:bg-gold"
                          />
                          <span className="min-w-0">{clause.heading}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </GlassCard>
              </div>
            </nav>
          )}
        </div>
      </Section>
    </>
  );
}
