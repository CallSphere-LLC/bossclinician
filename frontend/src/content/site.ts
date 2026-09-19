export interface NavLinkItem {
  label: string;
  to: string;
}

export type NavBadgeTone = "green" | "plum" | "gold";

/** One row of a header dropdown: a label, and a line saying what is behind it. */
export interface NavMenuItem extends NavLinkItem {
  description: string;
  /** Optional pill beside the label ("6-Month Program", "Apply"). */
  badge?: string;
  badgeTone?: NavBadgeTone;
}

/** A link in a dropdown's footer row: a route (`to`) or an outside URL (`href`). */
export type NavMenuFooterLink =
  | { label: string; to: string; href?: undefined }
  | { label: string; href: string; to?: undefined };

export interface NavMenu {
  label: string;
  /** Short line set above the items inside the desktop panel. */
  description?: string;
  items: NavMenuItem[];
  /** Links along the bottom edge of the desktop panel, left to right. */
  footer?: NavMenuFooterLink[];
}

export type NavEntry = NavLinkItem | NavMenu;

/** Discriminates a header dropdown from a plain nav link. */
export function isNavMenu(entry: NavEntry): entry is NavMenu {
  return "items" in entry;
}

/** The header's account and booking actions, as the source site's header has them. */
export const headerActions = {
  logIn: { label: "Log In", to: "/login" },
  // The header books the "chat" call; the footer's link is a different booking
  // (alignwithyvette). Both are as they are on bossclinician.com.
  bookACall: {
    label: "Book A Call",
    href: "https://tidycal.com/profitwithyvette/chatprofitwithyvette",
  },
};

// Everything a clinician can join or buy a seat in. The Club and the Lounge
// have their own sales pages, at the same paths the source site uses. The
// Boardroom has none yet: /boardroom redirects to /work-with-me (migration
// 064), so the menu goes there directly. Book A Call lives in this panel's
// footer rather than as a second button in the bar.
export const programsMenu: NavMenu = {
  label: "Programs",
  description: "Ways to work with Yvette",
  items: [
    {
      label: "Boss Clinician Club",
      to: "/club",
      description: "Six months of coaching to build your practice on the right foundation.",
      badge: "6-Month Program",
      badgeTone: "green",
    },
    {
      label: "Boss Clinician Lounge",
      to: "/lounge",
      description: "A membership for established therapists easing caseload pressure.",
      badge: "Monthly",
      badgeTone: "plum",
    },
    {
      label: "Boardroom Mastermind",
      to: "/work-with-me",
      description: "Private strategy for clinicians ready to lead, hire and scale.",
      badge: "Apply",
      badgeTone: "gold",
    },
    {
      label: "Retreats",
      to: "/retreats",
      description: "A luxury wellness retreat for women mental health professionals.",
    },
    {
      label: "Courses",
      to: "/courses",
      description: "Self-paced trainings and toolkits from the training library.",
    },
  ],
  footer: [
    { label: "See all programs", to: "/work-with-me" },
    { label: headerActions.bookACall.label, href: headerActions.bookACall.href },
  ],
};

export const resourcesMenu: NavMenu = {
  label: "Resources",
  description: "Free tools and reading",
  items: [
    {
      label: "Resource Hub",
      to: "/resource-hub",
      description: "Free tools for where your practice is now, including the income calculator.",
    },
    {
      label: "Free Resources",
      to: "/resources",
      description: "The free masterclass, guides and checklists.",
    },
    {
      label: "Blog",
      to: "/blog",
      description: "Articles on building a private practice.",
    },
    {
      label: "Practice Quiz",
      to: "/practice-quiz",
      description: "A free 2-minute quiz about how your practice is working for you.",
    },
    {
      label: "Store",
      to: "/store",
      description: "Courses, toolkits and templates to buy and use today.",
    },
  ],
};

// Two categories, then the two pages a visitor looks for by name. About and
// Contact stay plain links: a two-item dropdown hides both behind a click and
// groups nothing.
export const nav: NavEntry[] = [
  programsMenu,
  resourcesMenu,
  { label: "About", to: "/about" },
  { label: "Contact", to: "/contact" },
];

