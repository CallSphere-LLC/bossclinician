import type { ReactNode } from "react";
import { Link } from "react-router";
import { Seo } from "@/components/Seo";
// Inlined, not imported: the server render does not link a lazy route's CSS
// chunk, so a plain import would paint the first visit unstyled until the
// script loaded. As a string it ships inside the server HTML.
import pageCss from "./linkInBio.css?inline";

/**
 * /link-in-bio — the Instagram link hub, rebuilt from Yvette's own Kajabi
 * custom-code page rather than reinterpreted in the site's luxe kit.
 *
 * Her page was one self-contained document: a 480px column on navy, gold and
 * purple accents, nine buttons in four groups, four testimonials, a short bio,
 * socials and policies. That is what someone who just tapped her Instagram bio
 * should see, so this page keeps its own palette whatever the site theme is:
 * every colour lives in linkInBio.css under `lib-` classes (no Tailwind colour
 * utilities, no section/header/footer elements), because site-theme.css
 * repaints those by class token and by element in light mode.
 * `data-media-surface` is the site's existing "dark island" hook, kept as a
 * second line of defence.
 *
 * Kajabi opened every button in a new tab because it was linking off to a
 * different site; here they are our own pages, so they navigate in place.
 */

type Variant = "featured" | "audit" | "quiz" | "club" | "lounge" | "boardroom" | "hub" | "assessment" | "about";
type BadgeTone = "gold" | "green" | "purple" | "goldSoft";

interface LinkButton {
  icon: string;
  title: string;
  sub: string;
  to: string;
  variant: Variant;
  badge?: { label: string; tone: BadgeTone };
}

interface LinkGroup {
  label: string;
  links: LinkButton[];
}

const SEO = {
  title: "Boss Clinician Link In Bio",
  description:
    "Private Practice Strategist helping therapists build profitable, sustainable practices. Find your resources, offers, and next step here.",
  image: "/images/link-in-bio/yvette.webp",
};

const AVATAR = { src: "/images/link-in-bio/yvette.webp", alt: "Yvette Howard, LCSW" };
const LOGO = { src: "/images/link-in-bio/boss-clinician-logo.png", alt: "Boss Clinician" };

const CREDENTIALS = ["LCSW", "Group Practice Owner", "Doctoral Candidate"];

const GROUPS: LinkGroup[] = [
  {
    label: "Start Here",
    links: [
      {
        icon: "📋",
        // The live session (Sept 25) is over; the button now opens the on-demand replay.
        title: "Documentation That Protects Your Practice",
        sub: "CE training replay. Watch it on demand.",
        to: "/replay-documentation",
        variant: "featured",
      },
      {
        icon: "🎥",
        title: "Free Masterclass: Create a Private Practice That Supports Your Income, Energy & Future",
        sub: "For established therapists who don't want to see 25 to 30 clients forever. Includes the Practice Freedom Audit.",
        to: "/freedom-masterclass",
        variant: "audit",
      },
      {
        icon: "🧠",
        badge: { label: "Free Quiz", tone: "gold" },
        title: "Is Your Practice Set Up to Pay You, or Just Keep You Busy?",
        sub: "2 minutes. Find out what stage your practice is in and what to focus on next.",
        to: "/practice-quiz",
        variant: "quiz",
      },
    ],
  },
  {
    label: "Work With Me",
    links: [
      {
        icon: "🌱",
        badge: { label: "Build It", tone: "green" },
        title: "Boss Clinician Club",
        sub: "Build a private practice you won't have to undo later. 6-month program for therapists building or rebuilding their private practice foundation.",
        to: "/club",
        variant: "club",
      },
      {
        icon: "💜",
        badge: { label: "Sustain It", tone: "purple" },
        title: "Boss Clinician Lounge",
        sub: "Make the practice you already built work better for the life you actually want. Monthly membership for established therapists ready to create more income, capacity, freedom, and sustainability.",
        to: "/lounge",
        variant: "lounge",
      },
      {
        icon: "👑",
        badge: { label: "Lead It", tone: "goldSoft" },
        title: "Boss Clinician Boardroom",
        sub: "Build a practice that can grow beyond you. Strategic mastermind for group practice owners ready to lead with stronger systems, structure, and less owner dependence.",
        to: "/boardroom",
        variant: "boardroom",
      },
    ],
  },
  {
    label: "Free Resources",
    links: [
      {
        icon: "📚",
        title: "Free Resource Hub",
        sub: "Free resources for every stage of practice: Build It, Sustain It, or Lead It.",
        to: "/resource-hub",
        variant: "hub",
      },
      {
        icon: "📋",
        title: "Free Group Practice Self-Assessment",
        sub: "See where your group practice is still too dependent on you, and what needs strengthening next.",
        to: "/boss-assessment",
        variant: "assessment",
      },
    ],
  },
  {
    label: "About",
    links: [
      {
        icon: "👋🏾",
        title: "My Story",
        sub: "From dialysis social worker to multi-six-figure group practice",
        to: "/about",
        variant: "about",
      },
    ],
  },
];

