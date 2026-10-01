import { Fragment } from "react";
import { Link } from "react-router";
import { Seo } from "@/components/Seo";
import { RETREAT_THANK_YOU as T } from "@/content/retreatQuiz";
import "../../retreats.css";
import "./retreatQuiz.css";

/**
 * /retreat-thank-you-page — "You're In", the page a FlourisHealer retreat
 * reservation lands on. Rebuilt verbatim from the Kajabi page of the same path
 * (content/retreatQuiz.ts) in the retreat page's palette. The trip agreement
 * (Jotform), Trawick and Instagram links are the source's own; its
 * bossclinician.com links go to this site's pages.
 */

/** Renders `text` with the first occurrence of `link.text` as a link. */
function withLink(text: string, link?: { text: string; href: string }) {
  if (!link) return text;
  const at = text.indexOf(link.text);
  if (at < 0) return text;
  const external = !link.href.startsWith("mailto:");
  return (
    <>
      {text.slice(0, at)}
      <a
        href={link.href}
        className="rq-inline-link"
        {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      >
        {link.text}
      </a>
      {text.slice(at + link.text.length)}
    </>
  );
}

export default function RetreatThankYou() {
  return (
    <>
      <Seo
        title="You're In | FlourisHealer Retreat · Bali 2027"
        description="Your spot in the Release. Restore. Reconnect. retreat is officially reserved."
        canonicalPath="/retreat-thank-you-page"
        noindex
      />
      <div className="retreat-page">
        <section className="retreat-hero">
          <div className="retreat-container">
            <p className="retreat-eyebrow">
              {T.brand}
              {" · "}
              <Link to={T.backHref} className="rq-inline-link" style={{ color: "inherit" }}>
                {T.backLabel}
              </Link>
            </p>
            <p className="retreat-strip">{T.eyebrow}</p>
            <p className="retreat-hero-lede">{T.strip}</p>
            <h1>
              {T.titleLead}
              <em>{T.titleAccent}</em>
            </h1>
            <div className="rq-hero-intro">
              {T.paragraphs.map((p) => (
                <p key={p}>{p}</p>
              ))}
              <p>
                <strong>{withLink(T.inboxNote, T.inboxLink)}</strong>
              </p>
            </div>
          </div>
        </section>

        <section className="retreat-band retreat-light">
          <div className="rq-narrow">
            <header className="retreat-heading">
              <h2>{T.stepsHeading}</h2>
            </header>
            <ol className="rq-steps">
              {T.steps.map((step, i) => (
                <li key={step.title} className="rq-step">
                  <span className="rq-step-number" aria-hidden>
                    {i + 1}
                  </span>
                  <div>
                    <h3>{step.title}</h3>
                    <p>{withLink(step.body, "link" in step ? step.link : undefined)}</p>
                    {"cta" in step && (
                      <a href={step.cta.href} target="_blank" rel="noopener noreferrer" className="retreat-button">
                        {step.cta.label}
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="retreat-band">
          <div className="rq-narrow">
            <header className="retreat-heading">
              <h2>{T.datesHeading}</h2>
            </header>
            <div className="rq-dates">
              {T.dates.map((d) => (
                <div key={d.date} className="rq-date">
                  <strong>{d.date}</strong>
                  <p>{d.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="retreat-band retreat-light">
          <div className="rq-narrow" style={{ textAlign: "center" }}>
            <blockquote>{T.quote}</blockquote>
            <p className="retreat-eyebrow">{T.quoteBy}</p>
            <p style={{ marginTop: "2rem" }}>
              <strong>{T.signName}</strong>
              <br />
              {T.signRole}
            </p>
          </div>
        </section>

        <section className="retreat-band">
          <div className="rq-narrow rq-contact" style={{ textAlign: "center" }}>
            <h2>{T.questions}</h2>
            <p>
              <a href={`mailto:${T.email}`}>{T.email}</a>
              {" · "}
              <a href={T.instagram.href} target="_blank" rel="noopener noreferrer">
                {T.instagram.text}
              </a>
              {" · "}
              <Link to={T.siteHref}>{T.siteLabel}</Link>
            </p>
            <p className="retreat-hero-lede">{T.footer}</p>
            <nav className="rq-legal" aria-label="Retreat policies">
              {T.legal.map((l, i) => (
                <Fragment key={l.href + l.label}>
                  {i > 0 && <span aria-hidden>·</span>}
                  <Link to={l.href}>{l.label}</Link>
                </Fragment>
              ))}
            </nav>
          </div>
        </section>
      </div>
    </>
  );
}
