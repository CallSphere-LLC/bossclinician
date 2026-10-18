/**
 * The free Practice Prep Training — the Club's free masterclass, "How to
 * Prepare for a Private Practice of Your Own".
 *
 *   /practicepreptraining     the sign-up (bossclinician.com/practicepreptraining)
 *   /preparing-for-pp-video   where the sign-up lands, with the recording
 *                             (bossclinician.com/preparing-for-pp-video)
 *
 * Copy is hers, verbatim, as both Kajabi pages read on 15 Oct 2026. Two things
 * on her pages are not carried over: the pages' own mini navigation bar (this
 * site's header does that job) and the video page's "Replace this box with your
 * video embed before publishing" placeholder, which the recording replaces.
 *
 * The recording is the Descript video she shared (share.descript.com/view/
 * Z8lLBnUYfkk), re-encoded to 720p and served from the site's own media
 * library like the other landing-page trainings (migration 122,
 * backend/scripts/kajabi-import/place-descript-videos.sh).
 */

/** The form migration 122 creates; the slug is the page's path, as in 097. */
export const PRACTICE_PREP_FORM = "practicepreptraining";

export const PRACTICE_PREP_ROUTE = "/practicepreptraining";
export const PRACTICE_PREP_VIDEO_ROUTE = "/preparing-for-pp-video";

export const practicePrepTraining = {
  seo: {
    title: "Free Training: How to Prepare for a Private Practice of Your Own | Boss Clinician",
    description:
      "3 strategic moves to help you leave agency or platform work with a clearer plan and greater confidence. A free on-demand masterclass with Yvette Howard, LCSW.",
  },
  hero: {
    eyebrow: "Free on-demand masterclass · For therapists",
    title: "How to Prepare for a",
    titleAccent: "Private Practice of Your Own",
    lede: "3 strategic moves to help you leave agency or platform work with a clearer plan and greater confidence.",
    sub: "You want more freedom. You still need security. Start preparing for your next chapter while you have income support.",
    tags: ["Recorded training", "Watch on your schedule"],
    host: "With Yvette Howard, LCSW · Private Practice Strategist",
  },
  signup: {
    eyebrow: "Your next chapter starts here",
    title: "Get the free masterclass",
    body: "Learn what to plan for, what to build, and how to choose your next step.",
    submit: "I'm ready",
    // Her Kajabi form (2149750481): first name, last name, email, and this.
    concern: {
      key: "biggest_concern",
      label: "What is your biggest concern about building a practice of your own?",
      options: [
        "Replacing my income.",
        "Planning for benefits, retirement, and time off.",
        "Getting consistent clients.",
        "Knowing where to start.",
        "Finding time to build.",
        "Knowing when I’m ready to leave.",
        "Something else.",
      ],
    },
  },
  familiar: {
    eyebrow: "Does this sound familiar?",
    title: "You can picture your own practice.",
    titleAccent: "But the next step feels uncertain.",
    paragraphs: [
      "What about your paycheck? Your benefits? The clients you’re counting on?",
      "You deserve room to think through those questions and a clearer place to begin.",
    ],
    forYouTitle: "This training is for you if…",
    forYou: [
      "You want to leave agency work but worry about losing your income or benefits.",
      "You see clients through platforms and want more control over your practice.",
      "You’re building a side practice and need a plan for moving forward.",
      "You tried private practice before and want things to be different this time.",
    ],
    cta: "I’m ready for a clearer plan →",
  },
  learn: {
    eyebrow: "Inside the masterclass",
    title: "Three things you’ll learn.",
    body: "A clearer understanding of what to prepare as you build a practice of your own.",
    moves: [
      "What your practice must support before it replaces outside income",
      "How to build income and client flow while you still have support",
      "How to decide when you’re ready to reduce or leave outside work",
    ],
    cta: "Watch the free masterclass →",
  },
  host: {
    eyebrow: "Meet your host",
    title: "Hey y’all, I’m Yvette.",
    subtitle: "LCSW · Private Practice Strategist",
    paragraphs: [
      "I started my practice in 2018 while working in dialysis, continuing agency work, and seeing clients through Talkspace. In 2019, I moved into full-time private practice—and still held on to platform work for security.",
      "I wanted freedom. I also needed to know my bills would be paid.",
      "My journey taught me to think beyond getting clients and plan for benefits, retirement, maternity leave, and time off. Today, I help fellow therapists prepare for practice ownership with clearer business decisions and support as they build.",
    ],
    cta: "Learn with me →",
    photo: {
      src: "/images/landing/practice-prep-host.webp",
      alt: "Yvette Howard, LCSW, holding her Business Coach mug",
      width: 800,
      height: 1200,
    },
  },
  closing: {
    eyebrow: "Your practice. Your next chapter.",
    title: "Let’s make your next move",
    titleAccent: "feel more clear.",
    body: "Learn three strategic moves to help you prepare for a private practice that supports your income, energy, and life.",
    cta: "Get the free masterclass →",
    secondary: { label: "Explore the Club", to: "/club" },
  },
} as const;

