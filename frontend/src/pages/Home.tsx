import { useHashScroll } from "@/hooks/useHashScroll";
import { Seo } from "@/components/Seo";
import { useCollection } from "@/hooks/useCollection";
import { ssrKeys } from "@/ssr/keys";
import { api } from "@/lib/api";
import { testimonials as fallbackTestimonials } from "@/content/testimonials";

import { LuxeHero } from "@/components/home/luxe/LuxeHero";
import { LuxeCredBar } from "@/components/home/luxe/LuxeCredBar";
import { LuxeThreeThings } from "@/components/home/luxe/LuxeThreeThings";
import { HomeOpening, HomeCoreBelief, HomeTrust, HomePictureThis, HomeRetreatFeature } from "@/components/home/luxe/HomeEditorial";
import { LuxeOffers } from "@/components/home/luxe/LuxeOffers";
import { LuxeMeetYvette } from "@/components/home/luxe/LuxeMeetYvette";
import { LuxeQuiz } from "@/components/home/luxe/LuxeQuiz";
import { LuxeTestimonials } from "@/components/home/luxe/LuxeTestimonials";
import { LuxeBlogTeaser } from "@/components/home/luxe/LuxeBlogTeaser";
import { LuxeInstagram } from "@/components/home/luxe/LuxeInstagram";
import { LuxeFinalCTA } from "@/components/home/luxe/LuxeFinalCTA";

/**
 * Home — the Obsidian Luxe rebuild.
 *
 * Section order mirrors bossclinician.com exactly, so the migrated page makes
 * the same argument in the same sequence. Her home page of 15 Oct 2026 dropped
 * the free-masterclass band (the masterclass and the Practice Prep Training
 * are now buttons on the Lounge and Club offer cards), so it is not rendered
 * here either; LuxeMasterclass stays in the tree for when she brings it back. Surfaces alternate base → deep →
 * raised down the page: consecutive sections never share an elevation, which is
 * what gives a single-hue dark page its rhythm.
 */
export default function Home() {
  useHashScroll();
  const { data: testimonials } = useCollection(api.testimonials, fallbackTestimonials, ssrKeys.testimonials());

  return (
    <>
      <Seo
        title="Private Practice Coaching for Therapists | Boss Clinician"
        description="Private practice coaching for therapists from Yvette Howard, LCSW: build a practice that pays you consistently and fits the life you actually have."
      />
      <LuxeHero />
      <HomeOpening />
      <LuxeCredBar />
      <HomeCoreBelief />
      <LuxeThreeThings />
      <LuxeOffers />
      <HomePictureThis />
      <HomeRetreatFeature />
      <LuxeMeetYvette />
      <HomeTrust />
      <LuxeQuiz />
      <LuxeTestimonials testimonials={testimonials.filter((t) => t.published)} />
      <LuxeBlogTeaser />
      <LuxeInstagram />
      <LuxeFinalCTA />
    </>
  );
}
