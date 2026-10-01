import { FREEBIE_FILES, kickstartThankYou } from "@/content/leadMagnets";
import { GuideThankYou } from "./GuideThankYou";

/** /step-by-step-guide-thank-you-page — where the Kickstart guide sign-up lands. */
export default function KickstartThankYou() {
  return <GuideThankYou content={kickstartThankYou} download={FREEBIE_FILES.kickstart} />;
}