export const footer = {
  brandTagline: "Self Made — Self Paid.",
  tagline:
    "Community, strategy, and mastermind for therapists and clinicians building practices that are actually theirs.",
  exploreLinks: [
    { label: "About Yvette", to: "/about" },
    { label: "Work With Me", to: "/work-with-me" },
    { label: "Boss Clinician Club", to: "/club" },
    { label: "Boss Clinician Lounge", to: "/lounge" },
    // No Boardroom page yet; /boardroom itself redirects here.
    { label: "Boss Clinician Boardroom", to: "/work-with-me" },
    { label: "Blog", to: "/blog" },
    { label: "Contact", to: "/contact" },
  ] satisfies NavLinkItem[],
  // The source footer's resource list, under the source's labels. The four
  // funnels that have not been rebuilt here (assessment, audit, marketing plan,
  // hiring quiz) point at the Resource Hub, whose cards describe them and which
  // is the closest page this site has; the offer quiz goes where the redirect
  // map sends /offer-quiz. No #section anchors: Layout scrolls to the top on a
  // path change and nothing scrolls to a hash, so an anchor would be a promise
  // the page does not keep.
  resourceLinks: [
    { label: "Resource Hub", to: "/resource-hub" },
    { label: "Free Masterclass", to: "/resources" },
    { label: "Practice Reset Planner", to: "/practice-reset-planner" },
    { label: "Offer Quiz", to: "/practice-quiz" },
    { label: "Group Practice Assessment", to: "/resource-hub" },
    { label: "Practice Reset Audit", to: "/resource-hub" },
    { label: "5-Step Marketing Plan", to: "/resource-hub" },
    { label: "Hiring Readiness Quiz", to: "/resource-hub" },
  ] satisfies NavLinkItem[],
  legalLinks: [
    { label: "Privacy Policy", to: "/privacy-policy" },
    { label: "Terms of Use", to: "/terms" },
    { label: "Financial Disclaimer", to: "/financial-disclaimer" },
    { label: "Disclaimer", to: "/disclaimer" },
  ],
  instagram: "https://instagram.com/bossclinician",
  instagramHandle: "@bossclinician",
  facebook: "https://facebook.com/yvette.hwd",
  threads: "https://threads.net/@bossclinician",
  linkedin: "https://www.linkedin.com/in/yvettelcsw/",
  tiktok: "https://www.tiktok.com/@bossclinician",
  tiktokHandle: "@bossclinician",
  bookACall: "https://tidycal.com/profitwithyvette/alignwithyvette",
  contactEmail: "yvette@bossclinician.com",
};

export const home = {
  eyebrow: "Private Practice Strategist for Therapists",
  heroHeading: "Outgrowing Alma, Headway, or Talkspace?",
  heroSubheading: "That's not a problem — it's a sign you're ready for more.",
  heroBody:
    "I help therapists and clinicians break free from Alma, Headway, Talkspace, and similar platforms and build a profitable, sustainable practice that's fully their own — no algorithm, no rate split, no one else's rules.",
  heroCta: "Apply for 1:1 Coaching",
  valueProps: [
    {
      title: "More Freedom",
      body: "Enjoy the flexibility to spend your time exactly how you want.",
    },
    {
      title: "More Financial Stability",
      body: "Boost your revenue consistently, month after month.",
    },
    {
      title: "More Flexibility",
      body: "Achieve a sustainable work-life balance without the risk of burnout.",
    },
  ],
  painHeading:
    "You dreamt of owning a private practice where you lead, thrive, and serve clients in a way that lights you up.",
  painIntro: "But instead you find yourself:",
  painPoints: [
    "Sitting awake at night, wondering if you'll ever have steady clients, predictable income, or the systems that work.",
    "Frustrated because the strategies that promised results feel scattered, half-done, or off-target.",
    "Overwhelmed with too many tasks — niche, marketing, rates, scheduling, systems — without clarity on what actually moves the needle.",
    "Watching other therapists hit their stride, while you're wondering how they did it, and when it will be your turn.",
  ],
  neverAloneHeading: "You were never meant to do this alone.",
  neverAloneBody:
    "Dedicated therapists like you are reaching out and getting the support they need to successfully start their private practices.",
  pillars: [
    {
      title: "PROVEN",
      body: "My individual services are founded on the B.O.S.S Blueprint that's been used to build multi-six-figure practices.",
    },
    {
      title: "PERSONAL",
      body: "One-on-one coaching with me (not a group) so you get tailored support, not generic content.",
    },
    {
      title: "PREMIUM",
      body: "Exclusive to a limited number of therapists, premium investment = premium results.",
    },
  ],
  stepsHeading: "How to get started today",
  steps: [
    {
      title: "Watch the Free Masterclass",
      body: "See exactly what it takes to build a profitable private practice — without relying on social media, burnout, or guesswork. Learn the step-by-step path to go from clinician to CEO.",
      cta: "Watch Free Masterclass",
    },
    {
      title: "Apply for the 1:1 Package That Best Fits Your Needs",
      body: 'If the masterclass leaves you thinking, "This is exactly what I need," submit your application to work with me privately. We\'ll review where you are, where you want to go, and determine if this high-touch level of service is the right fit.',
      cta: "Work With Me",
    },
    {
      title: "Build Your Business with High-Level Support",
      body: "If accepted, we'll begin your personalized plan with biweekly coaching calls, daily Voxer messaging support, accountability, and your CEO roadmap to start, grow, or expand your practice with clarity and confidence.",
      cta: null,
    },
  ],
  meetYvetteHeading: "MEET YVETTE",
  meetYvetteSubheading: "My Journey to Private Practice Success...",
  meetYvetteBody: [
    "I made so many mistakes when I started my practice.",
    "I began my journey after exhausting myself working countless hours as an associate-level clinician and part-time as a medical social worker.",
    "I saw a critical need for treating patients with chronic pain and illnesses causing medical depression and anxiety, as there were not too many therapists specializing in this area.",
    "Frustrated with minimal raises, denied incentives, and the inability to see the clients I specialized in treating, I decided to take control of my career and start my own private practice.",
  ],
  meetYvetteBlueprint: [
    "The path was far from easy. I spent endless hours figuring out how to start and scale my practice on my own, making numerous mistakes along the way. Eventually, I put everything in order.",
    "As more therapists approached me for advice, I realized I could share my blueprint for success. This led to the creation of the B.O.S.S Blueprint, which is now part of my Profitable Private Practice program.",
    "This blueprint, based on five essential pillars, has guided many therapists from confusion to confidence in starting and growing their practices.",
  ],
  outgrownHeading: 'Feel Like You\'ve Outgrown Just "Being a Therapist"?',
  outgrownBody:
    "You're ready to step into the role of CEO — not just the clinician who works in the business, but the one who leads it. It's time to stop piecing it together on your own and build a practice that actually provides the income, freedom, and fulfillment you envisioned when you first dreamed of private practice.",
  masterclassHeading: "The 4-Step Blueprint to Building a Profitable Private Practice",
  masterclassBody:
    "Get the clarity and strategy you need to start, grow, or expand your practice with confidence. In this masterclass, you'll learn the proven framework therapists use to build sustainable, aligned, and profitable businesses — without the overwhelm or guesswork.",
};