const TESTIMONIALS: { quote: string; initial: string; tone: "green" | "purple" | "navy"; name: string; practice: string }[] = [
  {
    quote:
      "Yvette helped me launch my private practice while still working full-time. Within weeks I was seeing clients and bringing in consistent extra income. That income gave me the confidence to leave my 9 to 5 and go full-time in my own practice.",
    initial: "K",
    tone: "green",
    name: "Kristan L., LCSW",
    practice: "Intentional Focus Health and Wellness",
  },
  {
    quote:
      "With Yvette's support and guidance I was able to shift into my journey in private practice. She kept me accountable with clear, realistic goals and provided exactly the resources I needed.",
    initial: "R",
    tone: "purple",
    name: "Rosa M., LCSW",
    practice: "Follow Your Path Therapy Services",
  },
  {
    quote:
      "Working with Yvette has been a game changer for my private practice. She supported me through my doubts, provided exactly the resources I needed, and kept me accountable with clear, realistic goals.",
    initial: "M",
    tone: "navy",
    name: "Michael M., LPC",
    practice: "Mike Counseling",
  },
  {
    quote:
      "Once I took the time to set up my business legally and got clear on my pricing and structure, I felt like a true CEO. Everything became easier.",
    initial: "S",
    tone: "purple",
    name: "Sharon S., LPC",
    practice: "Stilwaters Counseling",
  },
];

const ABOUT = {
  name: "Yvette Howard, LCSW",
  role: "Private Practice Strategist · Boss Clinician",
  body: "I started my private practice in 2018 while working in dialysis and took it full-time in 2019. I went on to build a multi-six-figure group practice, and learned firsthand that revenue alone does not create freedom. Today, I help therapists build businesses that support their income, energy, life, and future instead of requiring them to stay maxed out forever.",
};

const SOCIALS = [
  { label: "📷 Instagram", href: "https://instagram.com/bossclinician" },
  { label: "Facebook", href: "https://facebook.com/yvette.hwd" },
  { label: "Threads", href: "https://threads.net/@bossclinician" },
];

const POLICIES = [
  { label: "Privacy Policy", to: "/privacy-policy" },
  { label: "Terms of Use", to: "/terms-of-use" },
  { label: "Financial Disclaimer", to: "/financial-disclaimer" },
  { label: "Disclaimer", to: "/disclaimer" },
];

/** Hairline, label, hairline. A heading for screen readers, a rule for everyone else. */
function Divider({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <div className="lib-divider">
      <span className="lib-divider-line" aria-hidden />
      <h2 className="lib-divider-label" id={id}>
        {children}
      </h2>
      <span className="lib-divider-line" aria-hidden />
    </div>
  );
}

