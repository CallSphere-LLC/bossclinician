import { Seo } from "@/components/Seo";
import { useCollection } from "@/hooks/useCollection";
import { ssrKeys } from "@/ssr/keys";
import { api } from "@/lib/api";
import { testimonials as fallbackTestimonials } from "@/content/testimonials";

import { LuxeHero } from "@/components/home/luxe/LuxeHero";
import { LuxeCredBar } from "@/components/home/luxe/LuxeCredBar";
import { LuxeThreeThings } from "@/components/home/luxe/LuxeThreeThings";
import { LuxeKeepItReal } from "@/components/home/luxe/LuxeKeepItReal";
import { LuxeOffers } from "@/components/home/luxe/LuxeOffers";
import { LuxeMeetYvette } from "@/components/home/luxe/LuxeMeetYvette";
import { LuxeMasterclass } from "@/components/home/luxe/LuxeMasterclass";
import { LuxeQuiz } from "@/components/home/luxe/LuxeQuiz";
import { LuxeTestimonials } from "@/components/home/luxe/LuxeTestimonials";
import { LuxeBlogTeaser } from "@/components/home/luxe/LuxeBlogTeaser";
import { LuxeInstagram } from "@/components/home/luxe/LuxeInstagram";
import { LuxeFinalCTA } from "@/components/home/luxe/LuxeFinalCTA";

/**
 * Home — the Obsidian Luxe rebuild.
 *
 * Section order mirrors bossclinician.com exactly, so the migrated page makes
 * the same argument in the same sequence. Surfaces alternate base → deep →
 * raised down the page: consecutive sections never share an elevation, which is
 * what gives a single-hue dark page its rhythm.
 */
export default function Home() {
  const { data: testimonials } = useCollection(api.testimonials, fallbackTestimonials, ssrKeys.testimonials());

  return (
    <>
      <Seo
        title="Build a Private Practice You Can Actually Stay In | Boss Clinician"
        description="Boss Clinician helps therapists at every stage of practice ownership: build the foundation, make your practice sustainable, and lead beyond yourself. Build it. Sustain it. Lead it. Leave it on your terms."
      />
      <LuxeHero />
      <LuxeCredBar />
      <LuxeThreeThings />
      <LuxeKeepItReal />
      <LuxeOffers />
      <LuxeMeetYvette />
      <LuxeMasterclass />
      <LuxeQuiz />
      <LuxeTestimonials testimonials={testimonials.filter((t) => t.published)} />
      <LuxeBlogTeaser />
      <LuxeInstagram />
      <LuxeFinalCTA />
    </>
  );
}
