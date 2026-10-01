import { LEAD_MAGNET_FORMS, kickstartGuide } from "@/content/leadMagnets";
import { GuideLanding } from "./GuideLanding";

/**
 * /kickstartguide — the free Private Practice Kickstart guide. Signing up files
 * a reply on the `kickstartguide` form and lands on
 * /step-by-step-guide-thank-you-page, as her Kajabi form did.
 */
export default function KickstartGuide() {
  return (
    <GuideLanding
      content={kickstartGuide}
      formSlug={LEAD_MAGNET_FORMS.kickstart}
      next="/step-by-step-guide-thank-you-page"
      mockup={kickstartGuide.mockup}
    />
  );
}