export const about = {
  heading: "Hi, I'm Yvette! I can't wait to help you create your dream private practice and live the life you desire to have.",
  intro:
    "Throughout my career as a LCSW, I've focused on helping people with their mental health, learning a lot along the way. Back in 2018, I started my own therapy practice, but I had no clue what I was doing. I read tons of books and articles, asked for advice on Facebook, and listened to podcasts. It was a process of trial and error, but eventually, I figured things out.",
  storyHeading: "I wasn't supposed to become a therapist.",
  story: [
    'I was supposed to stay in my stable part-time job at a dialysis clinic and work for an agency to see clients. You know, follow the "safe" path, and keep waiting for the right moment to start living my purpose.',
    "But every day, I watched patients sitting hooked up to machines for hours — alone, scared, and emotionally drained — yet no one was tending to the part of them that hurt the most.",
    "They were treated, but they weren't seen.",
    "I didn't know it then, but that's where my real journey began. Not in a textbook. Not in grad school. But in a dialysis center, surrounded by the very real emotional pain that illness, trauma, and life can bring.",
    "What started as a job… awakened a calling.",
  ],
  calling: {
    heading: "I wanted to do more than give patients resources. I wanted to give them relief.",
    body: [
      "Becoming a therapist wasn't just a career shift — it felt like stepping into purpose.",
      "I learned quickly that therapy wasn't just about diagnosis and treatment plans — it was about dignity. About sitting with people in their hardest moments and reminding them of their strength.",
      "But here's something I didn't expect: while I loved the work... I didn't love the system.",
      "The agency hours. The productivity quotas. The endless paperwork. The burnout.",
      "And the heartbreaking truth? I was helping others heal… while slowly abandoning my own.",
    ],
  },
  leap: {
    heading: "So, I took the leap.....nervous, unprepared, and pregnant.",
    body: [
      "In 2019, I left agency and corporate work with no website, no marketing plan, and absolutely no idea how to run a business.",
      "I started my private practice with five clients, a $0 business strategy, and a dream to build something better — for my family, for my future, and for the people I wanted to serve deeply.",
      'I made every mistake you can imagine. I undercharged, overworked, skipped systems, and didn\'t even know what documentation auditors were looking for… until I was audited and nearly lost thousands.',
      'I joked that I was "accidentally running a practice," but behind closed doors — I was praying it would all work out.',
      "And over time… it did.",
    ],
  },
  design: {
    heading: "I stopped running a practice by accident — and started running one by design.",
    body: [
      "The moment everything changed? When I stopped operating as a therapist who happened to have a private practice… …and started leading like a CEO who happened to be a therapist.",
      "That shift created everything I have today:",
    ],
    wins: [
      "A thriving multi-six-figure group practice (Brighter Tomorrow Therapy)",
      "A team of therapists & admin staff I now mentor, support, and lead with heart",
      "A W2 model practice built ethically and sustainably",
      "Systems, workflows, billing, credentialing, compliance, and documentation processes that actually work",
      "The freedom to take maternity leave, work 3 days a week, decrease my caseload, and run my business from anywhere",
      "And eventually — Boss Clinician, LLC — the coaching and consulting company I wish I had when I started",
    ],
  },
  now: {
    heading: "Now, I help therapists build profitable, heart-led private practices — without losing themselves in the process.",
    body: [
      "You're likely here because you're ready to build something of your own.",
      "Not just a practice… A business. A legacy. A life.",
      "You're tired of guessing your way through business decisions. Tired of wondering if you're even doing things \"right.\" Tired of building something that looks successful on paper — but doesn't feel good in real life.",
      "And deep down, you're asking: \"Can I build a practice that is both profitable and purposeful?\" \"Can I make money without abandoning my heart?\" \"Can I actually do this… without burning out?\"",
      "Friend, the answer is yes. You can. And you don't have to do it alone.",
    ],
  },
  coreBeliefs: [
    "Therapists deserve to thrive — not just survive",
    "Profit and purpose can exist in the same space",
    "You don't need social media burnout to run a successful practice",
    "You can build a business that honors your values, your family, and your peace",
    "When therapists rise — entire communities rise",
  ],
  whatIHelp: [
    "A private pay or hybrid practice with consistency, clarity, and confidence",
    "Ethical, scalable systems — credentialing, billing, compliance, documentation, workflows",
    "Sustainable revenue — priced correctly, structured intentionally, protected legally",
    "Leadership identity — moving from therapist to CEO, mentor, and eventually employer",
    "A business that supports your life — not the other way around",
  ],
  personal: {
    heading: "A little personal — because therapists are humans, too.",
    body: "I'm a mom. A business owner. A leader. A therapist. A coach. A doctoral student. And a woman who — just like you — wanted more freedom, fulfillment, and purpose. When I'm not mentoring therapists or leading my team, you'll find me sipping iced chai tea, planning my next retreat, dancing with my son in the kitchen, or reminding other women that they are capable of so much more than they've been told.",
  },
};