export const practicePrepVideo = {
  seo: {
    title: "Your Free Masterclass: How to Prepare for a Private Practice of Your Own | Boss Clinician",
    description: "Watch the free masterclass with Yvette Howard, LCSW.",
  },
  hero: {
    eyebrow: "Your free masterclass is ready",
    title: "How to Prepare for a Private Practice of Your Own",
    lede: "3 Strategic Moves to Help You Leave Agency or Platform Work With a Clearer Plan and Greater Confidence",
    sub: "Hey y’all! Grab something to take notes on, press play, and let’s dive in.",
  },
  video: {
    url: "/uploads/landing-practice-prep-training-720p.mp4",
    poster: "/images/landing/practice-prep-training-poster.jpg",
    // Descript's own transcript of the recording, speaker labels removed.
    captions: "/captions/practice-prep-training.en.vtt",
    title: "How to Prepare for a Private Practice of Your Own, with Yvette Howard, LCSW",
    after:
      "As you watch, choose one decision you want to work on next. You can pause and return to the training as needed.",
    cta: "Join the Club",
  },
  nextStep: {
    eyebrow: "Your next step",
    title: "Let’s put your plan into practice.",
    paragraphs: [
      "You’ve explored what your practice needs to support, how to build while you still have income support, and how to assess your readiness.",
      "Now you may be asking: What should I focus on first? How do I apply this to my situation? Who can help me work through the decisions?",
    ],
    strong:
      "The Boss Clinician Club gives you curriculum, coaching, practical resources, and community as you prepare for a practice of your own.",
    cta: "Explore the Boss Clinician Club →",
    image: {
      src: "/images/landing/boss-move-curriculum.webp",
      alt: "The Boss Move curriculum mockup",
      width: 1400,
      height: 788,
    },
  },
  support: {
    eyebrow: "Support for the work ahead",
    title: "A place to learn.",
    titleAccent: "Support as you build.",
    items: [
      {
        title: "The Boss Move Curriculum",
        body: "Five modules to help you work through practice foundations, business decisions, visibility, referral relationships, launch planning, and practice systems.",
      },
      {
        title: "Coaching to Work Through Decisions",
        body: "Bring questions and get support applying the lessons to your practice. Two calls per month, for 12 coaching calls total.",
      },
      {
        title: "Resources Between Calls",
        body: "Checklists, trackers, email and letter templates, outreach tools, and worksheets help you start the work without creating everything from scratch.",
      },
      {
        title: "The Club Community",
        body: "Ask questions, share progress, and build alongside other clinicians working toward practice ownership.",
      },
    ],
  },
  firstMonth: {
    eyebrow: "Your first month inside the Club",
    title: "Begin with one clear priority.",
    steps: [
      "Complete onboarding and open your First 30 Days Success Planner.",
      "Choose the practice decision that needs attention now.",
      "Apply a relevant lesson to your situation.",
      "Bring your questions to coaching and choose your next step.",
    ],
    body: "You don’t have to solve everything at once. Start with a useful next step and support as you take it.",
  },
  closing: {
    eyebrow: "Your practice. Your next chapter.",
    title: "Ready to build with support?",
    body: "Whether you’re preparing for your first practice, building on the side, or starting again, the Club can help you work through the decisions ahead.",
    cta: "View Enrollment Details & Join →",
    note: "See the current investment, payment options, and enrollment terms on the Club page.",
  },
} as const;
