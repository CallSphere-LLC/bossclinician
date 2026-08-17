import { Link } from "react-router-dom";
import { Container } from "@/components/ui/Container";
import { RevealGroup, RevealItem } from "@/components/ui/Reveal";
import { cn } from "@/lib/cn";

interface Offer {
  tag: string;
  tagColor: "green" | "plum" | "ink";
  name: string;
  desc: string;
  forWho: string;
  ctaLabel: string;
  // TODO: swap for a dedicated offer route once it exists
  // (/boss-clinician-club, /boss-clinician-lounge, /boss-clinician-boardroom)
  to: string;
}

const tagBg: Record<Offer["tagColor"], string> = {
  green: "bg-green",
  plum: "bg-plum",
  ink: "bg-ink",
};

const forColor: Record<Offer["tagColor"], string> = {
  green: "text-green",
  plum: "text-plum",
  ink: "text-ink",
};

const ctaBg: Record<Offer["tagColor"], string> = {
  green: "bg-green hover:bg-green/85",
  plum: "bg-plum hover:bg-plum/85",
  ink: "bg-ink hover:bg-ink/85",
};

const offers: Offer[] = [
  {
    tag: "6-Month Coaching Program",
    tagColor: "green",
    name: "Boss Clinician Club",
    desc: "A 6-month coaching program for clinicians building from the ground up. Get the structure, tools, and guided strategy to do it right — without guessing at every step. This is your foundation, your roadmap, and your support system for the first six months.",
    forWho: "For: The Depleted Clinician — just starting or rebuilding",
    ctaLabel: "Learn About the Club",
    to: "/work-with-me",
  },
  {
    tag: "Membership",
    tagColor: "plum",
    name: "Boss Clinician Lounge",
    desc: "For the fully booked clinician who has hit the income ceiling, is exhausted from splitting rates with platforms, and needs a real strategy — not more content — to scale sustainably without working more hours.",
    forWho: "For: The Maxed Out Clinician — established but capped",
    ctaLabel: "Join the Lounge",
    to: "/work-with-me",
  },
  {
    tag: "Mastermind",
    tagColor: "ink",
    name: "Boss Clinician Boardroom",
    desc: "An exclusive mastermind for group practice owners and scaling clinicians ready for peer-level strategy, CEO leadership development, and a room full of people building at the same level — with Yvette guiding the room.",
    forWho: "For: The Stretched Thin Clinician — leading a team or scaling",
    ctaLabel: "Apply for the Boardroom",
    to: "/work-with-me",
  },
];

export function Offers() {
  return (
    <section className="bg-cream py-16 sm:py-24 lg:py-28" aria-label="Coaching programs and mastermind">
      <Container>
        <div className="mx-auto mb-14 max-w-xl text-center sm:mb-16">
          <span className="eyebrow">Find Your Place in the Community</span>
          <h2 className="text-balance font-display text-3xl font-bold leading-[1.2] text-ink sm:text-4xl">
            Wherever you are in your practice — there's a seat at this table.
          </h2>
          <div className="mx-auto mt-8 h-[3px] w-14 bg-gold" aria-hidden />
        </div>

        <RevealGroup className="mx-auto grid max-w-xl gap-7 lg:grid-cols-3 lg:max-w-none">
          {offers.map((offer) => (
            <RevealItem key={offer.name} as="div">
              <article className="flex h-full flex-col overflow-hidden border border-hairline transition-transform duration-200 hover:-translate-y-1 hover:shadow-soft">
                <div
                  className={cn(
                    "px-5 py-3 text-[0.68rem] font-bold uppercase tracking-[0.16em] text-white",
                    tagBg[offer.tagColor],
                  )}
                >
                  {offer.tag}
                </div>
                <div className="flex flex-1 flex-col bg-cream px-6 py-8">
                  <h3 className="font-display text-2xl font-bold leading-tight text-ink">
                    {offer.name}
                  </h3>
                  <p className="mt-3 flex-1 text-sm leading-relaxed text-ink-soft">{offer.desc}</p>
                  <p
                    className={cn(
                      "mt-5 border-t border-hairline pt-4 text-xs font-semibold tracking-wide",
                      forColor[offer.tagColor],
                    )}
                  >
                    {offer.forWho}
                  </p>
                  <Link
                    to={offer.to}
                    className={cn(
                      "mt-6 inline-block rounded-[1px] px-5 py-3 text-center text-xs font-semibold uppercase tracking-[0.1em] text-white transition-opacity hover:opacity-85",
                      ctaBg[offer.tagColor],
                    )}
                  >
                    {offer.ctaLabel}
                  </Link>
                </div>
              </article>
            </RevealItem>
          ))}
        </RevealGroup>

        <div className="mx-auto mt-10 max-w-4xl border-l-[3px] border-plum bg-lilac-tint px-7 py-5 text-sm leading-relaxed text-ink">
          <strong>Not sure which is right for you?</strong> Take the 2-minute quiz:{" "}
          <a
            href="https://www.bossclinician.com/offer-quiz"
            target="_blank"
            rel="noopener"
            className="text-plum underline underline-offset-2"
          >
            Which Boss Clinician Offer Is Right for You?
          </a>
        </div>
      </Container>
    </section>
  );
}
