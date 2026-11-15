import type { ReactNode } from "react";
import { Section, SectionTitle } from "@/components/luxe/Section";
import { LuxeButton } from "@/components/luxe/LuxeButton";

function Editorial({ heading, children, surface }: {
  heading: string;
  children: ReactNode;
  surface: "base" | "deep" | "raised";
}) {
  return (
    <Section surface={surface} space="lg" aria-label={heading} containerClassName="max-w-4xl">
      <SectionTitle title={heading} />
      <div className="copy-luxe mx-auto mt-8 max-w-2xl space-y-5 text-pretty">{children}</div>
    </Section>
  );
}

function List({ items }: { items: readonly string[] }) {
  return <ul className="list-disc space-y-2 pl-6 marker:text-gold">{items.map((item) => <li key={item}>{item}</li>)}</ul>;
}

export function HomeOpening() {
  return (
    <Editorial heading="You Didn’t Decide to Build a Private Practice Just to Create Another Job You Can’t Step Away From." surface="raised">
      <p>Whether you’re still building the foundation or already running a full practice, the goal was never to work more, carry everything alone, or feel financially anxious every time something changes.</p>
      <p>You didn’t start this journey so you could:</p>
      <List items={[
        "spend years researching and still feel unsure what to do first",
        "build your practice around fear of losing your paycheck or benefits",
        "say yes to every insurance panel or platform because you’re worried about getting clients",
        "spend your evenings doing billing and admin after your last session",
        "check work email from vacation",
        "panic when a few clients discharge",
        "see 25 clients a week just to feel financially okay",
        "wonder whether working for someone else would honestly be easier",
      ]} />
      <p>Not because you are a bad clinician.</p>
      <p>Because being a great clinician and knowing how to build a financially sustainable practice are two completely different skill sets.</p>
      <p>You learned how to care for clients. Nobody taught you how to make the business decisions behind the clinical work.</p>
      <p>Wherever you are in practice ownership, the goal is the same: build a practice that supports your life instead of taking it over.</p>
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
      <LuxeButton href="#offers" variant="foil">Find Your Path</LuxeButton>
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
