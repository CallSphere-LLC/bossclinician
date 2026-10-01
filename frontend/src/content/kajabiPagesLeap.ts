/**
 * Copy for the Profitable Private Practice Leap Accelerator sales page and its
 * thank-you page, verbatim from bossclinician.com/profitable-private-practice-
 * leap-accelerator and /leap-accelerator-thank-you (fetched 1 Oct 2026).
 *
 * Inline emphasis is marked with `**…**` exactly where the source set <strong>,
 * and rendered by `RichText` in the page. Two live-copy slips are kept as
 * published rather than silently corrected: the hero's "$ $997" and the third
 * FAQ answer, which Kajabi prints twice.
 *
 * Neither tier has an offer on this site (the only related row, the archived
 * `ppp-collective`, is priced at $3,997, not the $2,997 quoted here), so both
 * buy buttons go to the application page rather than to a checkout that would
 * charge a different price — see `LEAP_ENROL_PATH`.
 */

const IMG = "/images/kajabi-pages/leap-accelerator";

/** Where both tiers' buy buttons go until an offer exists for them. */
export const LEAP_ENROL_PATH = "/apply";

/** The in-page anchor every "Join Now" / "Get Started" button scrolls to. */
export const LEAP_TIERS_ID = "leap-tiers";
/** The Boss Builders Collective teaser band. */
export const LEAP_SCALE_ID = "leap-scale";

