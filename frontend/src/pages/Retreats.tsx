import type { ReactNode } from "react";
import { Seo } from "@/components/Seo";
import {
  retreat as r,
  RETREAT_RESERVE_ROUTE,
  RETREAT_QUIZ_URL,
  RETREAT_TRAWICK_URL,
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

export default function Retreats() {
  const { origin } = useHeadContext();
  return (
    <div className="retreat-page">
      <Seo
        title={r.seo.title}
        description={r.seo.description}
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
              url: RETREAT_RESERVE_ROUTE,
            },
          },
        ]}
      />
      <section className="retreat-hero">
        <Photo photo={r.about.photo} eager />
        <div className="retreat-container retreat-hero-copy">
          <p className="retreat-eyebrow">{r.hero.eyebrow}</p>
          <h1>
            {r.hero.title}
            <em>{r.hero.titleAccent}</em>
          </h1>
          <p className="retreat-triad">{r.hero.triad.join(" ")}</p>
          <p className="retreat-eyebrow">{r.hero.ledeA}</p>
          <p className="retreat-hero-lede">{r.hero.ledeB}</p>
          <p className="retreat-strip">{r.hero.strip}</p>
          <div className="retreat-actions">
            <a href="#reserve" className="retreat-button">
              {r.hero.reserveCta}
            </a>
            <a href="#about" className="retreat-button retreat-button-outline">
              {r.hero.discoverCta}
            </a>
          </div>
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
      <Band id="about" light>
        <div className="retreat-split">
          <div>
            <Heading
              eyebrow={r.about.eyebrow}
              title={r.about.title}
              accent={r.about.titleAccent}
            />
            <Copy lines={r.about.body} />
            <blockquote>{r.about.promise}</blockquote>
            <p>{r.about.kept}</p>
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
            src="/images/retreat-founder-thailand.jpg"
            alt="Yvette on a dock in Thailand, headphones and eye mask on, during breathwork"
            loading="lazy"
            decoding="async"
          />
          <Copy lines={r.founder.body} />
          <blockquote>{r.founder.pull}</blockquote>
          <p>{r.founder.close}</p>
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
            eyebrow={r.pattern.eyebrow}
            title={r.pattern.title}
            accent={r.pattern.titleAccent}
          />
          <p>{r.pattern.lead}</p>
          <blockquote>
            <Copy lines={r.pattern.lines} />
          </blockquote>
          <p>{r.pattern.body}</p>
          <blockquote>
            <Copy lines={r.pattern.pull} />
          </blockquote>
          <h3>{r.pattern.cost}</h3>
          <p>{r.pattern.costBody}</p>
          <p>{r.pattern.close}</p>
        </div>
      </Band>
      <Band light>
        <div className="retreat-narrow">
          <h2>The woman who returns.</h2>
          <Copy lines={[r.returns.lead, r.returns.body]} />
          <p className="retreat-eyebrow">{r.returns.caps}</p>
        </div>
      </Band>
      <Band id="imagine">
        <div className="retreat-narrow retreat-centered">
          <Heading eyebrow={r.imagine.eyebrow} title={r.imagine.title} />
          {r.imagine.stanzas.map((lines) => (
            <div className="retreat-stanza" key={lines[0]}>
              <Copy lines={lines} />
            </div>
          ))}
          <blockquote>{r.imagine.closeA}</blockquote>
          <p>{r.imagine.closeB}</p>
          <a href="#reserve" className="retreat-button">
            {r.hero.reserveCta}
          </a>
        </div>
      </Band>
      <Band id="reserve" light>
        <Heading
          eyebrow={r.reserve.eyebrow}
          title={r.reserve.title}
          accent={r.reserve.titleAccent}
        />
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
    </div>
  );
}
