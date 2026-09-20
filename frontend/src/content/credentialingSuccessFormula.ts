import type { ProgramFaqItem } from "@/components/home/luxe/ProgramSections";

/**
 * The Credentialing Success Formula sales page, as copy.
 *
 * Transcribed word for word from the page the owner supplied; nothing here is
 * rewritten or tightened. Copy lives apart from the component for the same
 * reason it does on the Club page: the next edit to this argument is a wording
 * edit, and a wording edit should not mean reading JSX.
 *
 * One thing is deliberately absent — the price. The source page prints "$247"
 * in three places, but the number a buyer is actually charged lives in the
 * offers table, so the page renders it from the API and this file never
 * repeats it. See components/course/CoursePriceLabel.
 */

/** The course this page sells; also the SSR payload key and the checkout slug. */
export const CSF_SLUG = "credentialing-success-formula";

/** Where every mid-page action scrolls, as on /club. Only this band transacts. */
export const CSF_INVESTMENT_ANCHOR = "#investment";

/** The shared action label, repeated by the source page at each turn. */
export const CSF_CTA_LABEL = "Get the Credentialing Success Formula";

export interface CsfPicture {
  src: string;
  alt: string;
  width: number;
  height: number;
}

/**
 * The product montage the source page opens with, self-hosted: the site's CSP
 * allows images from 'self' only, so the supplied data URI was decoded and the
 * Kajabi CDN copy — the same artwork — was dropped rather than hotlinked.
 */
export const CSF_MOCKUP: CsfPicture = {
  src: "/images/csf/credentialing-success-formula-mockup.webp",
  alt: "The programme's materials laid out together: a laptop showing “Credentialing Essentials and Supervisory Billing for Behavioral Health Practice Owners”, the supervisory and group credentialing guidelines, the new and current staff credentialing checklist, a provider credentialing checklist, the insurance reference fee guide, and a tablet listing payer supervisory-billing rules",
  width: 1920,
  height: 1080,
};

