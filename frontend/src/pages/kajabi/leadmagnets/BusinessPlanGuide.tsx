import { LEAD_MAGNET_FORMS, businessPlanGuide } from "@/content/leadMagnets";
import { GuideLanding } from "./GuideLanding";

/**
 * /business-plan-guide — the free Private Practice Business Plan guide.
 * Signing up files a reply on the `business-plan-guide` form and lands on
 * /business-plan-ty, as her Kajabi form did.
 */
export default function BusinessPlanGuide() {
  return <GuideLanding content={businessPlanGuide} formSlug={LEAD_MAGNET_FORMS.businessPlan} next="/business-plan-ty" />;
}
