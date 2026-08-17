/**
 * Resource Hub content.
 *
 * Section order, copy, and accent colours mirror the approved design. Card CTAs
 * point at the bossclinician.com funnels (external, open in a new tab); the
 * section CTA bars point at the offer pages.
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
  { id: "depleted", label: "Just Starting", accent: "green" },
  { id: "maxedout", label: "Maxed Out", accent: "plum" },
  { id: "stretchedthin", label: "Building a Team", accent: "ink" },
];

// TODO: repoint the section CTAs at /boss-clinician-club, /boss-clinician-lounge
// and /boss-clinician-boardroom once those dedicated offer routes exist.
export const avatarSections: AvatarSectionData[] = [
  {
    id: "depleted",
    accent: "green",
    surface: "white",
    eyebrow: "Section 1 · The Depleted Clinician",
    headline: "Just starting — or starting over.",
    description:
      "You're new to private practice or transitioning from agency or platform work. These resources help you build your foundation the right way from the very beginning.",
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
        href: "https://www.bossclinician.com/kickstartguide",
      },
      {
        id: "insurance-guide",
        tag: "Free Guide",
        title: "Insurance vs. Superbills — Which Is Right for Your Practice?",
        description:
          "One of the most confusing decisions new practice owners face. This guide breaks it down simply so you can make the right call for your practice model, your clients, and your income goals.",
        ctaLabel: "Download the Free Guide",
        href: "https://www.bossclinician.com/insurance-guide",
      },
      {
        id: "ready-quiz",
        tag: "Free Quiz",
        title: "Is Private Practice Actually Right for You Right Now?",
        description:
          "An honest 2-minute quiz for therapists thinking about leaving their agency or platform. Answer 6 quick questions and find out if you are ready, almost ready, or what needs to happen first — plus your personalized next steps.",
        ctaLabel: "Take the Free Quiz",
        href: "https://www.bossclinician.com/ready-quiz",
      },
    ],
    cta: {
      body: "Ready for the full foundation-building experience — live coaching, monthly kits, and a community that actually gets it?",
      label: "Join the Boss Clinician Club",
      to: "/work-with-me",
    },
  },
  {
    id: "maxedout",
    accent: "plum",
    surface: "cream",
    eyebrow: "Section 2 · The Maxed Out Clinician",
    headline: "Fully booked — but still not where you want to be.",
    description:
      "You've been in practice 3 or more years. Calendar full, income capped, burnt out from back-to-back sessions. Ready to build something that actually works for your life.",
    cards: [
      {
        id: "reset-audit",
        tag: "Free Audit",
        badge: "Featured",
        featured: true,
        title: "The Practice Reset Audit",
        description:
          "A free, fillable audit to identify exactly what's draining your time and income. Run every task through a 4-question clarity filter and walk away with a clear reset plan — and permission to stop what isn't working.",
        ctaLabel: "Get the Free Audit",
        href: "https://www.bossclinician.com/reset-audit",
      },
      {
        id: "marketing-plan",
        tag: "Free Marketing Guide",
        title: "5-Step Marketing Plan",
        description:
          "Why your marketing isn't working — and exactly what to do instead. A simple, sustainable system to attract aligned clients without posting every day or depending on platforms to send referrals.",
        ctaLabel: "Get the Free 5-Step Marketing Plan",
        href: "https://www.bossclinician.com/5-step-marketing",
      },
    ],
    cta: {
      body: "Ready for monthly live coaching, done-for-you tools, and a community of clinicians scaling at your level?",
      label: "Join the Boss Clinician Lounge",
      to: "/work-with-me",
    },
  },
  {
    id: "stretchedthin",
    accent: "ink",
    surface: "white",
    eyebrow: "Section 3 · The Stretched Thin Clinician",
    headline: "Building a team — but running on empty.",
    description:
      "You built the practice. You hired the clinicians. And somehow you're still the one holding everything together. These resources are for the group practice owner who is done doing it alone.",
    cards: [
      {
        id: "boss-assessment",
        tag: "Free Self-Assessment",
        badge: "Featured · 11 Pages",
        featured: true,
        title: "Are You Running Your Practice — or Is It Running You?",
        description:
          "A self-assessment for group practice owners who built the team — but still can't step back. Score yourself across 5 common blockers, identify exactly what's keeping you stuck, and walk away with a clear picture of what to address first.",
        ctaLabel: "Download the Free Assessment",
        href: "https://www.bossclinician.com/boss-assessment",
      },
      {
        id: "hire-quiz",
        tag: "Free Quiz",
        title: "Are You Ready to Hire Your First Clinician?",
        description:
          "Thinking about hiring but not sure if your practice is ready? Take this 5-minute quiz to find out exactly where you stand — and what to do next. Whether you're ready or not, you'll leave with a clear, personalized action plan.",
        ctaLabel: "Take the Free Quiz",
        href: "https://www.bossclinician.com/hiring-quiz",
      },
    ],
    cta: {
      body: "Ready for a peer-level mastermind with clinicians building at the same level — guided by Yvette?",
      label: "Apply for the Boss Clinician Boardroom",
      to: "/work-with-me",
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
  "I'm Yvette Howard, LCSW, Private Practice Strategist and founder of Boss Clinician. I've been where you are: managing 80 to 100 clients on Talkspace, joining Alma hoping for referrals that never came, and figuring out group practice with no roadmap and no one to call.",
  "Every resource on this page is something I wish I'd had from day one.",
];

export interface FinalCtaLink {
  label: string;
  to: string;
  variant: "green" | "plum" | "gold";
}

// TODO: repoint at the dedicated offer routes once they exist.
export const finalCtaLinks: FinalCtaLink[] = [
  { label: "Join the Boss Clinician Club", to: "/work-with-me", variant: "green" },
  { label: "Join the Boss Clinician Lounge", to: "/work-with-me", variant: "plum" },
  { label: "Apply for the Boardroom", to: "/work-with-me", variant: "gold" },
];
