import { motion } from "motion/react";
import { Container } from "@/components/ui/Container";

export function PainPoints() {
  return (
    <section className="bg-dark py-20 text-center sm:py-28 lg:py-32" aria-label="Who this is for">
      <Container>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="mx-auto max-w-3xl"
        >
          <span className="eyebrow !text-white/40">This is a keep it real zone.</span>
          <p className="text-balance font-display text-3xl font-bold leading-[1.15] text-white sm:text-5xl md:text-[3.4rem]">
            You built your practice to create freedom.
          </p>
          <p className="mt-2 text-balance font-display text-3xl font-bold italic leading-[1.15] text-gold sm:text-5xl md:text-[3.4rem]">
            So why does it still feel like you work for someone else?
          </p>
          <p className="mx-auto mt-8 max-w-xl text-balance text-base font-light leading-relaxed text-lilac/85">
            Platforms take their cut. Insurance dictates your rates. You're the clinician, the
            marketer, the admin, and the CEO — all at once. And nobody taught you how to do any
            of that.
          </p>
          <p className="mx-auto mt-5 max-w-lg text-balance text-sm leading-relaxed text-white/45">
            Whether you're just getting started, completely maxed out, or running a team that's
            running you — the answer is the same: structure, strategy, and the right community.
          </p>
        </motion.div>
      </Container>
    </section>
  );
}
