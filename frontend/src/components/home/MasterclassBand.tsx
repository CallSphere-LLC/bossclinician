import { motion } from "motion/react";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";

export function MasterclassBand() {
  return (
    <section className="bg-plum py-20 text-center sm:py-24 lg:py-28" aria-label="Free masterclass">
      <Container>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.6 }}
          className="mx-auto max-w-2xl"
        >
          <span className="eyebrow !text-lilac-tint/80">Free Masterclass</span>
          <h2 className="text-balance font-display text-3xl font-bold leading-[1.15] text-white sm:text-5xl">
            How to Work Less, Earn More, and Finally Feel Free in Your Own Therapy Practice
          </h2>
          <p className="mx-auto mt-4 max-w-md text-balance font-display text-xl italic text-lilac-tint/85">
            Without adding more clients, more hours, or more hustle.
          </p>
          <p className="mx-auto mt-6 max-w-md text-balance text-sm leading-relaxed text-white/70">
            Learn the step-by-step framework to start, grow, or scale your private practice —
            without guessing, without platforms, and without another 60-hour week. Masterclass
            Guide included.
          </p>
          {/* TODO: point to /masterclass once a dedicated masterclass route exists */}
          <Button to="/resources" variant="gold" size="lg" className="mt-9">
            Watch for Free
          </Button>

          <div className="mt-11 inline-flex flex-col items-start gap-4 rounded-[2px] border border-white/10 bg-white/[0.06] px-6 py-4 text-left sm:flex-row sm:items-center">
            <span className="text-sm leading-relaxed text-white/65">
              <strong className="block text-white">Also Free: The Practice Reset Planner</strong>
              30 days to work less, earn more, and rebuild your practice your way.
            </span>
            {/* TODO: point to /practice-reset-planner once that route exists */}
            <Button to="/resources" variant="outline-light" size="sm" className="shrink-0">
              Download
            </Button>
          </div>
        </motion.div>
      </Container>
    </section>
  );
}
