/**
 * Resource Hub content.
 *
 * Section order and copy follow bossclinician.com/resourcehub as of 15 Oct 2026
 * (her wording, commas where an earlier draft had dashes). Card CTAs are
 * internal routes — never absolute bossclinician.com URLs, which after the
 * domain cutover point back at this app. Each goes to the funnel rebuilt here
 * at its Kajabi path (/kickstartguide, /practicepreptraining,
 * /private-practice-for-you, /5-step-marketing, /freedom-masterclass,
 * /boss-assessment, /hiring-quiz). The section CTA bars point at the offer
 * pages (/club, /lounge, /boardroom).
 */

/** Accent colours available to a hub section. Maps to the brand tokens. */
export type Accent = "green" | "plum" | "ink";

export interface ResourceCardData {
  id: string;
  /** Tag-bar label, e.g. "Free Download". */
  tag: string;
  /** Optional pill rendered inside the tag bar, e.g. "Featured". */
  badge?: string;
  /** Overrides the section accent on the tag bar — paid offers use "dark". */
  tagAccent?: Accent | "dark";
  /** Overrides the section accent on the CTA button. */
  ctaAccent?: Accent;
  /** Featured cards get a 2px accent border instead of the 1px hairline. */
  featured?: boolean;
  title: string;
  description: string;
  /** A short line set under the description, e.g. what the training includes. */
  note?: string;
  ctaLabel: string;
  /** External funnel URL. */
  href: string;
}

export interface AvatarSectionData {
  /** Also the in-page anchor target used by the sort pills. */
  id: string;
  accent: Accent;
  surface: "white" | "cream";
  eyebrow: string;
  headline: string;
  description: string;
  cards: ResourceCardData[];
  cta: { body: string; label: string; to: string };
}

export interface SortPillData {
  /** Target section id. */
  id: string;
  label: string;
  accent: Accent;
}

export const sortPills: SortPillData[] = [
  { id: "depleted", label: "Just Starting · Build It", accent: "green" },
  { id: "maxedout", label: "Maxed Out · Sustain It", accent: "plum" },
  { id: "stretchedthin", label: "Building a Team · Lead It", accent: "ink" },
];