export const workWithMe = {
  eyebrow: "Private Practice Strategy for Clinicians",
  heading: "Built to heal others.",
  subheading: "Now let's build something that sustains you.",
  intro:
    "You've done everything right. Now it's time to build a practice that works for your life — not the other way around. Let's see if we're a fit.",
  storyQuote: '"I know this season because I lived it."',
  storyDetail:
    '"My days used to look like 25+ sessions, a full day at the dialysis center, bedtime routines, and late-night note taking — because it was the only time I had."',
  story: [
    "I didn't grow up seeing therapy, private practice, or entrepreneurship modeled. I learned everything the hard way — juggling agency work, PRN shifts, motherhood, and clinical hours while trying to build something bigger for my family and myself.",
    "I was completely drained. Billing errors, insurance headaches, audits, DIY-ing a business with no roadmap and no one in my corner who truly understood both the clinical world and the business side of it.",
    "So I made changes. I invested in real support. I built systems. I raised my rates. I created boundaries. I stepped into leadership. I went from agency burnout to a six-figure solo practice — and then expanded into a thriving group practice, all while working on my doctorate and raising a family.",
  ],
  storyClose:
    '"Now I help clinicians do the same — without sacrificing their mental health, their identity, or their joy in the process."',
  credentials: ["LCSW", "Private Practice Strategist", "Group Practice Owner"],
  painHeading: "You did everything they told you to do. And you're still exhausted.",
  painIntro:
    "You got licensed. Built your practice. Paneled with insurances. Set up your Psychology Today profile. Invested in trainings, certifications, and marketing. And yet — something still isn't working the way it should.",
  painPoints: [
    {
      number: "01",
      title: "You're seeing 25+ clients a week",
      body: "Back-to-back sessions plus admin and billing tasks are draining you and you feel like the only way to earn more is to see more clients — but your body and your mind are telling you otherwise.",
    },
    {
      number: "02",
      title: "Your income is inconsistent",
      body: "Some months feel okay. Others are terrifying. You don't know where your next client is coming from or when the next slow period will hit.",
    },
    {
      number: "03",
      title: "You can't take a real vacation",
      body: "If you stop working, the business stops too. There's no system, no team structure, nothing running without you — and that's not sustainable.",
    },
    {
      number: "04",
      title: "You're ready for more but don't know where to start",
      body: "Cash pay clients, group practice, scaling, hiring — you've seen it all on social media but you don't have a clear strategy that actually fits your practice.",
    },
  ],
  readyHeading: "This work is for the clinician who is ready — not just curious.",
  readyYes: [
    "You're already generating income and ready to build something sustainable around it",
    "You're done trading time for money and want income that doesn't depend on your calendar being full",
    "You understand that real growth requires real investment — and you've proven that to yourself before",
    "You want to lead your practice with confidence and step fully into your CEO identity",
    "You're coachable, action-driven, and willing to do the work between sessions",
    "You believe you deserve to charge rates that reflect your true expertise",
  ],
  readyNo: [
    "You're still working toward licensure and need foundational clinical support",
    "You want someone to build your practice for you rather than partner with you in building it",
    "You're looking for a quick fix without the reflection and implementation required for real transformation",
    "You want someone to make every decision for you rather than developing your own leadership identity",
    "You're not yet ready to fully commit — financially, mentally, or energetically",
  ],
  partnershipHeading: "This isn't hourly consulting. It's a strategic partnership.",
  partnershipBody:
    "Most coaching in this space is transactional — buy an hour, ask a question, hope it sticks. My work is different. Before we even begin, you'll complete a Practice Clarity Assessment that most clinicians have never done on themselves. Then we build a strategy that matches exactly where you are, where you're going, and what your practice actually needs — and we walk through it together for 3, 6, or 12 months with structure, support, and real accountability.",
  comparison: {
    hourly: [
      "Pay per hour, get per hour",
      "Reactive — you ask, they answer",
      "No structured onboarding",
      "Generic advice that may not fit your practice",
      "You leave with notes and hope something sticks",
      "Transactional",
    ],
    bossClinician: [
      "Defined 3, 6, or 12 month arc with clear milestones",
      "Proactive — strategy built around where you actually are",
      "CEO Baseline Audit before work begins",
      "Personalized strategy built around your specific season",
      "You leave with a plan, accountability, and ongoing support",
      "Transformational",
    ],
  },
  introducing: "STOP SURVIVING YOUR PRACTICE. START RUNNING IT LIKE A BOSS.",
  introducingBody:
    "You built your practice for freedom — financial freedom, time freedom, and the ability to show up for your clients and your family without running on empty. But somewhere along the way the dream started feeling more like a second job. We guide you step by step through how to:",
  guideList: [
    "Remove the guesswork and know exactly what to do next",
    "Build consistent, predictable revenue every month",
    "Raise your rates and get paid so you are actually living your dreams",
    "Attract ideal clients without burning out on marketing",
    "Build systems so your practice runs smoothly even when you step away",
    "Transition from solo practitioner to confident CEO",
    "Work less, earn more, and reclaim your time",
    "Create income that goes beyond the therapy hour",
  ],
  pathways: [
    {
      label: "PATHWAY A",
      title: "Build Your Foundation",
      badge: null,
      body: "You took the leap. You built something from nothing — got licensed, set up your profile, started seeing clients, and figured it out as you went. But now you're hitting a wall. This pathway is designed to give you the clarity, structure, and strategy foundation you need to stop surviving and start growing with a real plan.",
      milestones: [
        { title: "Clarify Your Ideal Client", body: "Get crystal clear on who you serve so every marketing decision becomes easier" },
        { title: "Build Your Signature Offer", body: "Package your services with pricing that reflects your expertise and attracts the right clients" },
        { title: "Optimize Your Online Presence", body: "Update your Psychology Today, website, and bio so visitors become booked consultations" },
        { title: "Create a Marketing Strategy", body: "Build a repeatable system that generates steady inquiries without being online 24/7" },
        { title: "Establish Business Systems", body: "Set up foundational systems and documentation that protect and professionalize your practice" },
        { title: "Step Into Your CEO Identity", body: "Make strategic decisions and lead your practice with clarity and confidence" },
      ],
    },
    {
      label: "PATHWAY B",
      title: "Scale Without Burning Out",
      badge: "MOST POPULAR",
      body: "You've proven you can build a practice. But a different kind of exhaustion has set in. You don't need to grind harder. You need a smarter strategy — one that builds consistent revenue, attracts cash pay clients, and grows without requiring more than you have left to give.",
      milestones: [
        { title: "Income Audit and Stabilization", body: "Identify where your income is leaking and build a plan for consistent monthly revenue" },
        { title: "Cash Pay Client Strategy", body: "Attract and convert private pay clients to reduce insurance dependency and increase take-home" },
        { title: "Raise Your Rates Confidently", body: "Develop premium pricing and communicate your value so the right clients say yes" },
        { title: "Build a Referral Pipeline", body: "Create a sustainable referral and visibility strategy that generates consistent inquiries" },
        { title: "Diversify Beyond the Session", body: "Build revenue streams that generate income without adding more clinical hours to your week" },
        { title: "Create Systems That Run Without You", body: "Build the workflows and boundaries that let your practice function when you step away" },
      ],
    },
    {
      label: "PATHWAY C",
      title: "Lead, Hire & Build Your Legacy",
      badge: null,
      body: "You built something real. But the complexity has grown faster than your systems. This pathway is for the clinician ready to stop working in their practice and start working on it — building the leadership, systems, and financial strategy of a true CEO.",
      milestones: [
        { title: "CEO Identity and Leadership", body: "Make high-level decisions and lead your team with confidence instead of exhaustion" },
        { title: "Hiring Strategy and Team Structure", body: "Build a sustainable hiring plan from job descriptions to onboarding and training" },
        { title: "1099 to W2 Transition", body: "Navigate IRS requirements and pay structure changes to protect your practice from liability" },
        { title: "Systems and Infrastructure", body: "Build the protocols and workflows that let your practice run consistently without you in every room" },
        { title: "Financial Strategy and Owner Pay", body: "Create a financial model that pays you a real salary and builds toward multi-six figure revenue" },
        { title: "Advanced Revenue Streams", body: "Expand beyond clinical sessions with consulting, training, and supervision that grow your impact and income" },
      ],
    },
  ],
  offers: [
    {
      name: "Practice Reset Intensive",
      duration: "3 Months",
      features: [
        "6 private strategy sessions (50 minutes each)",
        "Full audit of your current practice — income, clients, and systems",
        "Clarity on your ideal client and niche positioning",
        "Pricing strategy and signature offer development",
        "Psychology Today and website positioning support",
        "Daily Voxer access for real-time support between sessions",
        "Templates, scripts, and resources as needed",
        "Psychology Today profile — fully rewritten for you",
        "Personalized website audit with a custom template",
        "Video bio script written for you",
      ],
    },
    {
      name: "Scale and Reclaim Suite",
      duration: "6 Months",
      features: [
        "12 private strategy sessions (50 minutes each)",
        "Complete practice audit and rebuild roadmap",
        "Consistent client flow and referral pipeline strategy",
        "Income stabilization and cash pay client strategy",
        "Marketing strategy and visibility planning",
        "Offer structuring and premium pricing support",
        "Priority Voxer access — voice and text messaging",
        "Templates, systems, and CEO decision-making support",
        "Psychology Today profile — fully rewritten for you",
        "Marketing materials review and edit",
        "Custom referral template built for your specific niche",
      ],
    },
    {
      name: "Boss Boardroom",
      duration: "12 Months",
      features: [
        "24 private strategy sessions (50 minutes each)",
        "Quarterly 90-day CEO planning and practice audit",
        "Full scaling strategy — hiring, team structure, group practice",
        "W2 vs 1099 transition support and systems buildout",
        "Advanced income strategy and multiple revenue streams",
        "Leadership identity and CEO confidence coaching",
        "Priority Voxer access — voice and text messaging",
        "Insurance credentialing handled entirely by admin team",
        "Psychology Today profile — fully rewritten for you",
        "Full website audit — custom template provided",
        "Hiring documents and job description templates",
        "Written 90 day action plan delivered after each audit session",
      ],
    },
  ],
  policies: [
    {
      title: "PAYMENT PLANS",
      body: "Available for all packages. No interest. No credit checks. Just support that meets you where you are.",
    },
    {
      title: "REFUND POLICY",
      body: "No refunds. When you enter this partnership we are both fully committed to the process and to your transformation.",
    },
    {
      title: "SCHEDULING",
      body: "Once payment is made you'll receive onboarding instructions, portal access, and your first session scheduling link.",
    },
  ],
  process: [
    {
      title: "Apply and schedule your clarity call",
      body: "Fill out a short application so I can understand where you are and what you're building. If we're a strong fit I'll reach out to schedule a complimentary strategy call.",
    },
    {
      title: "Choose your offer and onboard",
      body: "Once we agree on the right container for your goals, you'll receive onboarding instructions, portal access, and your session scheduling link. We get to work immediately.",
    },
    {
      title: "We meet every other week — just you and me",
      body: "Bi-weekly private strategy sessions with full focus on your goals, your decisions, and your next moves as a CEO. No generic advice. No cookie-cutter roadmaps.",
    },
    {
      title: "Access me daily between sessions",
      body: "Clarity doesn't always happen on session days. Use Voxer to ask questions, get feedback, talk through decisions, and get unstuck in real time.",
    },
    {
      title: "Build, implement, and grow",
      body: "You won't just leave sessions inspired — you'll leave with a clear plan and the accountability to execute it. We track your progress, adjust your strategy, and celebrate every win.",
    },
  ],
  faqs: [
    {
      q: "Is this coaching or consulting?",
      a: "It's both — and that's intentional. I bring the expertise and direction of a consultant combined with the accountability and support of a coach. I don't just ask questions — I tell you what I see, what needs to change, and how to get there. You bring the commitment and do the work.",
    },
    {
      q: "What results can I expect?",
      a: "Clients typically walk away with a clear marketing strategy, raised rates, packaged offers, and a path to consistent monthly income without seeing 25+ clients a week. Results depend heavily on your commitment to implementation.",
    },
    {
      q: "Who is Yvette?",
      a: "I'm not just a business coach — I'm a licensed clinician who has built a six-figure solo practice and a group practice from the ground up. I understand the clinical world, the insurance landscape, the cultural nuances, and the emotional weight of this work.",
    },
    {
      q: "Is Boss Boardroom right for group practices?",
      a: "Yes — the 12 Month Private Practice Strategy Partnership is specifically designed for clinicians who are scaling into or already running a group practice and need advanced support with hiring, team structure, W2 transitions, systems, and sustainable leadership.",
    },
    {
      q: "Do you work with clinicians beyond therapists?",
      a: "Yes. While my primary focus is therapists and counselors, I also work with nurse practitioners, occupational therapists, dietitians, and other healthcare professionals building private practices.",
    },
    {
      q: "What's your refund policy?",
      a: "There are no refunds. Private strategy work requires deep commitment, energy, and full presence from both of us. When you enter this partnership you are committing to the process — and I am committing fully to you.",
    },
  ],
  testimonialQuotes: [
    {
      quote:
        "Yvette helped me launch my private practice while I was still working my full-time job and within a few weeks, I was already seeing clients and bringing in consistent extra income.",
      name: "Kristan L., LCSW",
    },
    {
      quote:
        "Once I got clear on my pricing and structure, I felt like a true CEO. Everything became easier. The clarity alone was worth every penny.",
      name: "Sharon S., LPC",
    },
    {
      quote:
        "Yvette provided resources for my internal dilemmas, support with video playbacks, and accountability, every step of the way she showed up fully for me.",
      name: "Michael M., LPC",
    },
    {
      quote:
        "I went from doing everything on my own and feeling overwhelmed… to hiring clinicians, implementing systems, and leading a practice that actually feels sustainable.",
      name: "Saritha F., LCSW",
    },
  ],
  closing: {
    heading: "You didn't come this far to stay burnt out and underpaid.",
    body: "Spots are intentionally limited to keep every engagement high-touch and deeply personalized. If you're ready to stop surviving your practice and start running it like a Boss — apply now.",
    footnote: "Spots are limited · High-touch and personalized · All healthcare clinicians welcome",
  },
};

