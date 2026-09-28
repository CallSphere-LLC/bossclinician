import type { ProgramFaqItem } from "@/components/home/luxe/ProgramSections";

/**
 * The Freedom Masterclass sign-up (/freedom-masterclass) and the page after it
 * (/watch-now), word for word from her Kajabi pages at
 * bossclinician.com/freedom-masterclass and /watch-now (captured 28 Sep 2026).
 *
 * Kept as data so the pages stay a readable list of sections and so a change of
 * wording is a change in one place.
 */
export const freedomMasterclass = {
  seo: {
    title: "Free Masterclass: A Practice That Supports Your Life | Boss Clinician",
    description:
      "A free on-demand masterclass for therapists and psychiatric providers who already built the practice, but do not want their income, schedule, and future to depend on staying clinically maxed out. Includes the complimentary Practice Freedom Audit.",
  },

  hero: {
    eyebrow: "Free On-Demand Masterclass",
    title: "The Year My Practice Hit $500K Was the Same Year I Almost",
    titleAccent: "Walked Away From It.",
    lede:
      "That is when I learned that a successful practice and a sustainable practice are not always the same thing. And that growing the practice was not the same thing as creating more freedom.",
    cta: "Watch the Free Masterclass",
  },

  register: {
    titleLead: "How to Create a Private Practice That Supports Your",
    titleAccent: "Income, Energy and Future,",
    titleTail: "Without Seeing 25 to 30 Clients Forever",
    body:
      "For therapists and psychiatric providers who already built the practice, but do not want their income, schedule, and future to depend on staying clinically maxed out.",
    included: "Instant access + complimentary Practice Freedom Audit included",
    card: {
      eyebrow: "Free Instant Access",
      title: "Watch the masterclass +",
      titleAccent: "get your free audit",
      firstName: "First name",
      email: "Email",
      submit: "Get Free Access",
      sending: "Saving your seat…",
      privacy: "Your privacy matters. You can unsubscribe anytime.",
    },
    alsoIncluded:
      "Also included: the complimentary Practice Freedom Audit to help you apply what you learn to your own practice.",
  },

  forYou: {
    eyebrow: "This is for you if",
    title: "Your practice is working.",
    titleAccent: "But can you keep working like this?",
    items: [
      "Your caseload is full or close to full",
      "Seeing fewer clients sounds good, until you think about what it would do to your income",
      "Taking meaningful time off still feels harder than it should",
      "You are beginning to question whether you want to maintain this pace for another 5, 10, or 15 years",
      "When clients cancel, go biweekly, or referrals slow down, your income feels more vulnerable than you want it to",
    ],
    pullLead: "Your maximum capacity was never supposed to become",
    pullAccent: "your permanent business model.",
    notFor:
      "If your primary challenge is getting your first clients or launching your practice, this training is not designed for that stage.",
    cta: "Watch the Free Masterclass",
  },

  discover: {
    eyebrow: "What you will discover",
    title: "Inside this free masterclass,",
    titleAccent: "you will discover:",
    points: [
      {
        title: "Why being fully booked can still leave your income vulnerable",
        body:
          "See why a full calendar can feel like security, until clients cancel, go biweekly, terminate, or referrals slow down.",
      },
      {
        title: "What slower seasons can reveal about your practice",
        body:
          "Understand when your income depends too heavily on 1:1 clinical hours, and why that does not automatically mean your practice is failing.",
      },
      {
        title: "Three ways your existing practice may be able to create more flexibility",
        body:
          "Explore three ways to rethink capacity, service design, and your clinical expertise without simply adding more 1:1 clients or starting another business.",
      },
    ],
    areas:
      "During the training, we will look at three areas of your practice: The Capacity Multiplier, The Service Design Strategy, and The Clinical Authority Strategy. You do not need to use all three. The goal is to see that “add more clients” is not your only option.",
    alsoIncluded:
      "Also included: the complimentary Practice Freedom Audit to help you identify where your current practice may be creating the most pressure, so you know what deserves your attention first.",
    cta: "Get Free Access",
  },

  proof: {
    testimonial: {
      quote:
        "When I started seeing myself as a business owner, not just a clinician, everything changed. I finally created space in my schedule to rest. Yvette helped me realize I wasn’t just allowed to lead… I was born to.",
      name: "Saritha Farris, LCSW",
    },
    quote: {
      lead: "I did not necessarily need another business.",
      accent: "I needed to build the one I already had differently.",
      name: "Yvette Howard, LCSW",
    },
  },

  host: {
    eyebrow: "Meet your host",
    name: "Yvette Howard",
    credential: "LCSW · Founder, Boss Clinician Coaching",
    lead: "I built the kind of private practice I once thought would give me freedom.",
    paragraphs: [
      "I opened my practice in 2018, went full-time in 2019, built a full caseload, and eventually grew the business to more than $500,000 in revenue.",
      "From the outside, it looked like success. But the year my practice reached its highest revenue was also the year I seriously questioned whether I wanted to keep doing it. I was working on vacations. Working through time with my son. Carrying too much of the business in my own head and on my own shoulders.",
      "And I kept thinking the answer was somewhere else: another platform, another program, another income stream, maybe even another business.",
      "I did not necessarily need another business. I needed to build the one I already had differently.",
      "That changed the way I think about private practice. Today I work in my practice about 5 to 8 hours a month. I still see clients, 4 to 5 long-term clients I have worked with for years, by choice, to maintain my clinical skills. Not because the practice depends on it. The income runs without me in the room. That experience changed how I think about private practice, and now I help established clinicians make the practice they already built work better for their income, energy, and future.",
    ],
    proofs: [
      {
        label: "I built",
        body: "a profitable group practice from scratch, without a business degree or a roadmap",
      },
      {
        label: "I designed",
        body:
          "a practice that runs without me in the room. I now see 4 to 5 clients a month by choice, not because the income depends on it",
      },
      {
        label: "Now I teach",
        body: "what actually changed, so other therapists do not have to figure it out the hard way",
      },
    ],
    photo: {
      src: "/images/masterclass/yvette-host-portrait.jpg",
      alt: "Yvette Howard, LCSW, smiling in a black T-shirt",
      width: 896,
      height: 1344,
    },
  },

  faq: {
    eyebrow: "Frequently asked questions",
    title: "Questions about the training",
    items: [
      {
        q: "Do I have to stop taking insurance for this to work?",
        a: "No. This is not a “get off insurance” masterclass. The goal is to help you evaluate your current practice and determine what actually supports your income, capacity, and long-term goals.",
      },
      {
        q: "Are you going to tell me I need to become a coach, create a course, or add another income stream?",
        a: "No. Sometimes the answer is not another offer or another business. Sometimes the practice you already built simply needs to work better.",
      },
      {
        q: "Is this for me if I am still trying to build my first caseload?",
        a: "Probably not. This training was created for established clinicians whose practice is already working but requires more from them than they want to maintain long-term.",
      },
    ] satisfies ProgramFaqItem[],
  },

  closing: {
    title: "You Built the Practice.",
    titleAccent: "Now Build One You Can Actually Stay In.",
    body:
      "Learn why your practice may feel harder to sustain than it should, and three ways to create more flexibility inside the business you already built.",
    note: "Instant access + complimentary Practice Freedom Audit included.",
  },
} as const;

