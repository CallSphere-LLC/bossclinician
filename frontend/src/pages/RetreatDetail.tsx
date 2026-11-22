import { useParams } from "react-router";
import { Seo } from "@/components/Seo";
import { usePageData } from "@/hooks/usePageData";
import { retreatsPublicApi, type PublicRetreat } from "@/lib/retreatsPublicApi";
import {
  formatRetreatDates,
  RETREAT_INTEREST_PATH,
  UPCOMING_RETREATS_PATH,
} from "@/content/retreatInterest";
import NotFound from "@/pages/NotFound";
import "./retreats.css";

/**
 * /retreats/<destination-year> — a listed retreat's own address (Yvette's
 * item 6: "give future individual retreats their own destination-and-year
 * URLs"). The slug is the retreat record's (e.g. "bali-2027").
 *
 * Bali has its full sales page, so /retreats/bali-2027 is its own static route
 * to that page (App.tsx) and never reaches this one. A future retreat that is
 * listed but has no dedicated page yet shows its announcement here: title,
 * place, dates, the owner's summary and, when set, the link to its booking
 * page. Unlisted slugs are a 404.
 *
 * Client-rendered: nginx does not route /retreats/<x> to the server renderer.
 */
export default function RetreatDetail() {
  const { slug = "" } = useParams();
  const state = usePageData<PublicRetreat>(`retreats:detail:${slug}`, () => retreatsPublicApi.bySlug(slug));

  if (state.status === "missing") return <NotFound />;
  if (state.status !== "ready") {
    return (
      <div className="retreat-page">
        <Seo title="FlourisHealer Retreats" noindex />
        <section className="retreat-hero retreat-hero-compact">
          <div className="retreat-container">
            <p className="retreat-eyebrow">FLOURISHEALER RETREATS</p>
            {state.status === "error" && (
              <p>
                We couldn’t load this retreat just now.{" "}
                <a className="retreat-text-link" href={UPCOMING_RETREATS_PATH}>
                  See upcoming retreats
                </a>
              </p>
            )}
          </div>
        </section>
      </div>
    );
  }

  const retreat = state.data;
  const dates = formatRetreatDates(retreat.startDate, retreat.endDate);
  const ownPath = `/retreats/${retreat.slug}`;
  const bookingHref = retreat.href !== ownPath && retreat.href !== UPCOMING_RETREATS_PATH ? retreat.href : null;
  const interestHref = `${RETREAT_INTEREST_PATH}?retreat=${encodeURIComponent(retreat.slug)}`;

  return (
    <div className="retreat-page">
      <Seo
        title={`${retreat.title} | FlourisHealer Retreats`}
        description={retreat.summary || `${retreat.title}${retreat.location ? `, ${retreat.location}` : ""}${dates ? `, ${dates}` : ""}.`}
        canonicalPath={ownPath}
        image={retreat.image || undefined}
        noindex={!retreat.upcoming}
      />
      <section className="retreat-hero">
        {retreat.image && <img src={retreat.image} alt="" />}
        <div className="retreat-container retreat-hero-copy">
          <p className="retreat-eyebrow">FLOURISHEALER RETREATS</p>
          <h1>{retreat.title}</h1>
          {retreat.summary && <p className="retreat-hero-lede">{retreat.summary}</p>}
          {(dates || retreat.location) && (
            <p className="retreat-strip retreat-dates">
              {[dates, retreat.location].filter(Boolean).join(" • ")}
            </p>
          )}
          {retreat.upcoming ? (
            <div className="retreat-actions">
              {bookingHref && (
                <a className="retreat-button" href={bookingHref}>
                  Explore the Retreat
                </a>
              )}
              <a className={bookingHref ? "retreat-button retreat-button-outline" : "retreat-button"} href={interestHref}>
                Sign Up for Retreat Announcements
              </a>
            </div>
          ) : (
            <div className="retreat-narrow retreat-centered">
              <p>This retreat has ended.</p>
              <div className="retreat-actions">
                <a className="retreat-button" href={UPCOMING_RETREATS_PATH}>
                  See Upcoming Retreats
                </a>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