export const applyPage = {
  heading: "Are you ready to stop surviving your practice and start building one that truly supports you?",
  intro:
    "I help therapists at every stage — from starting to scaling — build structured, profitable practices that attract aligned clients and support long-term growth.",
  greeting: "HEY MY THERAPIST FRIEND!",
  body: [
    "👋 Welcome — I'm so glad you're here.",
    "The fact that you're reading this tells me something important: you're ready for more. More clarity, more confidence, more structure, more ownership of your practice… and more ease in building it.",
    "This isn't just another coaching application. This is the first honest step toward building the private practice you keep envisioning — the one that pays you well, fits your life, and lets you lead with purpose (not hustle and burnout).",
    "I take on a limited number of clinicians at a time — because this isn't surface-level coaching. It's deep, strategic, personal, and tailored to your goals, your vision, and the business you want to grow.",
    "So please take your time as you complete this form. Your answers help me understand where you are now, where you want to be, and whether I'm the right coach to help you get there.",
    "I review every application myself and you'll hear back from me within 24 hours.",
    "If you're ready to move from clinician to Boss Clinician — you're in the right place.",
  ],
  cta: "LET'S BEGIN YOUR JOURNEY.",
};

/**
 * bossclinician.com/contact as of 18 September 2026, block for block and in the
 * source's wording. Two addresses, as on the source: `email` for general
 * questions, `supportEmail` for access, billing and "where do I belong".
 *
 * One passage is adapted rather than copied: the source's cancellation steps
 * walk through Kajabi's account menu ("tap your circle profile photo … Settings
 * … Billing … Cancel"), which does not exist here. `billing.body` keeps the
 * source's sentence and names this app's own Billing screen instead.
 */