/** /watch-now, the page a registration lands on. */
export const watchNow = {
  seo: {
    title: "Your Masterclass Is Ready | Boss Clinician",
    description: "Your next steps for the free Freedom Masterclass.",
  },
  banner: "Masterclass: do not close the window",
  greeting: "Welcome",
  title: "Your next steps:",
  step1: {
    label: "Step 1",
    title: "Access the masterclass action guide",
    // Her sign-up page's own description of the guide; the Kajabi thank-you
    // page had a picture here and no sentence.
    body:
      "The complimentary Practice Freedom Audit, to help you apply what you learn to your own practice.",
    cta: "Download Action Guide Here",
    image: {
      src: "/images/masterclass/action-guide-mockup.jpg",
      alt: "The Practice Freedom Audit workbook beside the masterclass on a desktop screen",
      width: 1600,
      height: 900,
    },
  },
  step2: {
    label: "Step 2",
    title: "Watch the masterclass",
    poster: {
      src: "/images/masterclass/masterclass-cover.jpg",
      alt: "How to Create a Private Practice That Supports Your Income, Energy and Future, without seeing 25–30+ clients forever. Hosted by Yvette Howard, LCSW.",
      width: 1600,
      height: 900,
    },
    comingSoonTitle: "The masterclass video is coming soon",
    comingSoonBody:
      "Keep this page bookmarked — the video will play right here. Start with your action guide in the meantime.",
    openLabel: "Watch the Masterclass",
    videoTitle: "The Freedom Masterclass with Yvette Howard, LCSW",
  },
  lounge: {
    question:
      "Tired of working more than you did for someone else, still haven't taken that vacation, and don't want to add one more thing to your plate?",
    title: "Join the Boss Clinician Lounge",
    cta: "Get Me in the Lounge Please",
    to: "/lounge",
    dmLead: "Have questions before you join?",
    dmLabel: "Send me a DM on Instagram!",
    dmHref: "https://www.instagram.com/profitwithyvette",
    photo: {
      src: "/images/yvette-hero-seated.jpg",
      alt: "Yvette at her desk with her feet up, smiling over an open notebook",
      width: 960,
      height: 1309,
    },
  },
  testimonial: {
    quote:
      "I am grateful to have come across this program to help me become further independent with my private practice. Yvette is been helpful every step of the way by providing resources for my internal dilemmas, and providing support with video play backs , and setting goals to help hold me accountable.",
    // Verbatim from her page, typos included: it is a client's quote.
    name: "Michael M. LCPC",
  },
} as const;