// Each section's CTA goes to its own programme's page: /club, /lounge and
// /boardroom.
export const avatarSections: AvatarSectionData[] = [
  {
    id: "depleted",
    accent: "green",
    surface: "white",
    eyebrow: "Section 1 · Build It",
    headline: "Just starting, or starting over.",
    description:
      "For therapists building the foundation, attracting clients, and creating a practice they will not have to undo later.",
    cards: [
      {
        id: "kick-start-guide",
        tag: "Free Download",
        badge: "Featured",
        featured: true,
        title: "Private Practice Kick Start Guide",
        description:
          "Just starting your practice or want to make sure you're building on the right foundation? This guide walks you through exactly what to set up first so you don't waste time or money on the wrong things.",
        ctaLabel: "Download the Free Kick Start Guide",
        href: "/kickstartguide",
      },
      {
        id: "practice-prep-training",
        tag: "Free Training",
        title: "Build a Private Practice You Won’t Have to Undo Later",
        description:
          "A free training for therapists who are building, rebuilding, or trying to create a stronger foundation for private practice. Learn what to focus on beyond simply getting clients so you can make smarter decisions about your business from the start.",
        ctaLabel: "Watch the Free Training",
        href: "/practicepreptraining",
      },
      {
        id: "ready-quiz",
        tag: "Free Quiz",
        title: "Is Private Practice Actually Right for You Right Now?",
        description:
          "An honest 2-minute quiz for therapists thinking about leaving their agency or platform. Answer 6 quick questions and find out if you are ready, almost ready, or what needs to happen first, plus your personalized next steps.",
        ctaLabel: "Take the Free Quiz",
        href: "/private-practice-for-you",
      },
      {
        id: "marketing-plan",
        tag: "Free Marketing Guide",
        title: "5-Step Marketing Plan",
        description:
          "Why your marketing isn't working, and exactly what to do instead. A simple, sustainable system to attract aligned clients without posting every day or depending on platforms to send referrals.",
        ctaLabel: "Get the Free 5-Step Marketing Plan",
        href: "/5-step-marketing",
      },
    ],
    cta: {
      body: "Ready for the full foundation-building experience with live coaching, monthly kits, and a community that actually gets it?",
      label: "Explore the Club",
      to: "/club",
    },
  },
  {
    id: "maxedout",
    accent: "plum",
    surface: "cream",
    eyebrow: "Section 2 · Sustain It",
    headline: "Fully booked, but still not where you want to be.",
    description:
      "For established clinicians whose practice is working, but requires more time, energy, or clinical output than they want to maintain long-term.",
    cards: [
      {
        id: "free-masterclass",
        tag: "Free Masterclass",
        badge: "Featured",
        featured: true,
        title:
          "How to Create a Private Practice That Supports Your Income, Energy and Future, Without Seeing 25 to 30 Clients Forever",
        description:
          "For established clinicians whose practice is working, but who do not want their income, schedule, and future to depend on staying clinically maxed out. Learn why being fully booked can still leave you maxed out, where your practice may depend too heavily on you, and what needs to change if you want the practice to support your next season.",
        note: "Includes the complimentary Practice Freedom Audit.",
        ctaLabel: "Watch the Free Masterclass",
        href: "/freedom-masterclass",
      },
    ],
    cta: {
      body: "Ready to make the practice you already built work better for your income, energy, and future?",
      label: "Join the Boss Clinician Lounge",
      to: "/lounge",
    },
  },
  {
    id: "stretchedthin",
    accent: "ink",
    surface: "white",
    eyebrow: "Section 3 · Lead It",
    headline: "Building a team, but running on empty.",
    description:
      "For practice owners moving beyond themselves who need support around leadership, team development, systems, and building a business that can grow without everything depending on them.",
    cards: [
      {
        id: "boss-assessment",
        tag: "Free Self-Assessment",
        badge: "Featured · 11 Pages",
        featured: true,
        title: "Are You Running Your Practice, or Is It Running You?",
        description:
          "A self-assessment for group practice owners who built the team but still can't step back. Score yourself across 5 common blockers, identify exactly what's keeping you stuck, and walk away with a clear picture of what to address first.",
        ctaLabel: "Download the Free Assessment",
        href: "/boss-assessment",
      },
      {
        id: "hire-quiz",
        tag: "Free Quiz",
        title: "Are You Ready to Hire Your First Clinician?",
        description:
          "Thinking about hiring but not sure if your practice is ready? Take this 5-minute quiz to find out exactly where you stand, and what to do next. Whether you're ready or not, you'll leave with a clear, personalized action plan.",
        ctaLabel: "Take the Free Quiz",
        href: "/hiring-quiz",
      },
    ],
    cta: {
      body: "Ready for a peer-level mastermind with clinicians building at the same level, guided by Yvette?",
      label: "Explore the Boardroom",
      to: "/boardroom",
    },
  },
];

export const strategistCreds = [
  "LCSW",
  "Multi-6-Figure Group Practice Owner",
  "Doctoral Candidate",
  "Private Practice Strategist",
];

export const strategistParagraphs = [
  "I'm Yvette Howard, LCSW, private practice strategist and founder of Boss Clinician. I've built a multi-six-figure group practice, learned firsthand what happens when growth outpaces sustainability, and spent years helping therapists make smarter decisions about how they build, run, and lead their practices.",
  "Every resource on this page was created from something I had to learn the hard way, so you don't have to.",
];

export interface FinalCtaLink {
  label: string;
  to: string;
  variant: "green" | "plum" | "gold";
}

// One per programme, each to that programme's own page. The Boardroom is by
// application, so its button lands on the application itself.
export const finalCtaLinks: FinalCtaLink[] = [
  { label: "Join the Boss Clinician Club", to: "/club", variant: "green" },
  { label: "Join the Boss Clinician Lounge", to: "/lounge", variant: "plum" },
  { label: "Apply for the Boardroom", to: "/boardroom#apply", variant: "gold" },
];
