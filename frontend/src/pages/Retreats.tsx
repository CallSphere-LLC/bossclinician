import { useEffect, useState, type ReactNode } from "react";
import { TestimonialVideo } from "@/components/luxe/TestimonialVideo";
import { useHashScroll } from "@/hooks/useHashScroll";
import { Seo } from "@/components/Seo";
import {
  retreat as r,
  RETREAT_RESERVE_ROUTE,
  RETREAT_QUIZ_URL,
  RETREAT_TRAWICK_URL,
  RETREAT_CALL_URL,
  type RetreatPhoto,
} from "@/content/retreats";
import { faqPageNode } from "@/seo/schema";
import { useHeadContext } from "@/ssr/context";
import "./retreats.css";

const inclusionPhotos: Record<string, { src: string; alt: string }> = {
  "01": {
    src: "/images/retreat-inclusion-villa.jpg",
    alt: "The private villa pool at dusk, lined with daybeds and palms",
  },
  "02": {
    src: "/images/retreat-inclusion-dining.jpg",
    alt: "The villa dining area set for a meal",
  },
  "03": {
    src: "/images/retreat-inclusion-wellness.jpg",
    alt: "A flower bath ritual",
  },
  "04": {
    src: "/images/retreat-inclusion-activities.jpg",
    alt: "Balinese swing over rice terraces",
  },
  "05": {
    src: "/images/retreat-inclusion-gift.jpg",
    alt: "FlourisHealer welcome tote bag",
  },
  "06": {
    src: "/images/retreat-inclusion-transfer.jpg",
    alt: "Guests arriving to their luxury airport transfer in Bali",
  },
};

function Heading({
  eyebrow,
  title,
  accent,
}: {
  eyebrow?: string;
  title: string;
  accent?: string;
}) {
  return (
    <header className="retreat-heading">
      {eyebrow && <p className="retreat-eyebrow">{eyebrow}</p>}
      <h2>
        {title}
        {accent && <em>{accent}</em>}
      </h2>
    </header>
  );
}
function Copy({ lines }: { lines: readonly string[] }) {
  return (
    <div className="retreat-copy">
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </div>
  );
}
function Photo({
  photo,
  eager = false,
}: {
  photo: RetreatPhoto;
  eager?: boolean;
}) {
  return (
    <img
      src={photo.src}
      alt={photo.alt}
      width={photo.width}
      height={photo.height}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
    />
  );
}
function Band({
  id,
  light = false,
  children,
  className = "",
}: {
  id?: string;
  light?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={`retreat-band ${light ? "retreat-light" : ""} ${className}`}
    >
      <div className="retreat-container">{children}</div>
    </section>
  );
}
function ReserveLink() {
  return (
    <a className="retreat-button" href={RETREAT_RESERVE_ROUTE}>
      {r.reserve.cta}
    </a>
  );
}

/**
 * Row 256: the owner asked to approve the video section on a preview link
 * before it is published, so it only shows with ?preview=video until then.
 * Decided after mount so the server render and hydration always agree.
 */
const RETREAT_VIDEO_PUBLISHED = false;
function useRetreatVideoVisible() {
  const [visible, setVisible] = useState(RETREAT_VIDEO_PUBLISHED);
  useEffect(() => {
    if (RETREAT_VIDEO_PUBLISHED) return;
    if (new URLSearchParams(window.location.search).get("preview") === "video") setVisible(true);
  }, []);
  return visible;
}
function RetreatVideo() {
  const v = r.video;
  return (
    <Band id="preview-video" className="retreat-video">
      <div className="retreat-narrow">
        <Heading eyebrow={v.eyebrow} title={v.title} />
        <Copy lines={v.body} />
      </div>
      <TestimonialVideo
        className="retreat-video-player"
        src720={`${v.prefix}-720.mp4`}
        src540={`${v.prefix}-540.mp4`}
        poster={`${v.prefix}-poster.jpg`}
        captions={`/videos/captions/retreat-bali-preview-v1.en.vtt`}
        title={v.playerTitle}
      />
      <div className="retreat-actions">
        <a href="#included" className="retreat-button">
          {v.cta}
        </a>
      </div>
    </Band>
  );
}