export const contactPage = {
  heading: "Hey there — how can we help?",
  intro:
    "Whether you have a question about a Boss Clinician program, need help accessing something you purchased, or want to figure out which space is right for you, you’re in the right place.",
  emailLabel: "For general questions, email:",
  email: "yvette@bossclinician.com",
  supportEmail: "support@bossclinician.com",
  programs: {
    title: "Not sure which Boss Clinician program is right for you?",
    body: "Boss Clinician supports therapists through different seasons of private-practice ownership.",
    items: [
      {
        title: "The Club — Build It",
        body: "For therapists who are still building the foundation of their private practice, working toward consistent clients, and creating a business they won’t have to undo later.",
        bestFit: "Best fit if: your biggest question is still, “How do I build this and get it working?”",
        cta: "LEARN ABOUT THE CLUB",
        to: "/club",
      },
      {
        title: "The Lounge — Sustain It",
        body: "For established clinicians whose practice is already working — but requires more time, energy, or clinical output than they want to maintain long-term.",
        bestFit:
          "Best fit if: you’re full or nearly full and asking, “How do I make the practice I already built work better for my life?”",
        cta: "LEARN ABOUT THE LOUNGE",
        to: "/lounge",
      },
      {
        title: "The Boardroom — Lead It",
        body: "For practice owners who are moving beyond themselves and need support around leadership, team development, systems, and building a business that can grow without everything depending on them.",
        bestFit:
          "Best fit if: you’re asking, “How do I lead this business well as it grows beyond me?”",
        cta: "LEARN ABOUT THE BOARDROOM",
        // No Boardroom page yet; /boardroom redirects here too (migration 064).
        to: "/work-with-me",
      },
    ],
    closing: "Build it. Sustain it. Lead it. Leave it on your terms.",
  },
  access: {
    title: "I need help accessing something I purchased",
    intro:
      "If you purchased a Boss Clinician course, training, membership, or resource and can’t log in, start here:",
    steps: [
      {
        title: "Check the email address you used when purchasing.",
        body: "Sometimes a different email address was used at checkout.",
      },
      {
        title: "Check your spam, promotions, and junk folders.",
        body: "Your purchase confirmation or login information may be there.",
      },
      {
        title: "Reset your password.",
        body: "Visit the Boss Clinician login page and select Forgot Password.",
      },
      {
        title: "Still can’t get in?",
        // The source's fourth step is the address and the list that follow it.
        body: "",
      },
    ],
    emailLead: "Email:",
    emailWith: "with:",
    include: [
      "your full name",
      "the product or program you purchased",
      "the email address you believe you used",
      "the approximate date of purchase",
    ],
    outro: "We’ll help you get it sorted out.",
  },
  billing: {
    title: "I need help with billing or my membership",
    body: "If you'd like to cancel your subscription membership to the Boss Clinician Lounge membership, you can do this by logging into your account, opening Billing, and selecting Cancel.",
    cta: "Go to Billing",
  },
  retreat: {
    title: "I’m interested in a retreat or event",
    body: "Boss Clinician also hosts curated retreat experiences for healthcare and wellness professionals.",
    lead: "Our next international retreat is planned for:",
    date: "Bali — June 15–20, 2027",
    cta: "LEARN ABOUT THE BALI RETREAT",
  },
  closing: {
    title: "I still have a question",
    body: "If you’re unsure where you belong or just need help, email:",
    outro: "We’ll point you in the right direction.",
  },
  body: "Currently, Yvette offers private practice coaching through her Profitable Private Practice group programs. This is her high-touch coaching program, and the best way to get personal access to her for help with starting, scaling, and expanding your practice.",
};