export const leapAccelerator = {
  seo: {
    title: "Profitable Private Practice Leap Accelerator",
    description:
      "Your Roadmap to Freedom, Flexibility, and Financial Stability Your Own Thriving Business. Take the Leap Today! The first round of members gets locked in at $357 for 3 months or $ $997 PIF for 12 weeks of support. This price will increase to $1497 soon! Don’t wait!",
    image: `${IMG}/og-leap-accelerator.jpg`,
  },

  /** The sticky announcement bar Kajabi ran above the page. */
  announcement: "Take the Leap Today for Just $997!",

  hero: {
    title: "Profitable Private Practice Leap Accelerator",
    subtitleLines: [
      "Your Roadmap to Freedom, Flexibility, and Financial Stability",
      "Your Own Thriving Business.",
    ],
    note: "Take the Leap Today! The first round of members gets locked in at $357 for 3 months or $ $997 PIF for 12 weeks of support. This price will increase to $1497 soon! Don’t wait!",
    cta: "Join Now for Only $997! →",
    image: { src: `${IMG}/yvette-standing.webp`, alt: "Yvette Howard, LCSW" },
  },

  ready: {
    title: "Are You Ready to Leave Your 9-5 and Build a Thriving Therapy Business?",
    body: "**You’ve spent years developing your skills as a mental health provider.** But running your own therapy business feels overwhelming. The fear of losing a steady paycheck, struggling to attract clients, and managing a business holds many therapists back. That ends today. **The Profitable Private Practice Leap Accelerator** helps mental health providers escape burnout and take control of their future—without stress or confusion. This academy provides the **step-by-step roadmap** to successfully transition from your **9-5 job** into a thriving private practice, **giving you the freedom, flexibility, and financial stability you deserve.**",
    image: { src: `${IMG}/yvette-writing.jpg`, alt: "Yvette Howard writing in a planner" },
  },

  why: {
    title: "Why the Profitable Private Practice Leap Accelerator is",
    titleAccent: "Your Path to Success",
    paragraphs: [
      "**This is where clarity replaces confusion, fear is transformed into confidence,** and your vision of an independent, thriving therapy business becomes a reality.",
      "**This Accelerator won’t overwhelm you** with business jargon or rigid formulas. **Instead, it gives you confidence, clarity, and community to thrive.**",
    ],
    points: [
      { lead: "Guided Transition from 9-5 to Private Practice:", body: "A structured approach that ensures a smooth and strategic move into self-employment." },
      { lead: "Mindset Mastery & Confidence Building:", body: "Learn how to shift from an employee mindset to a thriving business owner mentality." },
      { lead: "Sustainable Business Strategies:", body: "Avoid the common mistakes that lead to burnout by implementing proven, therapist-friendly strategies." },
      { lead: "Real-World, Actionable Support:", body: "This isn’t theoretical fluff; everything you learn is designed to be practical and applicable from day one." },
      { lead: "A Nurturing, Judgment-Free Community:", body: "You’re not alone in this journey. Surround yourself with others who understand the challenges and triumphs of running your own business." },
      { lead: "A Focus on Flexibility & Freedom:", body: "Your business should work for you, not the other way around. Learn how to structure it in a way that supports your lifestyle and long-term success." },
    ],
  },

  future: {
    title: "Your Future with the Profitable Private Practice Leap Accelerator",
    kicker: "IMAGINE WAKING UP EACH MORNING KNOWING THAT YOU’RE IN COMPLETE CONTROL OF YOUR CAREER.",
    intro: "No more overwhelming caseloads, no more agency politics, and no more sacrificing your mental and physical health just to make ends meet.",
    lead: "Instead, picture a practice where:",
    items: [
      { title: "You Choose Your Clients", body: "Work with individuals who align with your passion and expertise.", icon: `${IMG}/icon-choose-clients.png` },
      { title: "You Reach Financial Stability", body: "Earn more than you did in your agency job while working fewer hours.", icon: `${IMG}/icon-financial-stability.png` },
      { title: "You Build Your Legacy", body: "Create a business that grows with you, allowing you to scale, hire, or even expand into coaching or consulting.", icon: `${IMG}/icon-build-legacy.png` },
      { title: "More Time for What Matters", body: "Whether it’s spending time with your family, traveling, or prioritizing self-care, this academy helps you build a practice that gives back to your life—not one that takes over it.", icon: `${IMG}/icon-more-time.png` },
    ],
    closing: "What if your career gave you more than a paycheck? Envision a life with purpose, autonomy, and financial freedom. **The Profitable Private Practice Leap Accelerator** helps you turn that vision into reality—one confident step at a time.",
  },

  founder: {
    eyebrow: "Meet the Mind Behind the Program",
    title: "Hi, I’m Yvette Howard",
    paragraphs: [
      "— a Licensed Clinical Social Worker, business coach, and private practice owner.",
      "I know what it feels like to question whether stepping away from a 9-5 is possible. In 2018, I took that leap myself, unsure if I could replace my full-time income, find consistent clients, or build something sustainable.",
      "Through real-world experience, I discovered what works—and, more importantly, what doesn’t. I built a thriving, scalable business, expanded my team, and achieved the financial and time freedom I once thought was out of reach.",
      "But this journey wasn’t just about my success. It became about paving the way for others who are ready to step into business ownership with confidence.",
      "That’s why I created **Profitable Private Practice Business Leap Accelerator** —so you don’t have to navigate this transition alone. You deserve a clear roadmap, a proven system, and a community that supports you.",
      "You don’t have to stay stuck in burnout and uncertainty. Your vision is possible, and I’m here to help you build it.",
    ],
    cta: { label: "Click to Know More About Me →", to: "/about" },
    image: { src: `${IMG}/yvette-portrait.jpg`, alt: "Yvette Howard, LCSW, holding a Business Coach mug" },
  },

  breaking: {
    title: "Breaking Through to Your Dream Practice",
    intro: "You know you’re meant for more—more freedom, more impact, and more financial security. But something keeps standing in the way of making your dream practice a reality.",
    lead: "If you’ve ever felt stuck in the following ways, you’re not alone:",
    points: [
      { lead: "Clarity on Where to Start", body: "Instead of feeling lost in a sea of conflicting advice, you’ll have a clear, structured plan to launch and grow your independent therapy business step by step." },
      { lead: "Financial Security Without Fear", body: "We’ll help you transition with confidence so you can replace (and exceed) your full-time income while creating long-term stability." },
      { lead: "Business & Marketing Made Simple", body: "You’ll gain a roadmap to attract your ideal clients, set sustainable pricing, and build a thriving practice—without being overwhelmed." },
      { lead: "Confidence in Your Success", body: "Shift from self-doubt to self-trust, knowing you have the right guidance, tools, and support to succeed as a business owner." },
      { lead: "Freedom from Burnout", body: "Design a work-life balance that works for you – whether that means fewer clients, higher pay, or the ability to structure your time as you choose." },
    ],
    closing:
      "That’s where the **Profitable Private Practice Leap Accelerator** comes in—to turn these challenges into stepping stones, providing you with the tools, strategies, and support to step into full-time entrepreneurship with confidence, **knowing you have a solid foundation for long-term growth.** Your dream private practice starts today. **Join now and gain instant access to expert guidance, a supportive community, and the resources you need to make this transition with confidence.**",
    cta: "Get Started Now for Only $997 →",
    image: { src: `${IMG}/stressed-at-work.jpg`, alt: "A therapist at her desk, head in hand, surrounded by paperwork" },
  },

  blueprint: {
    title: "The Profitable Private Practice Blueprint",
    intro: "You don’t have to grow your career without guidance. **The Profitable Private Practice Leap Accelerator** provides the structure, support, and tools you need to build a business that feels aligned, profitable, and sustainable.",
    items: [
      { title: "BOSS Blueprint: The Course", body: "A step-by-step system designed to take you from uncertainty to running a profitable, independent therapy business. You’ll gain the tools to establish your brand, attract the right clients, and create long-term financial stability." },
      { title: "The Leap Accelerator Community", body: "A private space to connect with fellow therapists, ask questions, and gain accountability while building your practice." },
      { title: "Marketing & Multiple Income Strategies", body: "Learn how to attract and retain ideal clients while creating additional revenue streams through workshops, speaking engagements, consulting, and digital offers—ensuring long-term financial stability." },
      { title: "Financial & Pricing Optimization", body: "Set sustainable rates, forecast revenue, and create a financial plan that supports your lifestyle and growth." },
      { title: "Essential Business Templates & Scripts", body: "Done-for-you intake forms, pricing calculators, email templates, and client management resources to streamline your operations." },
      { title: "Business Setup & Structure", body: "Learn how to legally set up your practice, create systems, and structure your pricing for long-term sustainability." },
      { title: "Live Q&A and Expert Coaching", body: "Weekly coaching sessions to provide direct support, answer pressing questions, and keep you on track." },
    ],
    closing: "This accelerator is your shortcut to success— without the overwhelm.",
  },

  scale: {
    title: "Looking to Scale Even Further?",
    paragraphs: [
      "If you know you're not here just to start —you're here to scale, grow, and create freedom beyond the therapy room—then **The Boss Builders Collective** was made for you.",
      "This advanced tier is for the therapist who’s ready to automate more, market smarter, and expand their income without burnout. You’ve built the foundation—now it’s time to build the business.",
    ],
    investmentLabel: "Your investment",
    investment: "$2,997 Pay in Full or 6 Monthly Payments of $547",
    cta: "Learn More & Join The Collective →",
  },

  tiers: {
    title: "Designed for Accessibility and Growth",
    intro: "A step-by-step system designed to take you from uncertainty to running a profitable, independent therapy business. You’ll gain the tools to establish your brand, attract the right clients, and create long-term financial stability.",
    lead: "Here’s What You Get Inside:",
    tier1: {
      eyebrow: "Tier 1:",
      title: "Profitable Private Practice Leap Accelerator",
      points: [
        { lead: "Comprehensive Business Training – ", body: "A step-by-step roadmap guiding you through business setup, pricing, and financial stability." },
        { lead: "Marketing & Client Attraction Strategies – ", body: "Proven frameworks to bring in ideal clients consistently, without uncertainty." },
        { lead: "Private Community & Support – ", body: "Surround yourself with a network of like-minded therapists for guidance and accountability." },
        { lead: "Exclusive Resources & Templates – ", body: "Done-for-you scripts, checklists, and foundational tools to streamline your practice setup." },
        { lead: "Live Coaching & Mentorship – ", body: "Direct access to expert coaching, ensuring you stay on track with your goals." },
        { lead: "Mindset & Confidence Shifts – ", body: "Learn how to move past self-doubt and embrace the role of a confident business owner." },
      ],
      bonusesTitle: "⭐Bonuses Included:",
      bonuses: [
        { lead: "Business Setup Checklist", body: "($197 Value)" },
        { lead: "Pricing Formula Cheat Sheet", body: "($97 Value)" },
        { lead: "Mindset Mastery Audio Series", body: "($47 Value)" },
        { lead: "Content Calendar Template", body: "($97 Value)" },
        { lead: "Practice Naming Guide", body: "($47 Value)" },
        { lead: "Email & Referral Scripts", body: "($97 Value)" },
        { lead: "Lead Magnet Creation Template", body: "($97 Value)" },
      ],
      totalValue: "Total Value: Over $1,500",
      investment: "$997 Pay in Full or 3 Monthly Payments of $357",
      cta: "Let's Lock In My Spot! →",
    },
    tier2: {
      eyebrow: "Tier 2:",
      title: "The Boss Builders Collective",
      kicker: "For the therapist ready to grow beyond 1:1 services and scale sustainably.",
      body: "This high-level hybrid experience is designed to position you as a leader in your niche, streamline your business backend, and open the door to multiple income streams.",
      includesTitle: "Includes everything in Tier 1 PLUS:",
      points: [
        { lead: "The Authority Amplifier™", body: " – Position yourself as a premium expert and attract aligned clients consistently" },
        { lead: "The Workflow Whisperer™", body: " – Automate your backend for a business that runs without you" },
        { lead: "The Beyond the Couch Blueprint™", body: " – Learn how to monetize your expertise through scalable offers" },
      ],
      bonusesTitle: "⭐Exclusive Bonuses Included:",
      bonuses: [
        { lead: "6 Months of Group Coaching with Yvette", body: "(2x/month)" },
        { lead: "Lifetime Access to ALL Tier 1 + Tier 2 Curriculum", body: "" },
        { lead: "Marketing Scripts & Templates", body: "($197 Value)" },
        { lead: "Sales Funnel Blueprint", body: "($147 Value)" },
        { lead: "Advanced Pricing Guide", body: "($97 Value)" },
        { lead: "SEO & Analytics Masterclass", body: "($97 Value)" },
        { lead: "Client Retention Playbook", body: "($97 Value)" },
      ],
      totalValue: "Total Value: Over $3,500",
      investment: "$2,997 Pay in Full or 6 Monthly Payments of $547",
      cta: "Join Boss Builders Now →",
    },
    investmentLabel: "Your Investment:",
    closing:
      "Your practice, your freedom, your future—it's all within reach. Take the step, trust the process, and start building the business you’ve always envisioned. We’re here to guide you every step of the way!",
    disclaimerLead: "Disclaimer",
    disclaimer: ": Due to the digital nature of this program and the instant access to resources, all sales are final. No refunds will be issued after purchase.",
  },

  faq: {
    title: "Addressing Your Concerns",
    items: [
      {
        q: "Who is the Profitable Private Practice Leap Accelerator for?",
        a: "This academy is designed for pre-licensed and licensed mental health providers who are ready to transition from agency work to private practice. If you're seeking guidance, support, and a clear roadmap to build a thriving practice, this membership is for you.",
      },
      {
        q: "What if I'm still working a 9-5 job? Can I still join?",
        a: "Absolutely! The accelerator is structured to accommodate professionals transitioning from full-time employment. You'll receive step-by-step guidance to build your practice at a pace that suits your current commitments.",
      },
      {
        q: "What if I can't attend the live Q&A sessions?",
        a: "No worries! All live sessions are recorded and uploaded to the community portal. You can watch the replays at any time and still benefit from the insights and guidance provided. No worries! All live sessions are recorded and uploaded to the community membership portal. You can watch the replays at any time and still benefit from the insights and guidance provided.",
      },
      {
        q: "Are refunds available if I decide the academy isn't for me?",
        a: "Due to the digital nature of the program and immediate access to all resources, all sales are final, and no refunds are issued after purchase.",
      },
      {
        q: "Will this accelerator help me attract clients?",
        a: "Yes, the accelerator provides marketing and client attraction strategies tailored for therapists, helping you build a client base that aligns with your passion and expertise.",
      },
      {
        q: "How do I join the Profitable Private Practice Leap Accelerator?",
        a: 'Click on the "Join Now" button, choose your membership level, and complete the registration process. You\'ll gain immediate access to all resources upon joining.',
      },
      {
        q: "Can I interact with other members?",
        a: "Yes! The Leap Accelerator Community is a vibrant space where you can connect with fellow therapists, share experiences, ask questions, and build supportive relationships.",
      },
      {
        q: "How will the content be delivered?",
        a: "All content is accessible online through our membership portal. You can access courses, resources, and community forums at any time, allowing you to learn and implement strategies at your convenience.",
      },
    ],
  },
} as const;

