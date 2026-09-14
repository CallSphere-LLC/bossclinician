import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router";
import { motion, useReducedMotion } from "motion/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Seo } from "@/components/Seo";
import { SubscribeForm } from "@/components/forms/SubscribeForm";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { LuxePageHero } from "@/components/luxe/LuxePageHero";
import { GoldRule, Section } from "@/components/luxe/Section";
import { ApiError, api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { contactPage } from "@/content/site";
import NotFound from "@/pages/NotFound";
import type { PublicFunnel, PublicFunnelStep } from "@/types";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/**
 * Where a step lives.
 *
 * The builder does not force a slug, so a step without one is addressed by its
 * position rather than dropping out of the sequence entirely.
 */
function stepPath(funnelSlug: string, step: PublicFunnelStep, index: number): string {
  return `/funnel/${funnelSlug}/${step.slug || index + 1}`;
}

/** The reverse: which step the URL is asking for. Falls back to the first. */
function resolveStepIndex(steps: PublicFunnelStep[], param: string | undefined): number {
  if (!param) return 0;
  const bySlug = steps.findIndex((s) => s.slug === param);
  if (bySlug >= 0) return bySlug;
  const position = Number(param);
  if (Number.isInteger(position) && position >= 1 && position <= steps.length) {
    return position - 1;
  }
  return 0;
}

/**
 * A funnel built in the admin, walked by a visitor.
 *
 * One route serves every step: the builder can add, reorder or rename steps
 * without anything here changing, which is the whole point of building them in
 * an admin rather than in this file. Each step counts its own view on arrival
 * and its own conversion when the visitor takes its action — those two numbers
 * are what the Funnels screen and the funnel report are made of, and without a
 * public page to bump them they would read zero forever.
 */
export default function FunnelPage() {
  const { slug = "", step: stepParam } = useParams();
  const reduce = useReducedMotion();
  // `undefined` while the fetch is in flight, `null` once it is a dead URL.
  const [funnel, setFunnel] = useState<PublicFunnel | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [optedIn, setOptedIn] = useState(false);

  const retry = useCallback(() => setReloadKey((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setFunnel(undefined);
    setLoadError(null);
    api
      .publicFunnel(slug)
      .then((result) => {
        if (!cancelled) setFunnel(result);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // An unpublished funnel 404s exactly like one that never existed; both
        // are simply a dead URL to a visitor. Anything else is our fault and
        // deserves a retry rather than a "not found".
        if (err instanceof ApiError && err.status === 404) {
          setFunnel(null);
          return;
        }
        setLoadError(
          err instanceof Error && err.message ? err.message : "This page couldn't be loaded.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [slug, reloadKey]);

  const steps = funnel?.steps ?? [];
  const index = resolveStepIndex(steps, stepParam);
  const step: PublicFunnelStep | undefined = steps[index];
  const next: PublicFunnelStep | undefined = steps[index + 1];

  // A view per step per visit. The ref also absorbs StrictMode's development
  // double-mount, which would otherwise report every funnel at twice its
  // traffic.
  const countedRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    if (!step || countedRef.current.has(step.id)) return;
    countedRef.current.add(step.id);
    // Counters are bookkeeping: a failed bump must never reach the visitor.
    void api.funnelStepEvent(step.id, "view").catch(() => undefined);
  }, [step]);

  // Arriving at a new step re-arms the opt-in — one funnel can ask twice.
  useEffect(() => setOptedIn(false), [index]);

  const convert = useCallback(() => {
    if (!step) return;
    void api.funnelStepEvent(step.id, "convert").catch(() => undefined);
  }, [step]);

  if (loadError) {
    return (
      <Section
        surface="deep"
        space="xl"
        aurora="violet"
        auroraIntensity={0.55}
        seam={false}
        aria-label="Page unavailable"
        containerClassName="flex min-h-[40vh] flex-col items-center justify-center text-center"
      >
        <GoldRule className="mx-auto" />
        <h1 className="mt-6 text-balance font-display text-[1.6rem] font-medium leading-tight text-white sm:text-[2rem]">
          This page didn't load.
        </h1>
        <p role="alert" className="copy-luxe mx-auto mt-4 max-w-[46ch] text-pretty">
          {loadError} The link is fine — try again, or email {contactPage.email} and I'll take it
          from there.
        </p>
        <LuxeButton variant="foil" size="md" onClick={retry} className="mt-7 min-h-[44px]">
          Try again
        </LuxeButton>
      </Section>
    );
  }

  if (funnel === undefined) {
    return (
      <Section
        surface="deep"
        space="xl"
        aurora="violet"
        auroraIntensity={0.55}
        seam={false}
        aria-label="Loading"
        containerClassName="flex min-h-[40vh] flex-col items-center justify-center text-center"
      >
        <GoldRule className="mx-auto" />
        <p role="status" className="copy-luxe mt-6">
          Loading…
        </p>
      </Section>
    );
  }

  // A funnel with no steps has nothing to show a visitor, so it is a dead URL
  // in exactly the way an unpublished one is.
  if (funnel === null || !step) {
    return <NotFound />;
  }

  const headline = step.headline || step.name;
  const ctaLabel = step.ctaLabel || "Continue";
  const external = /^https?:\/\//i.test(step.ctaUrl);

  return (
    <>
      <Seo title={`${headline} | ${funnel.name}`} description={funnel.description || undefined} />

      <LuxePageHero
        eyebrow={funnel.name}
        title={headline}
        lede={index === 0 ? funnel.description || undefined : undefined}
        tone="violet"
        align="center"
      />

      <Section surface="base" space="md" aria-label={headline} containerClassName="max-w-2xl">
        {steps.length > 1 && (
          <div className="mb-8 flex items-center justify-center gap-3">
            <span className="text-[0.68rem] font-bold uppercase tracking-[0.18em] text-orchid-dim">
              Step {index + 1} of {steps.length}
            </span>
            <span aria-hidden className="flex items-center gap-1.5">
              {steps.map((s, i) => (
                <span
                  key={s.id}
                  className={cn(
                    "h-1.5 rounded-full transition-all duration-500",
                    i === index ? "w-6 bg-gold" : "w-1.5 bg-white/20",
                  )}
                />
              ))}
            </span>
          </div>
        )}

        <motion.div
          // Keyed on the step so moving through the funnel replays the
          // entrance instead of swapping copy inside a static card.
          key={step.id}
          initial={reduce ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE }}
        >
          <GlassCard accent="gold" interactive={false} className="p-6 sm:p-8">
            {step.bodyMd && (
              // Admin-authored Markdown, so the column is proofed the same way
              // the blog body is: words break rather than widen the page.
              <div className="prose-boss break-words [&_table]:block [&_table]:overflow-x-auto">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{step.bodyMd}</ReactMarkdown>
              </div>
            )}

            {step.stepType === "opt_in" ? (
              <div className={cn("flex flex-col items-center gap-4", step.bodyMd && "mt-8")}>
                {/* The site's one subscribe control rather than a second
                    implementation of it: the address lands in Subscribers and
                    fires the same welcome mail it does everywhere else. */}
                <SubscribeForm
                  source={`funnel:${funnel.slug}`}
                  dark
                  placeholder="Your email address"
                  onSuccess={() => {
                    convert();
                    setOptedIn(true);
                  }}
                />
                {optedIn && next && (
                  <LuxeButton
                    variant="foil"
                    size="md"
                    to={stepPath(funnel.slug, next, index + 1)}
                    className="min-h-[44px]"
                  >
                    {ctaLabel}
                  </LuxeButton>
                )}
              </div>
            ) : (
              <div className={cn("flex justify-center", step.bodyMd && "mt-8")}>
                {step.ctaUrl ? (
                  external ? (
                    <LuxeButton
                      variant="foil"
                      size="md"
                      href={step.ctaUrl}
                      target="_blank"
                      rel="noreferrer"
                      onClick={convert}
                      className="min-h-[44px]"
                    >
                      {ctaLabel}
                    </LuxeButton>
                  ) : (
                    <LuxeButton
                      variant="foil"
                      size="md"
                      to={step.ctaUrl}
                      onClick={convert}
                      className="min-h-[44px]"
                    >
                      {ctaLabel}
                    </LuxeButton>
                  )
                ) : (
                  next && (
                    <LuxeButton
                      variant="foil"
                      size="md"
                      to={stepPath(funnel.slug, next, index + 1)}
                      onClick={convert}
                      className="min-h-[44px]"
                    >
                      {ctaLabel}
                    </LuxeButton>
                  )
                )}
              </div>
            )}
          </GlassCard>
        </motion.div>
      </Section>
    </>
  );
}
