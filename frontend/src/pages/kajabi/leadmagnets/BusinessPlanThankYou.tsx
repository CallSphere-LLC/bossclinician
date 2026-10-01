import { MasterclassSignup } from "@/components/masterclass/MasterclassSignup";
import { Section, SectionTitle } from "@/components/luxe/Section";
import { FREEBIE_FILES, businessPlanThankYou as c } from "@/content/leadMagnets";
import { GuideThankYou } from "./GuideThankYou";
import { FramedImage, Rise, SignupCard } from "./parts";

/**
 * /business-plan-ty — where the Business Plan guide sign-up lands.
 *
 * Her page closes with a registration for the free training — the 4-step
 * blueprint, which is the Freedom Masterclass. Her Kajabi form there asked the
 * masterclass sign-up's questions, so it is the masterclass sign-up here too:
 * the `freedom-masterclass` form, then /watch-now.
 */
export default function BusinessPlanThankYou() {
  return (
    <GuideThankYou content={c} download={FREEBIE_FILES.businessPlan}>
      <Section surface="deep" space="lg" aurora="plum" auroraIntensity={0.6} aria-label="Free training" containerClassName="max-w-5xl">
        <SectionTitle align="center" title={c.training.title} titleClassName="text-[1.5rem] sm:text-[1.9rem] lg:text-[2.2rem]" />
        <div className="mt-10 grid items-center gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:gap-14">
          <Rise>
            <FramedImage image={c.training.image} />
          </Rise>
          <Rise delay={0.1} className="min-w-0">
            <SignupCard title={c.training.register}>
              <MasterclassSignup />
              <p className="mt-5 text-pretty text-center text-xs leading-relaxed text-orchid-faint">{c.training.consent}</p>
            </SignupCard>
          </Rise>
        </div>
      </Section>
    </GuideThankYou>
  );
}
