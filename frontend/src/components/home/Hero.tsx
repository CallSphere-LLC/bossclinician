import { motion } from "motion/react";
import { Button } from "@/components/ui/Button";

export function Hero() {
  return (
    <section
      className="relative overflow-hidden bg-[linear-gradient(135deg,#0F1E3A_0%,#2A1A4A_55%,#1A2A4A_100%)]"
      aria-label="Hero"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-40 -top-40 h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle,rgba(92,69,125,0.25)_0%,transparent_70%)] sm:h-[600px] sm:w-[600px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-24 left-[30%] h-[280px] w-[280px] rounded-full bg-[radial-gradient(circle,rgba(201,164,106,0.1)_0%,transparent_70%)] sm:h-[400px] sm:w-[400px]"
      />

      <div className="grid min-h-0 lg:min-h-[calc(100vh-5rem)] lg:grid-cols-2">
        <div className="relative z-[1] order-2 flex items-center px-5 py-12 sm:px-8 lg:order-1 lg:px-16 lg:py-20 xl:pl-24">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          >
            <span className="eyebrow !text-lilac/90">
              Yvette Howard, LCSW // Private Practice Strategist
            </span>
            <h1 className="mt-4 text-balance text-[2.75rem] font-bold leading-[1.05] text-white sm:text-6xl md:text-[5rem]">
              Own your practice.
              <span className="mt-1 block font-display italic text-gold">
                Build your legacy.
              </span>
            </h1>
            <p className="mt-7 max-w-md text-balance text-base font-light leading-relaxed text-lilac/90 sm:text-lg">
              The community, strategy, and structure therapists and clinicians need to build
              profitable, sustainable private practices — without platforms, without burnout,
              without doing it alone.
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-4">
              <Button to="/work-with-me" variant="gold" size="lg">
                Find Your Path
              </Button>
              {/* TODO: point to /masterclass once a dedicated masterclass route exists */}
              <Button to="/resources" variant="outline-light" size="lg">
                Watch Free Masterclass
              </Button>
            </div>
            <p className="mt-5 text-xs tracking-[0.08em] text-white/35">
              Boss Clinician Club &nbsp;·&nbsp; Boss Clinician Lounge &nbsp;·&nbsp; Boss
              Clinician Boardroom Mastermind
            </p>
            <p className="mt-7 text-[0.7rem] font-bold uppercase tracking-[0.3em] text-gold">
              Lead. Heal. Elevate.
            </p>
          </motion.div>
        </div>

        <div
          className="relative order-1 h-[60vw] max-h-[420px] overflow-hidden sm:max-h-[520px] lg:order-2 lg:h-auto lg:max-h-none"
          aria-hidden="true"
        >
          <div className="absolute inset-0 z-[1] bg-[linear-gradient(to_bottom,#0F1E3A_0%,transparent_30%)] lg:bg-[linear-gradient(to_right,#0F1E3A_0%,transparent_30%)]" />
          <img
            src="/images/yvette-hero-portrait.jpg"
            alt="Yvette Howard, LCSW — Private Practice Strategist and founder of Boss Clinician"
            className="h-full w-full object-cover object-top"
          />
        </div>
      </div>
    </section>
  );
}