export default function Retreats() {
  useHashScroll();
  const showVideo = useRetreatVideoVisible();
  const { origin } = useHeadContext();
  return (
    <div className="retreat-page">
      <Seo
        title={r.seo.title}
        description={r.seo.description}
        // Also served at /retreats/bali-2027 (the destination-and-year address,
        // App.tsx); /retreats stays the one indexed address for this page.
        canonicalPath="/retreats"
        image={r.about.photo.src}
        jsonLd={[
          faqPageNode(origin, "/retreats", [...r.faq.questions]),
          {
            "@type": "Event",
            name: "FlourisHealer Retreats",
            startDate: "2027-06-15",
            endDate: "2027-06-20",
            url: `${origin}/retreats`,
            image: `${origin}${r.about.photo.src}`,
            eventStatus: "https://schema.org/EventScheduled",
            eventAttendanceMode:
              "https://schema.org/OfflineEventAttendanceMode",
            location: {
              "@type": "Place",
              name: "Private villa, Ubud",
              address: {
                "@type": "PostalAddress",
                addressLocality: "Ubud",
                addressRegion: "Bali",
                addressCountry: "ID",
              },
            },
            organizer: {
              "@type": "Organization",
              name: "Boss Clinician",
              url: origin,
            },
            maximumAttendeeCapacity: 12,
            offers: {
              "@type": "Offer",
              price: "5500",
              priceCurrency: "USD",
              url: `${origin}${RETREAT_RESERVE_ROUTE}`,
            },
          },
        ]}
      />
      <section className="retreat-hero">
        <Photo photo={r.about.photo} eager />
        <div className="retreat-container retreat-hero-copy">
          <p className="retreat-eyebrow">{r.hero.brand}</p>
          <p className="retreat-triad">{r.hero.tagline}</p>
          <h1>
            {r.hero.title}
            <em>{r.hero.titleAccent}</em>
          </h1>
          <p className="retreat-hero-lede">{r.hero.lede}</p>
          <p className="retreat-strip">{r.hero.when}</p>
          <div className="retreat-actions">
            <a href="#about" className="retreat-button">
              {r.hero.exploreCta}
            </a>
          </div>
          <p className="retreat-hero-question">
            <a
              className="retreat-text-link"
              href={RETREAT_CALL_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              {r.hero.questionsCta}
            </a>
          </p>
        </div>
      </section>
      <div className="retreat-stats" aria-label="Retreat at a glance">
        {r.stats.map((s) => (
          <div key={s.value}>
            <strong>{s.value}</strong>
            <span>{s.lines.join(" ")}</span>
          </div>
        ))}
      </div>
      {showVideo && <RetreatVideo />}
      <Band id="about" light>
        <div className="retreat-split">
          <div>
            <Heading
              eyebrow={r.about.eyebrow}
              title={r.about.title}
              accent={r.about.titleAccent}
            />
            <Copy lines={r.about.body} />
            <blockquote>{r.about.pull}</blockquote>
          </div>
          <Photo photo={r.about.photo} />
        </div>
      </Band>
      <Band>
        <div className="retreat-narrow">
          <Heading
            eyebrow={r.founder.eyebrow}
            title={r.founder.title}
            accent={r.founder.titleAccent}
          />
          <img
            className="retreat-founder-photo"
            src={r.founder.photo.src}
            alt={r.founder.photo.alt}
            width={r.founder.photo.width}
            height={r.founder.photo.height}
            loading="lazy"
            decoding="async"
          />
          <Copy lines={r.founder.body} />
          <blockquote>{r.founder.pull}</blockquote>
          <p>{r.founder.close}</p>
        </div>
      </Band>
      <Band light>
        <div className="retreat-narrow">
          <Heading title="A Vacation Can Still Leave You Responsible for Everything." />
          <p>You may have traveled before. But were you still:</p>
          <ul>
            {["planning the itinerary?", "checking work?", "making reservations?", "answering family questions?", "organizing everyone else?"].map((item) => <li key={item}>{item}</li>)}
          </ul>
          <p>A retreat is different.</p>
          <p>The intention is not simply to change locations.</p>
        </div>
      </Band>
      <Band id="included" light>
        <Heading
          eyebrow={r.included.eyebrow}
          title={r.included.title}
          accent={r.included.titleAccent}
        />
        <div className="retreat-narrow">
          <Copy lines={r.included.body} />
        </div>
        <div className="retreat-inclusions">
          {r.included.items.map((item) => (
            <article className="retreat-card" key={item.number}>
              <img
                className="retreat-inclusion-photo"
                src={inclusionPhotos[item.number].src}
                alt={inclusionPhotos[item.number].alt}
                loading="lazy"
                decoding="async"
              />
              <span className="retreat-number">{item.number}</span>
              <h3>{item.title}</h3>
              {item.number === "03" && (
                <img
                  className="retreat-inclusion-photo"
                  src="/images/retreat-inclusion-temple.jpg"
                  alt="Balinese water temple ceremony"
                  loading="lazy"
                  decoding="async"
                />
              )}
              {item.body && <p>{item.body}</p>}
              {item.groups?.map((group) => (
                <div key={group.label}>
                  <h4>{group.label}</h4>
                  <ul>
                    {group.items.map((detail) => (
                      <li key={detail.name}>
                        <strong>{detail.name}</strong>
                        {detail.body}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </article>
          ))}
        </div>
      </Band>
      <Band>
        <Heading
          eyebrow={r.intimacy.eyebrow}
          title={r.intimacy.title}
          accent={r.intimacy.titleAccent}
        />
        <div className="retreat-columns">
          {r.intimacy.blocks.map((block) => (
            <article key={block.title}>
              <h3>{block.title}</h3>
              <Copy lines={block.body} />
            </article>
          ))}
        </div>
      </Band>
      <section className="retreat-gallery" aria-label="Your private villa">
        {r.gallery.map((photo) => (
          <figure key={photo.src}>
            <Photo photo={photo} />
            <figcaption>{photo.label}</figcaption>
          </figure>
        ))}
      </section>
      <Band light>
        <Heading eyebrow={r.moments.eyebrow} title={r.moments.title} />
        <div className="retreat-moments">
          {r.moments.photos.map((photo) => (
            <figure key={photo.src}>
              <Photo photo={photo} />
              <figcaption>{photo.caption}</figcaption>
            </figure>
          ))}
        </div>
      </Band>
      <Band>
        <div className="retreat-narrow">
          <Heading
            title={r.audience.title}
            accent={r.audience.titleAccent}
          />
          <Copy lines={r.audience.body} />
          {r.audience.objections.map((item) => (
            <div className="retreat-objection" key={item.q}>
              <h3>{item.q}</h3>
              <p>{item.a}</p>
            </div>
          ))}
        </div>
      </Band>
      <Band id="imagine">
        <div className="retreat-narrow retreat-centered">
          <Heading eyebrow={r.imagine.eyebrow} title={r.imagine.title} />
          <Copy lines={r.imagine.body} />
          <a href="#reserve" className="retreat-button">
            {r.hero.reserveCta}
          </a>
        </div>
      </Band>
      <Band>
        <div className="retreat-narrow retreat-centered">
          <Heading title="This Is the First FlourisHealer Bali Retreat." />
          <p>An intimate retreat for 11 guests plus Yvette, for 12 people total.</p>
          <p>Explore the villa and accommodations, activities and inclusions, and pre-trip support. This experience draws on Yvette’s own retreat experience since 2023.</p>
        </div>
      </Band>
      <Band id="reserve" light>
        <Heading eyebrow={r.reserve.eyebrow} title={r.reserve.title} />
        <p className="retreat-narrow retreat-centered">
          {r.reserve.leadA}
          <a
            className="retreat-text-link"
            href={RETREAT_CALL_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            {r.reserve.leadLink}
          </a>
          {r.reserve.leadB}
        </p>
        <p className="retreat-strip">{r.reserve.strip}</p>
        <h3 className="retreat-price">{r.reserve.price}</h3>
        <p className="retreat-centered">{r.reserve.terms}</p>
        <div className="retreat-reservation">
          <p className="retreat-eyebrow">{r.reserve.includedLabel}</p>
          <ul>
            {r.reserve.included.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p>{r.reserve.includedNote}</p>
          <div className="retreat-columns">
            {r.reserve.options.map((option) => (
              <article className="retreat-card" key={option.label}>
                <p className="retreat-eyebrow">{option.label}</p>
                <h3>{option.amount}</h3>
                <p>{option.body}</p>
              </article>
            ))}
          </div>
          <div className="retreat-centered">
            <ReserveLink />
            <p>{r.reserve.ctaNote}</p>
            <p>
              <a className="retreat-text-link" href="/contact">
                Questions about reserving? Contact us
              </a>
            </p>
            <p className="retreat-eyebrow">{r.reserve.scarcity}</p>
          </div>
        </div>
        <p className="retreat-narrow retreat-centered">{r.reserve.insurance}</p>
        <div className="retreat-centered">
          <a
            href={RETREAT_TRAWICK_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="retreat-text-link"
          >
            {r.reserve.insuranceCta}
          </a>
        </div>
      </Band>
      <Band id="host">
        <div className="retreat-split">
          <Photo photo={r.host.photo} />
          <div>
            <Heading
              eyebrow={r.host.eyebrow}
              title={r.host.title}
              accent={r.host.titleAccent}
            />
            <p className="retreat-eyebrow">{r.host.tag}</p>
            <Copy lines={[r.host.bodyA, r.host.bodyB]} />
            <blockquote>
              <Copy lines={r.host.pullA} />
              <p>{r.host.pullB}</p>
              <Copy lines={r.host.pullC} />
            </blockquote>
            <Copy lines={[r.host.bodyC, r.host.bodyD, r.host.bodyE]} />
            <ul>
              {r.host.credentials.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        </div>
      </Band>
      <Band light>
        <div className="retreat-narrow retreat-centered">
          <h2>{r.bali.lineA}</h2>
          <p>{r.bali.lineB}</p>
        </div>
        <div className="retreat-inclusions">
          {r.coverage.map((item) => (
            <article className="retreat-card" key={item.label}>
              <p className="retreat-eyebrow">{item.label}</p>
              <Copy lines={item.lines} />
              {item.cta && (
                <a
                  className="retreat-text-link"
                  href={RETREAT_TRAWICK_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {item.cta}
                </a>
              )}
            </article>
          ))}
        </div>
      </Band>
      <Band>
        <div className="retreat-narrow retreat-centered">
          <Heading
            eyebrow={r.quiz.eyebrow}
            title={r.quiz.title}
            accent={r.quiz.titleAccent}
          />
          <p>{r.quiz.body}</p>
          <a href={RETREAT_QUIZ_URL} className="retreat-button">
            {r.quiz.cta}
          </a>
        </div>
      </Band>
      <Band>
        <div className="retreat-narrow retreat-centered">
          <h2>Have More Questions?</h2>
          <p>Start with the FAQs, or schedule a Retreat Interest Call if you still want to talk it through.</p>
          <div className="flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
            <a className="retreat-button" href="#faq">View FAQs</a>
            <a className="retreat-button" href={RETREAT_CALL_URL} target="_blank" rel="noopener noreferrer">Schedule a Retreat Interest Call</a>
          </div>
        </div>
      </Band>
      <Band light>
        <div className="retreat-narrow">
          <Heading title="Bali Is Calling You, But You Still Have Questions?" />
          <p>Maybe you want to know more about:</p>
          <ul>
            {["traveling alone", "the accommodations", "the payment plan", "what the days will feel like", "who else is attending", "whether this experience is right for you"].map((item) => <li key={item}>{item}</li>)}
          </ul>
          <p>You do not have to figure that out from a website.</p>
          <p>Schedule a complimentary Retreat Interest Call and talk through your questions before reserving.</p>
          <p>No pressure. No presentation. Just a chance to get the clarity you need to make your decision.</p>
          <a className="retreat-button" href={RETREAT_CALL_URL} target="_blank" rel="noopener noreferrer">Schedule a Retreat Interest Call</a>
        </div>
      </Band>
      <Band id="faq" light>
        <Heading
          eyebrow={r.faq.eyebrow}
          title={r.faq.title}
          accent={r.faq.titleAccent}
        />
        <div className="retreat-faq">
          {r.faq.questions.map((faq) => (
            <details key={faq.q}>
              <summary>
                {faq.q}
                <span aria-hidden="true">+</span>
              </summary>
              <p>{faq.a}</p>
              {faq.link && (
                <a className="retreat-text-link" href={faq.link.to}>
                  {faq.link.label}
                </a>
              )}
            </details>
          ))}
        </div>
      </Band>
      <Band>
        <div className="retreat-narrow retreat-centered">
          <p className="retreat-closing">{r.closing.body}</p>
          <a href="#reserve" className="retreat-button">
            {r.closing.cta}
          </a>
        </div>
      </Band>
    </div>
  );
}