function LinkCard({ link }: { link: LinkButton }) {
  return (
    <li>
      <Link to={link.to} className={`lib-btn lib-btn--${link.variant}`}>
        <span className="lib-btn-icon" aria-hidden>
          {link.icon}
        </span>
        <span className="lib-btn-text">
          {link.badge && <span className={`lib-badge lib-badge--${link.badge.tone}`}>{link.badge.label}</span>}
          <span className="lib-btn-title">{link.title}</span>
          <span className="lib-btn-sub">{link.sub}</span>
        </span>
        <span className="lib-btn-arrow" aria-hidden>
          →
        </span>
      </Link>
    </li>
  );
}

export default function LinkInBio() {
  const year = new Date().getFullYear();

  return (
    <div className="lib-page" data-media-surface>
      <Seo title={SEO.title} description={SEO.description} image={SEO.image} />
      <style dangerouslySetInnerHTML={{ __html: pageCss }} />

      <div className="lib-wrap">
        <div className="lib-profile">
          <div className="lib-avatar">
            <img src={AVATAR.src} alt={AVATAR.alt} width={96} height={96} decoding="async" />
          </div>
          <h1 className="lib-h1">
            Build a private practice <em>you can actually stay in.</em>
          </h1>
          <p className="lib-name">
            Yvette Howard, <em>LCSW</em>
          </p>
          <p className="lib-handle">@bossclinician</p>
          <p className="lib-bio">
            Helping therapists build private practices that support their income, energy, life, and future, without
            requiring them to max themselves out to maintain them.
          </p>
          <ul className="lib-creds" aria-label="Credentials">
            {CREDENTIALS.map((c) => (
              <li key={c} className="lib-cred">
                {c}
              </li>
            ))}
          </ul>
        </div>

        <div className="lib-callout">
          <p className="lib-callout-lead">Build it. Sustain it. Lead it. Leave it on your terms.</p>
          <p>
            Whether you're building your practice, making an established practice more sustainable, or learning to lead
            a growing team, <strong>start with the stage you're in now.</strong>
          </p>
        </div>

        {GROUPS.map((group, i) => (
          <nav key={group.label} aria-labelledby={`lib-group-${i}`}>
            <Divider id={`lib-group-${i}`}>{group.label}</Divider>
            <ul className="lib-links">
              {group.links.map((link) => (
                <LinkCard key={link.to} link={link} />
              ))}
            </ul>
          </nav>
        ))}

        <Divider>What Clinicians Say</Divider>
        <ul className="lib-testimonials">
          {TESTIMONIALS.map((t) => (
            <li key={t.name} className="lib-card lib-testimonial">
              <p className="lib-stars" role="img" aria-label="Five stars">
                ★★★★★
              </p>
              <blockquote className="lib-quote">“{t.quote}”</blockquote>
              <div className="lib-author">
                <span className={`lib-t-avatar lib-t-avatar--${t.tone}`} aria-hidden>
                  {t.initial}
                </span>
                <span>
                  <span className="lib-t-name">{t.name}</span>
                  <span className="lib-t-practice">{t.practice}</span>
                </span>
              </div>
            </li>
          ))}
        </ul>

        <Divider>About Yvette</Divider>
        <div className="lib-card lib-about">
          <p className="lib-about-name">{ABOUT.name}</p>
          <p className="lib-about-role">{ABOUT.role}</p>
          <p className="lib-about-body">{ABOUT.body}</p>
        </div>

        <ul className="lib-social" aria-label="Social media">
          {SOCIALS.map((s) => (
            <li key={s.href}>
              <a href={s.href} target="_blank" rel="noopener noreferrer" className="lib-social-link">
                {s.label}
              </a>
            </li>
          ))}
        </ul>

        <div className="lib-footer">
          <Link to="/" className="lib-logo" aria-label="Boss Clinician home">
            <img src={LOGO.src} alt={LOGO.alt} width={92} height={45} decoding="async" />
          </Link>
          <p>© {year} Boss Clinician, LLC · Yvette Howard, LCSW</p>
          <nav aria-label="Policies" className="lib-policies">
            {POLICIES.map((p) => (
              <Link key={p.to} to={p.to}>
                {p.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </div>
  );
}
