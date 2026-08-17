import { Fragment } from "react";
import { Seo } from "@/components/Seo";
import { Hero } from "@/components/resource-hub/Hero";
import { SortPills } from "@/components/resource-hub/SortPills";
import { AvatarSection } from "@/components/resource-hub/AvatarSection";
import { IncomeCalculator } from "@/components/resource-hub/IncomeCalculator";
import { AboutStrategist } from "@/components/resource-hub/AboutStrategist";
import { FinalCTA } from "@/components/resource-hub/FinalCTA";
import { avatarSections } from "@/content/resourceHub";
import { useHashScroll } from "@/hooks/useHashScroll";

/**
 * Elevation and light for each avatar band.
 *
 * The page owns the alternation rather than the content file, because it is the
 * only place that knows the calculator sits between bands one and two. Read top
 * to bottom the whole route runs deep → base → raised → deep → base → raised →
 * base → deep: no two consecutive sections share an elevation, which is what
 * gives a single-hue dark page its rhythm.
 */
const BAND = [
  { surface: "raised", aurora: "green" },
  { surface: "base", aurora: "plum" },
  { surface: "raised", aurora: "violet" },
] as const;

export default function ResourceHub() {
  // react-router-dom does not scroll to hash fragments on its own.
  useHashScroll();

  return (
    <>
      <Seo
        title="Resource Hub"
        description="Tools, guides, planners, and quizzes for therapists and clinicians at every stage of private practice. Find your section and take your next step with Boss Clinician."
      />
      <Hero />
      <SortPills />
      {avatarSections.map((section, index) => {
        const band = BAND[index % BAND.length];

        return (
          <Fragment key={section.id}>
            <AvatarSection section={section} surface={band.surface} aurora={band.aurora} />
            {/* The income calculator breaks up the first two avatar sections. */}
            {index === 0 && <IncomeCalculator />}
          </Fragment>
        );
      })}
      <AboutStrategist />
      <FinalCTA />
    </>
  );
}