export const csf = {
  hero: {
    eyebrow: "For Group Practice Owners Adding Clinicians",
    title: "Stop Rebuilding Your Credentialing Process",
    titleAccent: "Every Time You Hire",
    lede: "A step-by-step credentialing system for behavioral-health group practice owners who want to get new clinicians enrolled, organized, and moving toward billable status, without having to personally manage every application forever.",
    boldLine: "Use it yourself. Train your admin with it. Build a process your practice can repeat.",
    /** The source's price line, with the figure left for the offer to fill in. */
    terms: "One-Time Payment · Instant Access",
    designerNote:
      "Designed to be repeatable, not owner-dependent. Learn the credentialing process yourself, then use the same training, checklist, and tracker to train the administrative person who will manage it going forward.",
  },

  problem: {
    title: "You Hired the Clinician. Now You Have to Get Them Credentialed.",
    paragraphs: [
      "And this is usually where things get messy. You're collecting documents, updating CAQH, applying to multiple payers, following up on applications, trying to remember which payer needs what, tracking approval dates, and checking effective dates.",
      "And somewhere in the middle of running your actual practice, you realize:",
    ],
    pull: "You're rebuilding the same process every time someone joins your team.",
    closing:
      "That may work when you have one clinician. It gets harder when you're growing. The goal isn't for you to become the person who handles credentialing forever. The goal is to build a process someone else can eventually follow.",
  },

  system: {
    title: "Credentialing Should Be a System, Not Something That Lives in Your Head",
    paragraphs: [
      "When I first started growing my own group practice, I handled much of this myself. Eventually, I realized that if every new clinician required me to personally manage the credentialing process, I hadn't really built a system. I had created another job for myself.",
      "So I documented the process. I trained my admin using the same steps. And now, when we bring on a new clinician, I don't have to personally start from scratch and handle every piece of credentialing myself.",
    ],
    pull: "That is what I want this program to help you create.",
  },

  intro: {
    eyebrow: "Introducing",
    title: "The Credentialing Success Formula",
    boldLine: "A Repeatable Credentialing & Payer Enrollment System for Group Practices",
    body: "The Credentialing Success Formula walks you through the credentialing process while giving you the checklists, trackers, and workflows you need to organize it inside your practice.",
    bullets: [
      "Learn the process yourself.",
      "Clean up the process you already have.",
      "Train an administrative team member.",
      "Create a repeatable workflow for future hires.",
      "Monitor credentialing even if you outsource the actual applications.",
    ],
    closing:
      "Because even when someone else handles credentialing for you, you should still know what is happening inside your business.",
  },

  flow: {
    title: "From New Hire to Billable",
    /** `billable` marks the one step the source sets in gold — the outcome. */
    steps: [
      { label: "Hired" },
      { label: "Documents Collected" },
      { label: "CAQH Ready" },
      { label: "Payer Applications Submitted" },
      { label: "Applications Tracked + Followed Up" },
      { label: "Approved" },
      { label: "Effective Dates Verified" },
      { label: "Billable", billable: true },
      { label: "Ongoing Credentialing Maintenance" },
    ],
  },

  included: {
    title: "What's Included",
    items: [
      {
        title: "Group Practice Credentialing Training",
        desc: "Learn the major steps involved in credentialing clinicians under a behavioral-health group practice.",
        bullets: [
          "What needs to happen before applications begin",
          "How CAQH fits into the process",
          "Individual vs. group enrollment considerations",
          "What information you need from new clinicians",
          "How to organize payer applications",
          "How to follow up",
          "How to track approvals and effective dates",
          "What needs ongoing maintenance",
        ],
        note: "This gives you the knowledge you need to understand the process before you delegate the process.",
      },
      {
        title: "New Clinician Credentialing Checklist",
        desc: 'Stop asking, "What am I forgetting?" Use the checklist with every new clinician so you can track the process consistently.',
        bullets: [
          "Required information",
          "Documents received",
          "Missing items",
          "CAQH readiness",
          "Applications submitted",
          "Follow-up",
          "Approvals",
          "Effective dates",
        ],
        note: "It becomes part of your standard onboarding process instead of something you recreate every time.",
      },
      {
        title: "Credentialing & Payer Enrollment Tracker",
        desc: "See exactly where every clinician stands with every payer.",
        bullets: [
          "Clinician, payer, application date, current status",
          "Follow-up date, missing information",
          "Approval date, effective date",
          "Notes, renewal information",
        ],
        note: "This becomes especially important once you're credentialing several clinicians across multiple insurance companies.",
      },
      {
        title: "CAQH Readiness Checklist",
        desc: "Make sure you have the information you need before you sit down to complete or update a clinician's profile.",
        bullets: [],
        note: "This helps reduce unnecessary back-and-forth and gives your admin a consistent checklist to follow.",
      },
      {
        title: "Payer Research & Reference Guide",
        desc: "Payer requirements change, so the goal is not to memorize every insurance company's rules. The goal is to know how to find, verify, and organize them.",
        bullets: [
          "Payer contact information",
          "Application requirements",
          "Enrollment details",
          "Follow-up instructions",
          "Group-specific notes",
          "Important dates",
        ],
        note: "",
      },
      {
        title: "Supervisory Billing Research & Verification Guide",
        desc: "Supervisory billing isn't one-size-fits-all. Requirements can depend on the payer, clinician's license, jurisdiction, and practice structure.",
        bullets: [
          "What to verify with the insurance payer",
          "What to verify with the licensing board",
          "What to review with your billing professional",
          "When compliance or legal review may be appropriate",
        ],
        note: "So you're making decisions based on information that applies to your actual practice, not assumptions.",
      },
    ],
  },

  admin: {
    title: "Use This Training to Train Your Admin",
    boldLine: "You shouldn't have to be your practice's credentialing department forever.",
    body: "Once you understand the workflow, you can use the Credentialing Success Formula to help train the person responsible for credentialing inside your practice.",
    roles: [
      "Administrative assistant",
      "Office manager",
      "Practice manager",
      "Billing team member",
      "Credentialing coordinator",
    ],
    handoff:
      'Give them access to the training. Give them the checklist. Give them the tracker. Then establish: "This is how credentialing is handled in our practice."',
    pull: "That's exactly how I trained my own admin.",
    closing:
      "I didn't want every new clinician to mean another credentialing project for me. So I taught someone else the process and created a system she could follow.",
  },

  outsource: {
    title: "Even If You Outsource Credentialing, You Still Need a System",
    body: "Maybe you have no desire to complete applications yourself. That's fine. This isn't about forcing you to DIY everything.",
    questions: [
      "Which payers were submitted?",
      "When were they submitted?",
      "What's pending?",
      "What information is missing?",
      "When did we last follow up?",
      "When was the clinician approved?",
      "What's the effective date?",
      "When does something need to be renewed?",
    ],
    pull: "Outsourcing the task shouldn't mean outsourcing your understanding of what is happening in your business.",
  },

  whyItMatters: {
    title: "Why This Matters Beyond Credentialing",
    body: 'A clinician joining your team does not automatically mean the practice immediately gains revenue. There can be a gap between "We hired them" and "They\'re fully operational with the payers our clients use."',
    touches: [
      "Hiring timelines",
      "Clinician ramp-up",
      "Payroll planning",
      "Referrals",
      "Client assignment",
      "Cash flow",
      "Capacity",
      "Growth decisions",
    ],
    boldLine: "Credentialing isn't just paperwork. It's part of your operational and financial planning.",
  },

  fit: {
    forTitle: "This Is For You If...",
    forYou: [
      "You already have clinicians or are actively hiring",
      "You accept insurance or operate a hybrid practice",
      "You need a more organized credentialing process",
      "You're tired of tracking everything through email and memory",
      "You want an admin or team member to eventually own this process",
      "You want visibility even if credentialing is outsourced",
      "You want a repeatable system that can grow with the practice",
    ],
    notTitle: "This Is Not for You If...",
    notForYou: [
      "You're a solo therapist who only needs to credential yourself. For that, Credential With Confidence is the better fit and includes the CE training designed around solo credentialing.",
    ],
    /** The solo alternative the card names, as a link the reader can follow. */
    soloLink: { label: "See Credential With Confidence", to: "/courses/credential-with-confidence" },
    closing:
      "The Credentialing Success Formula is specifically built around the additional complexity that comes with adding clinicians to a group practice.",
  },

  bio: {
    eyebrow: "Created by a Group Practice Owner Who Actually Had to Build This System",
    title: "Hi, I'm Yvette Howard, LCSW.",
    paragraphs: [
      "I opened my private practice in 2018 and eventually grew it into a multi-six-figure group practice. As the team grew, so did the number of systems the business needed. Credentialing was one of them.",
      "At first, like many owners, I was much more involved in the process myself. But eventually I had to ask: Why am I still the person who has to do this every time we hire?",
      "So I created a process. I trained my admin. And I moved credentialing from something dependent on me to something the practice could manage as an operation.",
    ],
    strong:
      "You're not just learning how to complete a task. You're learning how to build a process your business can repeat without you having to personally carry every step.",
    signature: "Yvette Howard, LCSW",
  },

  table: {
    title: "What's Included With Your Purchase",
    head: ["Resource", "What It Helps You Do"] as const,
    rows: [
      ["Group Practice Credentialing Training", "Learn the process from new hire through payer enrollment."],
      ["New Clinician Credentialing Checklist", "Create consistency with every hire."],
      ["Credentialing & Payer Enrollment Tracker", "See exactly where every application stands."],
      ["CAQH Readiness Checklist", "Organize clinician information before starting."],
      ["Payer Research & Reference Guide", "Document payer-specific requirements and contacts."],
      ["Supervisory Billing Research & Verification Guide", "Know what needs to be researched and verified."],
      ["New-Hire-to-Billable Workflow", "Turn credentialing into a repeatable operational process."],
      [
        "Admin Training Access",
        "Use the training and resources to teach the person who will manage credentialing inside your practice.",
      ],
    ] as const,
  },

  investment: {
    boldLine: "Build the System Once. Use It With Every New Clinician.",
    terms: "One-time payment. Instant access.",
  },

  faq: {
    title: "Frequently Asked Questions",
    items: [
      {
        q: "Can my admin take the training?",
        a: "Yes, and I encourage it. One of the reasons I created a repeatable credentialing process in my own practice was so I wouldn't have to personally manage credentialing every time we hired someone. You can use this training to educate the team member responsible for credentialing in your practice. Access should be limited to the purchasing practice and its designated internal staff.",
      },
      {
        q: "Will this credential my clinicians for me?",
        a: "No. This is a training and implementation system, not a done-for-you credentialing service. You'll learn how to organize, track, and manage the process internally.",
      },
      {
        q: "Can I use this if I hire a credentialing company?",
        a: "Absolutely. The system can help you monitor the work being completed on your behalf so you still know where each clinician and payer application stands.",
      },
      {
        q: "How long does credentialing take?",
        a: "There is no universal credentialing timeline. Processing times depend on the payer, provider, application, network availability, enrollment type, and other factors. The Credentialing Success Formula helps you manage the pieces that are within your control and keep the process organized.",
      },
      {
        q: "Does this guarantee that a payer will accept my clinician?",
        a: "No. Insurance companies make their own credentialing and network participation decisions. This program provides education and organizational tools; it cannot guarantee payer acceptance or a specific effective date.",
      },
      {
        q: "Does this tell me whether I can bill under supervision?",
        a: "You'll learn what information needs to be researched and verified. Billing requirements involving prelicensed clinicians can vary by payer, license, jurisdiction, and practice structure, so the program does not make a blanket determination for every practice.",
      },
      {
        q: "Is this legal or billing advice?",
        a: "No. The Credentialing Success Formula is educational. You'll still need to verify requirements that apply to your specific practice with your payer, licensing board, billing professional, attorney, compliance professional, or other appropriate resource.",
      },
      {
        q: "Is this for solo clinicians?",
        a: "If you're only credentialing yourself, Credential With Confidence is the better fit. This program is designed specifically around credentialing additional clinicians within a group practice.",
        link: { label: "Credential With Confidence", to: "/courses/credential-with-confidence" },
      },
    ] as readonly ProgramFaqItem[],
  },

  finalCta: {
    title: "Stop Being the Only Person Who Knows How Credentialing Works in Your Practice",
    body: "Your next clinician should not mean another pile of applications, another spreadsheet, another six email threads, and another process that depends completely on you.",
    boldLine:
      "Build the system. Train your team. And make credentialing one more part of the practice that can operate without you having to personally manage every step.",
    label: "Get Instant Access",
  },
} as const;
