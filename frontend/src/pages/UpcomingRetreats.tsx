import { Seo } from "@/components/Seo";
import { RetreatInterestForm } from "@/components/forms/RetreatInterestForm";
import { usePageData } from "@/hooks/usePageData";
import { retreatsPublicApi, type PublicRetreat } from "@/lib/retreatsPublicApi";
import { ssrKeys } from "@/ssr/keys";
import {
  formatRetreatDates,
  RETREAT_INTEREST_PATH,
  upcomingRetreats as copy,
} from "@/content/retreatInterest";
import "./retreats.css";

/** The hero photo the Bali page already uses (no new imagery). */
const HERO_PHOTO = {
  src: "/images/retreat-villa-aerial.webp",
  width: 1400,
  height: 1050,
};

function RetreatCard({ retreat }: { retreat: PublicRetreat }) {
  const dates = formatRetreatDates(retreat.startDate, retreat.endDate);
  return (
    <article className="retreat-card retreat-listing-card">
      {retreat.image && (
        <img
          className="retreat-inclusion-photo"
          src={retreat.image}
          alt=""
          loading="lazy"
          decoding="async"
        />
      )}
      {retreat.location && <p className="retreat-eyebrow">{retreat.location}</p>}
      <h3>{retreat.title}</h3>
      {dates && <p className="retreat-dates">{dates}</p>}
      {retreat.summary && <p>{retreat.summary}</p>}
      <a className="retreat-button" href={retreat.href}>
        {copy.cardCta}
      </a>
    </article>
  );
}

/**
 * /upcoming-retreats — the permanent "what's next" page (Yvette's item 6), and
 * the destination of the alumni sequence's Email 4 ("Explore upcoming
 * retreats"), so that email never needs editing per trip.
 *
 * Lists every retreat the owner marked "listed publicly" whose end date has not
 * passed (Pacific); a finished retreat drops off by itself. With none listed,
 * the announcement sign-up takes the list's place.
 */
export default function UpcomingRetreats() {
  const state = usePageData<PublicRetreat[]>(ssrKeys.upcomingRetreats(), retreatsPublicApi.upcoming);
  const retreats = state.status === "ready" ? state.data : [];
  const settled = state.status !== "loading";
  const empty = settled && state.status !== "error" && retreats.length === 0;

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

      {retreats.length > 0 && (
        <section className="retreat-band retreat-light" aria-labelledby="upcoming-list">
          <div className="retreat-container">
            <header className="retreat-heading">
              <p className="retreat-eyebrow" id="upcoming-list">
                {copy.listEyebrow}
              </p>
            </header>
            <div className="retreat-listing">
              {retreats.map((retreat) => (
                <RetreatCard key={retreat.slug} retreat={retreat} />
              ))}
            </div>
          </div>
        </section>
      )}

      {state.status === "error" && (
        <section className="retreat-band retreat-light">
          <div className="retreat-container retreat-narrow retreat-centered">
            <p>{copy.error}</p>
            <a className="retreat-button" href={RETREAT_INTEREST_PATH}>
              {copy.more.cta}
            </a>
          </div>
        </section>
      )}

      {empty && (
        <section className="retreat-band retreat-light" id="announcements">
          <div className="retreat-container retreat-narrow">
            <header className="retreat-heading">
              <p className="retreat-eyebrow">{copy.empty.eyebrow}</p>
              <h2>{copy.empty.title}</h2>
            </header>
            <p className="retreat-centered">{copy.empty.body}</p>
            <RetreatInterestForm showUpcomingLink={false} />
          </div>
        </section>
      )}

      {retreats.length > 0 && (
        <section className="retreat-band">
          <div className="retreat-container retreat-narrow retreat-centered">
            <h2>{copy.more.title}</h2>
            <p>{copy.more.body}</p>
            <a className="retreat-button" href={RETREAT_INTEREST_PATH}>
              {copy.more.cta}
            </a>
          </div>
        </section>
      )}
    </div>
  );
}
