import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import { Link } from "react-router";

export function FinalCTA() {
  return (
    <section
      className="relative overflow-hidden bg-dark py-24 text-center sm:py-32 lg:py-40"
      aria-label="Final call to action"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(107,91,158,0.25)_0%,transparent_70%)]"
      />
      <Container className="relative mx-auto max-w-2xl">
        <span className="eyebrow !text-lilac/60">
          Ready to build a practice that's actually yours?
        </span>
        <p className="text-balance font-display text-5xl font-bold leading-[1.05] text-white sm:text-7xl">
          Own your practice.
        </p>
        <p className="mb-11 mt-1 text-balance font-display text-5xl font-bold italic leading-[1.05] text-gold sm:text-7xl">
          Build your legacy.
        </p>
        <p className="mx-auto max-w-md text-balance text-base leading-relaxed text-lilac/80">
          Whether you're just starting, fully booked, or building a team — your next step
          starts with finding the right community.
        </p>
        <div className="mt-11 flex flex-wrap items-center justify-center gap-4">
          <Button to="/work-with-me" variant="gold" size="lg">
            Find Your Path
          </Button>
          {/* TODO: point to /boss-clinician-boardroom once that route exists */}
          <Button to="/work-with-me" variant="outline-light" size="lg">
            Apply for the Boardroom
          </Button>
        </div>
        <p className="mt-7 text-sm text-lilac/50">
          Or start with the free masterclass:{" "}
          {/* TODO: point to /masterclass once that route exists */}
          <Link to="/resources" className="text-lilac/75 underline underline-offset-2">
            Watch now →
          </Link>
        </p>
      </Container>
    </section>
  );
}