export const legalPrivacy = {
  updated: "Updated 05/20/2024",
  paragraphs: [
    "Introduction and Summary. We want to make it easy for you to understand what information we collect from you, what we do with it, and how you can request access to this information. We believe this is a best practice to maintain transparency and trust with our website visitors and clients. If you have questions about this policy, you can contact us at yvette@bossclinician.com.",
    "We collect as little information from you as possible for a specific and identifiable purpose, and then we commit to using this information only in the way we have specified. When you visit this site, you are agreeing to this Privacy Policy, the collection of information identified in this policy, and you always have the ability to opt out.",
    "What Personal Information We Collect and When. We collect information so that we can make our products and services better tailored to the people who visit our site and do business with us: to deliver products and services you have purchased from us, to notify you about offerings you may be interested in (with consent), and to keep track of visitor information for analytics.",
    "When you contact us with questions or comments, comment on a post, request more information, sign up to the newsletter, or place an order for products or services, we collect that information directly from you.",
    "When we contact you, it is to provide the goods and services you requested, to request occasional feedback, or to provide news, updates, and offers through the newsletter.",
    "We may see certain personal information from third-party apps and services that allow us to complete your order, remarket our services, monitor website traffic, or process payments (e.g. PayPal). For EU residents, please note this may mean we transmit your data across international borders.",
    "Your Privacy Controls. We use third-party services such as Google Analytics to assist in communicating with the public. You can configure your browser to delete or disable cookies. This site uses single and multi-session cookies to enhance the visitor experience and does not sell or share its email list for use by third parties.",
    "Keeping Your Information Secure. We store personal information with third parties that use industry standard practices for data security.",
    "Your Rights to Your Information. You have the right to withdraw consent, request a copy of your information, be forgotten, correct inaccurate information, object to direct marketing and profiling, and make complaints to regulatory authorities. We will comply with these requests within 30 days.",
    "Compliance. We make commercially reasonable efforts to work with data controllers who guarantee compliance with privacy laws like the EU's GDPR. We store your personal information only for as long as needed for the reasons you have consented to.",
    "Our data protection officer is Yvette Howard, at yvette@bossclinician.com.",
  ],
};