export const leapAcceleratorThankYou = {
  seo: {
    title: "Thank You",
    description:
      "You did it! Your next chapter in the Profitable Private Practice Leap Accelerator starts now — here is what happens next.",
    image: `${IMG}/thank-you-banner.jpg`,
  },
  hero: {
    eyebrow: "Profitable Private Practice Leap Accelerator",
    title: "You Did It!",
    titleAccent: "Your Next Chapter Starts Now",
    image: { src: `${IMG}/thank-you-banner.jpg`, alt: "Profitable Private Practice Leap Accelerator, with Yvette Howard" },
  },
  intro: [
    "By saying yes to the **Profitable Private Practice Leap Accelerator**, you’ve made the decision to take control of your career, create financial freedom, and build a business on your terms.",
    "**This is a commitment to yourself, your future, and the work you’re meant to do.** The support, guidance, and strategies you need are all here, and we’re excited to walk this journey with you.",
  ],
  next: {
    title: "What Happens Next?",
    steps: [
      {
        title: "Check Your Inbox",
        body: [
          "A confirmation email with your access details is on its way.",
          "Be sure to check your spam folder if you do not see the email within 10 minutes.",
        ],
      },
      {
        title: "Log in to Your Dashboard",
        body: ["Get started right away with your step-by-step training, templates, and tools."],
        // Kajabi sent this to the old mykajabi.com member login; the library is
        // where the programme lives here, behind our own sign-in.
        action: { label: "Access Your Accelerator", href: "/library" },
      },
      {
        title: "Join the Community",
        body: [
          "You’re not in this alone. Connect with like-minded professionals who are building their businesses alongside you.",
        ],
        // Empty href on Kajabi; the member community is the place it meant.
        action: { label: "Join the Community", href: "/community" },
      },
    ],
  },
  most: {
    title: "How to Get the Most Out of This Experience",
    items: [
      { lead: "Set Your Intentions", body: " – Take a moment to reflect on why you joined and what success looks like for you." },
      { lead: "Make Time for Growth", body: " – Block out time in your schedule to engage with the lessons and apply what you learn." },
      { lead: "Engage & Ask Questions", body: " – Leverage the community and coaching sessions to stay accountable and get support when you need it." },
    ],
    closing: "This is your time to take the leap. The only way forward is through action—and you’ve already taken the first step.",
  },
  ready: {
    title: "You’re Ready for This. Your Future is in Motion.",
    body: "**Every step you take from here strengthens your vision, your confidence, and your success.** Trust that you have everything you need—and when challenges arise, you have the support to navigate them. **You’re not just building a business**—you’re creating the life you’ve been working toward.",
    signoff: "Let’s get started.",
  },
} as const;
