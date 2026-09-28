import { useEffect, useRef, type RefObject } from "react";
import { Link } from "react-router";
import { Seo } from "@/components/Seo";
import { BoardroomApplication } from "@/components/boardroom/BoardroomApplication";
import { boardroom as b, type BoardroomPhoto } from "@/content/boardroom";
import { useHashScroll } from "@/hooks/useHashScroll";
import "./boardroom.css";

/**
 * Reveal-on-scroll, her page's one piece of motion, without costing the server
 * render anything.
 *
 * The markup the server sends — and the markup React hydrates — carries only
 * the `br-reveal` marker, which on its own hides nothing. Hiding starts in this
 * effect, and only once three things are true: the browser has an
 * IntersectionObserver, the visitor has not asked for reduced motion, and every
 * block already on screen (or already scrolled past, for a visitor who arrived
 * at #apply) has been marked visible. Only then does the root get the class the
 * stylesheet hides against. So a crawler, a browser with scripts off, an old
 * browser and a reduced-motion visitor all see the whole page, and nobody sees
 * the first screen blink out and fade back in.
 *
 * Plain class toggles rather than React state, deliberately: forty blocks each
 * re-rendering as they scroll into view would be forty renders of a static page
 * for a change that is purely presentational. The elements that carry
 * `br-reveal` never change their own `className`, so React has no reason to
 * write over the classes added here.
 */
function useScrollReveal(root: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const page = root.current;
    if (!page || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const pending: Element[] = [];
    for (const block of page.querySelectorAll(".br-reveal")) {
      const rect = block.getBoundingClientRect();
      if (rect.top < viewportHeight) block.classList.add("br-visible");
      else pending.push(block);
    }
    page.classList.add("br-reveal-armed");

    // Her threshold: a block shows once an eighth of it is on screen.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("br-visible");
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.12 },
    );
    pending.forEach((block) => observer.observe(block));

    return () => {
      observer.disconnect();
      page.classList.remove("br-reveal-armed");
    };
  }, [root]);
}

/**
 * Every photo on the page, at its real pixel size so the browser reserves the
 * box before the file arrives. Only the hero portrait is fetched eagerly; the
 * rest are below the first screen on every layout.
 */
function Photo({ photo, eager = false }: { photo: BoardroomPhoto; eager?: boolean }) {
  return (
    <img
      src={photo.src}
      alt={photo.alt}
      width={photo.width}
      height={photo.height}
      loading={eager ? "eager" : "lazy"}
      fetchPriority={eager ? "high" : undefined}
      decoding="async"
    />
  );
}

/**
 * The Boardroom — the twelve-month mastermind's own page, as Yvette designed it.
 *
 * Until this page existed /boardroom was a redirect to /work-with-me (migration
 * 061, removed by 074) and every "Boardroom" link on the site pointed there or
 * at the generic /apply letter. This is her page, section for section and word
 * for word (content/boardroom.ts), in her palette and her type
 * (boardroom.css), inside the site's own header and footer.
 *
 * What changed in the move, and why:
 *
 *  - Her fixed top bar is gone; the site header does that job. Its three
 *    in-page links survive as a slim sub-bar that sits under the header and,
 *    on wide screens, sticks there — the page is long, and "Apply" should
 *    never be more than a click away.
 *  - Her application was a preview that sent nothing. It now posts to the
 *    `boardroom-application` form (migration 074), so an application becomes a
 *    reply in Forms, a contact, a lead, and an email to the owner.
 *  - Her "The Lounge is your room right now" link went to bossclinician.com;
 *    it goes to this site's own /lounge.
 */