export const legalTerms = {
  updated: "Updated 5/19/2025",
  paragraphs: [
    "This is a binding legal contract. Please read it in full. Welcome to Boss Clinician, Profitable Private Practice. This page is made available to you on the following conditions, and you consent to these terms by continuing to use the site.",
    "Sometimes, you will be subject to additional terms and conditions, such as when you purchase something, or disclaimers which may appear on the site. To learn how we handle information that we learn about visitors to our site, please visit our Privacy Policy page.",
    "Electronic Communications. You consent to receive communications from us electronically and agree that any notices or disclosures we are required to provide to you now or in the future may be provided in electronic form.",
    "Our Copyrights. The content on this site, including text, images, custom software, compilations of resources, and audio and video content, is the sole and exclusive property of Boss Clinician and protected by United States and international copyright laws.",
    "Our Trademarks. Logos, slogans and catchphrases, design aspects of the site, icons, scripts, and service names are trademarks of Boss Clinician and protected by U.S. law.",
    "Access Restrictions. You are permitted to use the site for personal and non-commercial use. You cannot resell or make other commercial use of any content on this site.",
    "Copyright Issues. If you feel we have infringed upon your copyrights, please contact us at yvette@bossclinician.com. We will promptly investigate the matter.",
    "Other Parties' Information. Occasionally, we will post about, or allow other parties to post about, information and services provided by companies other than Boss Clinician. We do not warrant the offerings of these companies.",
    'Disclaimer of Warranties; Use at Your Own Risk. The information and content made available to you on the site is provided "as is" and "as available." We make no representations or warranties of any kind, express or implied.',
    "Governing Law. By using the site, you agree that any dispute related to these terms will be governed by the laws of the state of Nevada, and you agree to submit to personal jurisdiction of Nevada.",
    "Amendments and Other Matters. We may make changes to the site, our offerings or information, and these terms at any time and without prior notice. By using this site, you certify that you are over the age of eighteen.",
  ],
};

export const legalDisclaimer = {
  paragraphs: [
    "Any case studies, examples, illustrations, or testimonials cannot guarantee that you will achieve similar results. In fact, your results may vary significantly and factors such as your personal effort and many other circumstances may and will cause results to vary.",
    "Any and all claims or representations as to income earnings on the site are not to be considered as average earnings. There can be no assurance that any prior successes, or past results, as to income earnings, can be used as an indication of your future success or results.",
    "Monetary and income results are based on many factors. We have no way of knowing how well you will do, as we do not know you, your background, your work ethic, or your business skills or practices. Therefore, we do not guarantee or imply that you will get rich, that you will do as well, or that you will make any money at all.",
    "If you rely upon figures provided on the site, you must accept the risk of not doing as well — just as you would with any program you join.",
  ],
};

export const legalFinancialDisclaimer = {
  paragraphs: [
    "The site exists for educational purposes only, and the materials and information contained therein are for general informational purposes only. Neither Boss Clinician nor its owners, officers, directors, employees, subsidiaries, affiliates, licensors, service providers, content providers and agents are financial advisors, or an investment advisory service, and nothing contained in the site is intended to be or to be construed as financial advice, or legal, compliance, financial, tax, accounting or related advice.",
    "The information contained on the site is based on sources and information reasonably believed to be accurate as of the time it was recorded or created. However, this material deals with topics that are constantly changing and are subject to ongoing changes related to technology, the marketplace, and legal and related compliance issues. Therefore, the completeness and current accuracy of the information cannot be guaranteed.",
    "The education and information presented on the site is intended for a general audience and does not purport to be, nor should it be construed as, specific advice tailored to any individual. When appropriate, you should consult your own legal, accounting, or other advisors.",
    "Your use of the information contained herein is at your own risk. It is your responsibility to evaluate the accuracy, completeness or usefulness of any information, opinion, advice or other content contained in the site. You will seek the advice of professionals, as appropriate, regarding the evaluation of any specific information, opinion, advice, or other content.",
  ],
};
