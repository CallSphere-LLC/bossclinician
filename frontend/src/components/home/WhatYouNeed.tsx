import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import { RevealGroup, RevealItem } from "@/components/ui/Reveal";

const items = [
  {
    num: "01",
    title: "A community that actually gets it.",
    body: "Private practice is isolating by design — and that isolation keeps clinicians stuck. You need a room full of people who understand the billing, the burnout, the platforms, and the vision — building right alongside you.",
  },
  {
    num: "02",
    title: "A strategy built for your specific stage.",
    body: "There's no one-size-fits-all path. Whether you're building your foundation, scaling past the income ceiling, or leading a growing team — the strategy has to match where you actually are. Specific strategy gets you moving.",
  },
  {
    num: "03",
    title: "The tools to actually implement it.",
    body: "Strategy without implementation is just a good idea you never acted on. Boss Clinician delivers live coaching, done-for-you resources, monthly growth kits, and a mastermind for group practice owners — so the work gets done.",
  },
];

export function WhatYouNeed() {
  return (
    <section className="bg-white py-16 sm:py-24 lg:py-28">
      <Container>
        <div className="mx-auto mb-14 max-w-xl text-center sm:mb-16">
          <span className="eyebrow">What It Takes to Build a Practice That Lasts</span>
          <h2 className="text-balance font-display text-3xl font-bold leading-[1.2] text-ink sm:text-4xl md:text-5xl">
            You need three things — and they're all here.
          </h2>
          <div className="mx-auto mt-8 h-[3px] w-14 bg-gold" aria-hidden />
        </div>

        <RevealGroup className="grid gap-9 lg:grid-cols-3">
          {items.map((item) => (
            <RevealItem key={item.num} className="border-t-2 border-lilac-soft pt-6">
              <div className="font-display text-6xl font-bold leading-none text-lilac-soft">
                {item.num}
              </div>
              <h3 className="mt-3 font-display text-2xl font-bold leading-tight text-ink">
                {item.title}
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-ink-soft">{item.body}</p>
            </RevealItem>
          ))}
        </RevealGroup>

        <div className="mt-14 text-center">
          <Button to="/work-with-me" variant="gold" size="lg">
            Find Your Path
          </Button>
        </div>
      </Container>
    </section>
  );
}
