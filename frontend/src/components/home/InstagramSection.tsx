import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import { footer } from "@/content/site";

export function InstagramSection() {
  return (
    <section className="bg-dark py-16 text-center sm:py-20 lg:py-24" aria-label="Instagram feed">
      <Container>
        <span className="eyebrow !text-lilac/60">Follow Along on Instagram</span>
        <h2 className="mb-10 text-balance font-display text-3xl font-bold text-white sm:text-4xl">
          More strategy. Less fluff. Every day.
        </h2>
        <div className="mb-9 grid grid-cols-3 gap-1 lg:grid-cols-6" aria-hidden>
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="flex aspect-square items-center justify-center bg-white/[0.06] font-display text-xs text-white/20"
            >
              Post {i + 1}
            </div>
          ))}
        </div>
        <Button href={footer.instagram} target="_blank" rel="noopener" variant="outline-light">
          Follow {footer.instagramHandle}
        </Button>
      </Container>
    </section>
  );
}
