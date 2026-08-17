import { motion } from "motion/react";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";

const paragraphs = [
  "I'm Yvette Howard, LCSW — and my story didn't start in a coaching program. It started in a dialysis clinic, watching patients sit hooked up to machines for hours — alone, scared, and emotionally drained — while no one tended to the part of them that hurt the most. They were treated, but they weren't seen.",
  "What struck me most was what those patients kept telling me: they didn't want to see a therapist. Not because they didn't need support — they desperately did — but because they didn't believe a therapist would ever truly understand what it meant to live with a serious medical condition. That gap between what they needed and what they trusted enough to access became the foundation of my clinical identity.",
  "In 2018 I started building my private practice while still working at the clinic — serving clients who looked like my dialysis patients, people navigating the emotional weight of chronic illness who had been underserved by traditional mental health care. By the time I found out I was pregnant in 2019, I had 15 to 20 clients of my own and enough momentum to make the leap. So I left the clinic and went full-time.",
  "As my practice grew, so did I. My niche evolved from medically complex clients to something even closer to my own lived experience — BIPOC women struggling with self-esteem and relationship issues. Women who had been told their struggles weren't serious enough, or who had never seen themselves reflected in the therapist sitting across from them. That became my work. That became my people.",
  "I pushed to see 25 to 30 clients a week thinking that's what building a real practice required — and burned out. I tried Talkspace thinking it would help, and instead found myself managing 80 to 100 clients a week, waking up to messages I had to answer in a set window, never fully sure if someone was in crisis. Then I tried Alma for my growing group practice and got more insurance clients instead of the cash pay referrals they promised. I left both.",
  "What I built instead is a multi-six-figure group practice — on my own terms, with a W2 team, an admin staff, and the freedom to work three days a week. And eventually, Boss Clinician — the community, strategy, and mastermind I wish I'd had from day one.",
];

const creds = ["LCSW", "Group Practice Owner", "Doctoral Candidate", "Private Practice Strategist"];

export function MeetYvette() {
  return (
    <section className="bg-white py-16 sm:py-24 lg:py-28" aria-label="About Yvette Howard">
      <Container className="grid items-center gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16">
        <motion.div
          initial={{ opacity: 0, x: -24 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        >
          <span className="eyebrow">Meet Your Strategist</span>
          <h2 className="text-balance font-display text-3xl font-bold leading-[1.2] text-ink sm:text-4xl">
            My clients told me they didn't trust therapists. So I became one they could.
          </h2>
          <div className="mt-7 h-[3px] w-14 bg-gold" aria-hidden />

          <div className="mt-7 space-y-4 text-sm leading-[1.8] text-ink-soft sm:text-[0.97rem]">
            {paragraphs.map((p) => (
              <p key={p.slice(0, 24)}>{p}</p>
            ))}
            <p className="italic text-ink-soft/80">
              When I'm not mentoring clinicians or leading my team, you'll find me sipping iced
              chai, dancing with my son in the kitchen, or planning my next retreat.
            </p>
          </div>

          <div className="mt-8 flex flex-wrap gap-2">
            {creds.map((c) => (
              <span
                key={c}
                className="rounded-full bg-lilac-tint px-3.5 py-1.5 text-[0.72rem] font-semibold uppercase tracking-wide text-plum"
              >
                {c}
              </span>
            ))}
          </div>

          <Button to="/about" variant="secondary" className="mt-9">
            Read My Full Story
          </Button>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
          className="relative mx-auto w-full max-w-sm overflow-hidden lg:max-w-none"
        >
          <div className="relative aspect-[4/5] overflow-hidden">
            <img
              src="/images/yvette-meet-portrait.jpg"
              alt="Yvette Howard, LCSW — Private Practice Strategist and founder of Boss Clinician"
              className="h-full w-full object-cover"
            />
            <div
              aria-hidden
              className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-dark/25 to-transparent"
            />
          </div>
        </motion.div>
      </Container>
    </section>
  );
}
