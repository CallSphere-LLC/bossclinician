import type { ReactNode } from "react";
import { Section, SectionTitle } from "@/components/luxe/Section";
import { LuxeButton } from "@/components/luxe/LuxeButton";

function Editorial({ heading, aside, children, surface }: {
  heading: string;
  /** A conversational aside set directly beneath the heading. */
  aside?: ReactNode;
  children: ReactNode;
  surface: "base" | "deep" | "raised";
}) {
  return (
    <Section surface={surface} space="lg" aria-label={heading} containerClassName="max-w-4xl">
      <SectionTitle title={heading} body={aside} />
      <div className="copy-luxe mx-auto mt-8 max-w-2xl space-y-5 text-pretty">{children}</div>
    </Section>
  );
}

function List({ items }: { items: readonly string[] }) {
  return <ul className="list-disc space-y-2 pl-6 marker:text-gold">{items.map((item) => <li key={item}>{item}</li>)}</ul>;
}

/**
 * The home page's problem-to-founder introduction, approved in the website
 * handoff of 21 Nov 2026 (sheet row 245). It replaces the earlier "You Didn’t
 * Decide to Build a Private Practice…" opening, which told the same story; the
 * longer personal history stays on the About page.
 */
export function HomeOpening() {
  return (
    <Editorial
      heading="You know how to care for your clients. But who taught you how to build a practice that takes care of you, too?"
      aside={<em className="italic">(And I don’t wanna hear you blaming grad school. 😂)</em>}
      surface="raised"
    >
      <p>Maybe you’re figuring out how to leave your agency job without putting your income at risk. Maybe you own the practice, but taking time off still means worrying about money. Or you’ve hired a team, yet every decision still comes back to you.</p>
      <p>That’s where I come in.</p>
      <p>I’m Yvette Howard, LCSW, owner of Brighter Tomorrow and founder of Boss Clinician. I started my practice while working, built a full caseload, and grew a group practice—then learned that more clients and a bigger team didn’t automatically create more freedom.</p>
      <p>Now I help mental health providers work through those business decisions, with support that fits their stage of practice ownership.</p>
      <LuxeButton href="#offers" variant="foil">Find the Support You Need</LuxeButton>
    </Editorial>
  );
}

export function HomeCoreBelief() {
  return (
    <Editorial heading="More Is Not Always the Answer. Better Decisions Are." surface="deep">
      <p>You may not need:</p>
      <List items={["another directory.", "another insurance panel.", "another certification.", "another income stream.", "another employee.", "another marketing strategy."]} />
      <p>Before you add something new, you need to understand what the practice you already built actually needs.</p>
      <p>Boss Clinician helps you make those decisions based on your numbers, your goals, your values, and the life you actually want.</p>
      <LuxeButton href="#offers" variant="foil">Find the Support You Need</LuxeButton>
    </Editorial>
  );
}

export function HomeTrust() {
  return (
    <Editorial heading="You Won’t Get One-Size-Fits-All Advice Here." surface="base">
      <p>I will not automatically tell you to:</p>
      <List items={["leave insurance", "go cash pay", "raise your rates", "hire clinicians", "start coaching", "launch a course", "run ads", "become an influencer"]} />
      <p>Sometimes those things make sense. Sometimes they do not.</p>
      <p>The work is figuring out what makes sense for your practice.</p>
    </Editorial>
  );
}

/**
 * "Picture this" — sits after the Club / Lounge / Boardroom cards (sheet row
 * 245). Everyday moments the reader is working toward, not a promised result.
 */
export function HomePictureThis() {
  return (
    <Editorial heading="What It Looks Like When the Practice Fits Your Life." surface="deep">
      <p>You keep your own doctor’s appointment, and nobody’s week falls apart. You say yes to the midweek lunch invite before you check your schedule. You close your laptop on Friday with your notes done. Your team answers the insurance question, and you hear about it after.</p>
      <p>That’s not a bigger practice. It’s a better-built one.</p>
    </Editorial>
  );
}

/**
 * A small retreat feature below the business offers — deliberately outside the
 * Build / Sustain / Lead progression, and not part of any membership.
 */
export function HomeRetreatFeature() {
  return (
    <Section surface="base" space="sm" aria-label="FlourisHealer Retreats" containerClassName="max-w-3xl">
      <div className="text-center">
        <span className="eyebrow-luxe">FlourisHealer Retreats</span>
        <p className="copy-luxe mx-auto mt-2 max-w-2xl text-pretty">
          For the woman behind the provider role. Six days in Bali with women in mental health and wellness, with space for rest, connection, and experiences someone else has organized.
        </p>
        <LuxeButton to="/retreats" variant="outline" className="mt-7">Explore FlourisHealer Retreats</LuxeButton>
      </div>
    </Section>
  );
}