export default function Boardroom() {
  const root = useRef<HTMLDivElement>(null);
  useScrollReveal(root);
  // A link to /boardroom#apply from elsewhere on the site arrives through the
  // router, which does not scroll to fragments on its own.
  useHashScroll();

  return (
    <div ref={root} className="br-page">
      <Seo title={b.seo.title} description={b.seo.description} image={b.seo.image} />

      <nav className="br-subnav" aria-label="The Boardroom">
        {/* Labelled explicitly: below 520px the wordmark is hidden, and a link
            whose only visible content is decorative would have no name. */}
        <a className="br-brand" href="#the-boardroom" aria-label="The Boardroom, top of page">
          <span aria-hidden="true">{b.subnav.mark}</span>
          <strong>{b.subnav.brand}</strong>
        </a>
        <div className="br-subnav-links">
          {b.subnav.links.map((link) => (
            <a key={link.href} href={link.href}>
              {link.label}
            </a>
          ))}
          <a className="br-subnav-cta" href={b.subnav.cta.href}>
            {b.subnav.cta.label}
          </a>
        </div>
      </nav>

      <section id="the-boardroom" className="br-hero">
        <div className="br-hero-copy br-reveal">
          <h1>
            {b.hero.titleLead}
            <br />
            <em>{b.hero.titleAccent}</em>
          </h1>
          <p className="br-hero-tag">{b.hero.tag}</p>
          <p className="br-hero-intro">{b.hero.intro}</p>
          <a className="br-button" href="#apply">
            {b.hero.cta}
          </a>
          <span className="br-seat-note">{b.hero.seatNote}</span>
        </div>
        <div className="br-hero-portrait br-reveal">
          <Photo photo={b.hero.photo} eager />
          <div className="br-portrait-caption">
            <strong>{b.hero.caption.name}</strong>
            <span>{b.hero.caption.role}</span>
          </div>
        </div>
      </section>

      <section className="br-statement br-section br-reveal">
        <p className="br-eyebrow br-gold">{b.statement.eyebrow}</p>
        <h2>
          {b.statement.title}
          <br />
          <em>{b.statement.titleAccent}</em>
        </h2>
        <p>{b.statement.body}</p>
      </section>

      <section className="br-section br-dark">
        <div className="br-split br-reveal">
          <div>
            <p className="br-eyebrow">{b.questions.eyebrow}</p>
            <h2>{b.questions.title}</h2>
            <p className="br-muted">{b.questions.lede}</p>
          </div>
          <div className="br-question-list">
            {b.questions.list.map((question) => (
              <p key={question}>{question}</p>
            ))}
          </div>
        </div>
        <p className="br-center-callout br-reveal">
          {b.questions.callout.lead} <em>{b.questions.callout.accent}</em>
          <br />
          {b.questions.callout.close}
        </p>
      </section>

      <section className="br-section">
        <div className="br-section-heading br-reveal">
          <p className="br-eyebrow br-gold">{b.focus.eyebrow}</p>
          <h2>{b.focus.title}</h2>
        </div>
        <div className="br-focus-grid br-reveal">
          {b.focus.cards.map((card) => (
            <article key={card.number}>
              <span>{card.number}</span>
              <h3>{card.title}</h3>
              <p>{card.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="br-pathways br-section">
        <div className="br-section-heading br-reveal">
          <p className="br-eyebrow br-gold">{b.pathways.eyebrow}</p>
          <h2>{b.pathways.title}</h2>
        </div>
        <div className="br-path-grid br-reveal">
          {b.pathways.paths.map((path) => (
            <article key={path.number}>
              <div className="br-path-number">{path.number}</div>
              <h3>{path.title}</h3>
              <p>{path.body}</p>
              <strong>{path.close}</strong>
            </article>
          ))}
        </div>
      </section>

      <section id="inside" className="br-inside br-section br-dark">
        <div className="br-inside-media br-reveal">
          <Photo photo={b.inside.photo} />
        </div>
        <div className="br-inside-copy br-reveal">
          <p className="br-eyebrow">{b.inside.eyebrow}</p>
          <h2>{b.inside.title}</h2>
          <div className="br-accordion">
            {b.inside.items.map((item, index) => (
              // Native <details>: keyboard, screen readers and find-in-page all
              // work without a line of script, and the first starts open as it
              // did on her page.
              <details key={item.title} open={index === 0}>
                <summary>{item.title}</summary>
                <p>{item.body}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="br-council br-section">
        <div className="br-council-wrap">
          <div className="br-council-mark br-reveal" aria-hidden="true">
            <span>
              {b.council.mark[0]}
              <br />
              {b.council.mark[1]}
            </span>
          </div>
          <div className="br-council-copy br-reveal">
            <p className="br-eyebrow br-gold">{b.council.eyebrow}</p>
            <h2>{b.council.title}</h2>
            <p>{b.council.body}</p>
            <span className="br-council-promise">{b.council.promise}</span>
          </div>
        </div>
      </section>

      <section className="br-story br-section">
        <div className="br-story-photo br-reveal">
          <Photo photo={b.story.photo} />
          <span>
            {b.story.badge.name}
            <br />
            <small>{b.story.badge.role}</small>
          </span>
        </div>
        <div className="br-story-copy br-reveal">
          <p className="br-eyebrow br-gold">{b.story.eyebrow}</p>
          <h2>{b.story.title}</h2>
          <p>{b.story.opening}</p>
          <p>
            {b.story.revenue.lead}
            <strong>{b.story.revenue.figure}</strong>
          </p>
          {b.story.after.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
          <blockquote>{b.story.quote}</blockquote>
        </div>
      </section>

      <section id="fit" className="br-fit br-section">
        <div className="br-fit-card br-reveal">
          <p className="br-eyebrow">{b.fit.eyebrow}</p>
          <h2>{b.fit.title}</h2>
          <ul>
            {b.fit.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="br-lounge-note">
            {b.fit.lounge.lead}
            <Link to={b.fit.lounge.to}>
              <strong>{b.fit.lounge.link}</strong>
            </Link>
          </p>
        </div>
        <div className="br-fit-photo br-reveal">
          <Photo photo={b.fit.photo} />
        </div>
      </section>

      <section className="br-six br-section br-dark">
        <Photo photo={b.six.photo} />
        <div className="br-six-overlay" aria-hidden="true" />
        <div className="br-six-copy br-reveal">
          <p className="br-eyebrow">{b.six.eyebrow}</p>
          <h2>{b.six.title}</h2>
          <p>{b.six.body}</p>
          {/* An ordered list because it is one: the arrows between the steps
              are drawn by the stylesheet, so a screen reader hears three steps
              in order rather than "right arrow" twice. */}
          <ol className="br-process">
            {b.six.process.map((stage) => (
              <li key={stage}>{stage}</li>
            ))}
          </ol>
          <p>{b.six.close}</p>
        </div>
      </section>

      <section className="br-final-cta br-section br-reveal">
        <p className="br-eyebrow br-gold">{b.finalCta.eyebrow}</p>
        <h2>{b.finalCta.title}</h2>
        <p>{b.finalCta.body}</p>
        <a className="br-button br-button-dark" href="#apply">
          {b.finalCta.cta}
        </a>
      </section>

      <section id="apply" className="br-application br-section">
        <div className="br-application-intro br-reveal">
          <p className="br-eyebrow br-gold">{b.application.eyebrow}</p>
          <h2>{b.application.title}</h2>
          {b.application.paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
        {/* The reveal marker sits on a wrapper, not on the form: the form's own
            attributes change as it moves between steps and sends, and nothing
            React re-renders may carry the classes the reveal effect adds. */}
        <div className="br-reveal">
          <BoardroomApplication />
        </div>
      </section>
    </div>
  );
}
