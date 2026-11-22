import { Section, SectionTitle } from "@/components/luxe/Section";
import { TestimonialVideo } from "@/components/luxe/TestimonialVideo";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { CLUB_JOIN_ROUTE } from "@/content/club";

const copy = {
  club: {
    title: "Want to Hear Why I Built The Club This Way?",
    paragraphs: [
      "I didn’t start private practice feeling completely confident either. I was building while still trying to protect the security of employment, making decisions around insurance and income from fear, and learning what I wish I had understood earlier.",
      "Watch this before deciding whether The Club is right for you.",
    ],
  },
  lounge: {
    title: "I Know What It Feels Like When the Practice Looks Successful From the Outside but Still Asks Too Much of You.",
    paragraphs: [
      "My practice eventually reached its highest revenue — and I still reached a point where I questioned whether I wanted the business at all.",
      "This video explains what changed for me, what I learned, and why I created The Lounge for practice owners who do not want to keep building the same way.",
      "Watch before deciding whether The Lounge is your next step.",
    ],
  },
};

export function ProgramFounderVideo({ program }: { program: "club" | "lounge" }) {
  const text = copy[program];
  const prefix = `/videos/${program}-vsl-approved-v1`;
  return (
    <Section surface="deep" aria-label={text.title} containerClassName="max-w-4xl">
      <SectionTitle title={text.title} />
      <div className="mx-auto my-7 max-w-3xl space-y-4">
        {text.paragraphs.map((paragraph) => <p className="copy-luxe leading-relaxed" key={paragraph}>{paragraph}</p>)}
      </div>
      <TestimonialVideo src720={`${prefix}-720.mp4`} src540={`${prefix}-540.mp4`} poster={`${prefix}-poster.jpg`} title={`Yvette’s introduction to The ${program === "club" ? "Club" : "Lounge"}`} />
      <div className="mt-7 flex flex-wrap justify-center gap-4">
        <LuxeButton variant="foil" {...(program === "club" ? { to: CLUB_JOIN_ROUTE } : { href: "#join" })}>Join The {program === "club" ? "Club" : "Lounge"}</LuxeButton>
        {/* Row 245: the page's free-training next step, replacing the newsletter ask. */}
        {program === "club" && <LuxeButton to="/practicepreptraining">Watch the Free Practice Prep Training</LuxeButton>}
        {program === "lounge" && <LuxeButton to="/freedom-masterclass">Watch the Free Freedom Masterclass</LuxeButton>}
      </div>
    </Section>
  );
}
