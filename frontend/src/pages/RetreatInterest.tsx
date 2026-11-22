import { useSearchParams } from "react-router";
import { Seo } from "@/components/Seo";
import { RetreatInterestForm } from "@/components/forms/RetreatInterestForm";
import { retreatInterest as copy } from "@/content/retreatInterest";
import "./retreats.css";

const HERO_PHOTO = {
  src: "/images/retreat-villa-pool.webp",
  width: 1200,
  height: 800,
};

/**
 * /retreat-interest — the reusable announcement sign-up (Yvette's item 6).
 * Linked from /upcoming-retreats and from any future retreat page
 * (`?retreat=<slug>` records which page sent her). It says plainly what a
 * subscriber receives, and the sign-up itself sends no email.
 */
export default function RetreatInterest() {
  const [params] = useSearchParams();
  const retreat = params.get("retreat") ?? undefined;
  return (
    <div className="retreat-page">
      <Seo title={copy.seo.title} description={copy.seo.description} image={HERO_PHOTO.src} />
      <section className="retreat-hero retreat-hero-compact">
        <img src={HERO_PHOTO.src} alt="" width={HERO_PHOTO.width} height={HERO_PHOTO.height} />
        <div className="retreat-container retreat-hero-copy">
          <p className="retreat-eyebrow">{copy.hero.brand}</p>
          <h1>{copy.hero.title}</h1>
          <p className="retreat-hero-lede">{copy.hero.lede}</p>
        </div>
      </section>
      <section className="retreat-band retreat-light">
        <div className="retreat-container retreat-narrow">
          <h2 className="retreat-form-heading">{copy.receiveTitle}</h2>
          <ul>
            {copy.receive.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <RetreatInterestForm retreat={retreat} />
        </div>
      </section>
    </div>
  );
}
