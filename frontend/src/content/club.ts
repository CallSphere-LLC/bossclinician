/**
 * The Boss Clinician Club — sales page copy.
 *
 * Transcribed from bossclinician.com/club (18 September 2026), section by
 * section and in the page's own order. Every price, value figure, guarantee
 * term and the NBCC statement is the published wording: nothing here is
 * paraphrased, rounded or invented. Two things on the source page are
 * deliberately not carried over — the embedded video testimonial (its player
 * is a third-party embed the site's CSP does not allow) and the interactive
 * "curriculum pace" slider, whose one worked example is kept as static copy.
 */

/**
 * Where "Join" goes.
 *
 * The source buttons open the Kajabi checkout (/offers/tzgjALKU/checkout). No
 * Club offer exists in this app yet, so the join buttons go to the application
 * form. When the offer is published in the admin, change this one constant to
 * `/checkout/<offer-slug>`; migration 064 already redirects the Kajabi
 * checkout path to this page.
 */
export const CLUB_JOIN_ROUTE = "/apply";

export const club = {
  seo: {
    title: "How to Start a Private Practice | Boss Clinician Club",
    description:
      "Build your private practice with a clear foundation, client-growth strategy, systems, live coaching and support inside The Boss Clinician Club. Build a Private Practice You Won’t Have to Undo Later",
  },

  hero: {
    banner:
      "For therapists and psychiatric providers ready to build private practice with the right foundation from the start.",
    eyebrow: "THE CLUB · 6-MONTH PROGRAM",
    title: "Build a Private Practice",
    titleAccent: "You Won’t Have to Undo Later.",
    lede: [
      "A six-month coaching program for therapists and psychiatric providers who want to build the business side of private practice with the right foundation, strategy, and support — without guessing their way through it.",
      "Whether you’re starting from scratch, building while employed, or rebuilding after a false start, The Club helps you make smarter decisions now so future-you doesn’t have to come back and fix them later.",
    ],
    cta: "JOIN THE CLUB",
    includes: "Includes The Boss Move + live coaching + community + implementation resources.",
    bonus: "Enrollment Bonus: Ramp-Up Rate Formula included.",
  },

  taught: {
    title: "You Learned How to Be a Clinician. Nobody Taught You How to Build the Business.",
    paragraphs: [
      "You spent years earning the degree, completing the clinical hours, and becoming licensed.",
      "But when it came time to actually build a private practice, you were expected to figure out the business side on your own.",
      "The Club gives you a clear place to start — and a structure for building without putting your financial security on the line.",
    ],
    closing:
      "Build while you’re working. Transition on your terms. Create options before you need them.",
  },

  start: {
    title: "So... are you ever actually going to start your own practice?",
    intro: [
      "You are way past daydreaming about this.",
      "You know private practice could give you more control over how you work, who you serve, and what your career looks like next.",
      "But you have tried to figure it out alone. So far, that has looked like:",
    ],
    tried: [
      "Downloading the free templates and watching the free trainings",
      "Buying the books and joining the Facebook groups",
      "Paying for a low cost mentorship that gave you information but no real structure",
      "Saving the posts and screenshotting the checklists",
      "Watching another year pass while you keep researching instead of building something of your own.",
    ],
    outro: "And you have decided it is time for committed, structured support.",
  },

  holdingBack: {
    title: "You're clinically skilled, you have the license, so why do you keep holding yourself back?",
    paragraphs: [
      "In my years coaching therapists, I have watched this same pattern repeat. You've been taught to be a brilliant clinician, but you've not been taught the business side of having a practice.",
      "The dream of you starting your practice is still there but the fear of doing it wrong feels bigger than the pain of staying where you are.",
      "You’ve learned how to work inside someone else’s systems. Now you’re learning how to make the business decisions for yourself — your rates, your schedule, your client mix, your policies, your referral strategy, and the way your practice supports your life.",
      "You already know how to be the clinician. Now it’s time to learn how to be the owner.",
    ],
    quote:
      "You don’t need to wait until you feel completely ready. You need a structure that helps you move forward responsibly.",
    cta: "I'M READY TO JOIN!!",
  },

  warning: {
    title: "And Here’s the Part Nobody Warns You About Building Private Practice",
    paragraphs: [
      "Even the clinicians who make it out of the DIY phase can end up with a full caseload and still realize there isn’t enough structure underneath the practice. Ask me how I know. 🤦🏾‍♀️",
      "They may be fully booked and still feel underpaid, working more hours in their own practice than they ever did at the agency. Some even start wondering whether going back to employment would feel easier.",
      "They found ways to get clients. They pieced together templates, systems, and advice along the way.",
      "But getting booked and building a sustainable practice are not the same thing.",
      "The things you skip in the beginning often become the things you have to fix later.",
      "That’s exactly why I created The Boss Move inside The Club.",
    ],
    meetsYou:
      "The Club meets you exactly where you are, wherever you are in your practice-building journey.",
    meetsYouBody:
      "You’re not just learning how to fill your caseload. You’re learning how to build the business underneath it — your foundation, numbers, client flow, systems, and owner decision-making — in an order that actually makes sense.",
    closing: "Build it right now so you don’t have to rebuild it later.",
  },

  personas: {
    title: "Which One Relates the Most?",
    subtitle: "The Club was built for all of them.",
    items: [
      {
        label: "The starter",
        title: "Never seen a client of your own",
        paragraphs: [
          "Maybe you haven't seen a private practice client yet. You have the license, the clinical skill, and the pull you cannot shake, and you are ready to stop waiting for the moment you feel ready.",
          "You might be working full time and building your exit, or building a second income stream to protect yourself no matter what your agency does next. You do not need to quit anything to start. Building on the side while you have income coming in is a smart, steady way to begin.",
        ],
        tagline: "Build before you leap.",
      },
      {
        label: "The returner",
        title: "Tried it before, went back",
        paragraphs: [
          "Maybe the caseload slowed down, the income felt unpredictable, or you ended up going back to an agency or platform because it felt safer..",
          "That does not mean private practice was not for you. It may simply mean you were building without enough structure underneath you. This time, you build with a roadmap, support, and clearer business decisions from the beginning.",
        ],
        tagline: "Rebuild it differently this time.",
      },
      {
        label: "The independent",
        title: "Gigs wearing a practice's name",
        paragraphs: [
          "Maybe your income comes from platforms, referral apps, insurance panels, or a mix of different sources, working hard for income that never feels solid.",
          "You’ve created income, but you haven’t yet built the structure that makes the business feel truly yours. The Club helps you create clearer systems, stronger client flow, and more control over how your practice operates so it finally becomes yours.",
        ],
        tagline: "Turn scattered income into an intentional practice.",
      },
    ],
    closing:
      "Wherever you are starting from, if you are serious about building a practice that funds the life you actually want, you belong here.",
  },

  enter: {
    eyebrow: "A Plan for a Real Practice (Built on Purpose.)",
    title: "Enter the Club:",
    paragraphs: [
      "A 6-month coaching program built around one goal: helping you create a strong private-practice foundation you can confidently grow from.",
      "I’ll support you through the business decisions clinicians are rarely taught — setting up the practice, finding aligned clients, understanding your numbers, creating sustainable systems, and building enough consistency to make your next career decision from a place of choice instead of pressure.",
      "For some members, that next decision is leaving a job. For others, it’s reducing their hours, creating a second income stream, or simply knowing their practice is finally built to last.",
    ],
    cta: "I'M READY FOR THE CLUB",
  },

  pillars: {
    eyebrow: "What's Inside the Club",
    title: "Five Pillars. Six Months. One Outcome.",
    body: "Everything you need to build your practice with structure, support, and momentum.",
    items: [
      {
        label: "Pillar 01",
        badge: "Most Transformational",
        title: "The Boss Move",
        body: "A 5-module program with NBCC-approved CE content that walks you through the core business decisions behind building a strong private practice — foundation, client flow, income, and systems in an order that makes sense.",
        finePrint:
          "Approved by NBCC under the program title \"Profitable Private Practices: Training for Clinically-Aligned Private Practices\" for 4 clock hours. Boss Clinician, LLC, ACEP No. 7998.",
      },
      {
        label: "Pillar 02",
        title: "Two Live Coaching Calls a Month",
        body: "Bring your real questions twice a month and get direct support, strategy, and guidance as you build.",
      },
      {
        label: "Pillar 03",
        title: "A Community Built for Your Stage",
        body: "You will not build alone. Join clinicians in the same season who are building, learning, and implementing right alongside you.",
      },
      {
        label: "Pillar 04",
        title: "Plug-and-Play Business Resources",
        body: "Checklists, outreach tools, email and letter templates, trackers, and practice-building resources so you’re not creating everything from scratch.",
      },
      {
        label: "Pillar 05",
        title: "Prepare to Profit Guided Meditation Journal",
        body: "The mindset support that helps you keep moving when fear shows up, so your business can grow with confidence.",
      },
    ],
  },

  bonuses: {
    title: "Plus, these bonuses",
    body: "A few extra tools to help you move faster once you join — without having to figure everything out from scratch.",
    items: [
      {
        label: "CURRENT ENROLLMENT BONUS",
        title: "The Ramp-Up Rate Formula",
        body: "Set your rates with more confidence from the beginning. Plug in your numbers and see what your fee actually needs to support across a week, month, and year — so you’re not choosing your rate based on fear, guesswork, or what someone else charges.",
        note: "Included with Club enrollment during the current bonus period.",
      },
      {
        label: "Bonus 1",
        title: "The First 30 Days Success Planner",
        body: "Your first month inside The Club already mapped out. Use the planner to stay focused on the right milestones, track your progress, and know what to work on next as you begin building your practice.",
        note: "Designed to help you implement — not just consume more information.",
      },
    ],
    closing:
      "The goal isn’t to give you more things to do. It’s to make the next steps easier to follow.",
    cta: "JOIN THE CLUB",
  },

  testimonials: {
    title: "Hear from clinicians who chose to build differently",
    items: [
      {
        quote:
          "Yvette helped me launch my private practice while I was still working my full-time job and within a few weeks I was already seeing clients and bringing in consistent extra income. That income gave me the confidence to leave my 9 to 5 and go full time in my own practice",
        name: "Kristan L, LCSW",
      },
      {
        quote:
          "Working with Yvette was an invaluable experience. Her guidance gave me the clarity, confidence, and direction I needed to establish my private practice. I had a vision but needed support in bringing it to life. Yvette provided the information, insight, and encouragement that helped me take the leap and officially create North Star Wellness LLC.",
        name: "Christina Mason, LCSW, CADC",
      },
    ],
    /** Sits on its own under the pricing, as it does on the source page. */
    closing: {
      quote:
        "Yvette is truly a person who has a desire to guide, teach and mentor others into their profession. supportive, and patient, and knowledgeable about the ins and outs of the counseling business. Yvette always encouraged me to have faith, confidence in my abilities. I'm now 100% in control of my business and she still will assist me with minor questions as it pertains to the business as well as there for emotional support and has a smile for you.",
      name: "Sharon S LPC",
    },
  },

  pace: {
    eyebrow: "Your Pace, Your Practice",
    title: "How Much Time Can You Give Your Practice Each Week?",
    body: "You don't need endless free time to make progress inside The Club.",
    exampleLabel: "3 hours a week",
    exampleResultLabel: "Your Estimated Curriculum Pace",
    exampleResult: "About 7.5 Weeks",
    exampleBody:
      "At this pace, you could work through the core Boss Move curriculum in approximately 7.5 weeks.",
    paragraphs: [
      "But there's no prize for finishing fast.",
      "Your Club experience lasts six full months so you have time to implement, get coached, troubleshoot, and actually build.",
    ],
    closing: "The goal isn't to finish the content. The goal is to build the practice.",
  },

  value: {
    eyebrow: "Let's Talk About The Value",
    title: "Here's what's included and what it's worth",
    subtitle: "Six Months of Strategy, Coaching + Implementation Support",
    body: "You're not paying for another course to watch by yourself. You're getting the curriculum, live guidance, resources, and support to actually implement what you're learning while your practice takes shape.",
    items: [
      {
        name: "The Boss Move",
        detail: "5-module private-practice business curriculum + eligible NBCC CE content",
        worth: "$1,997 value",
      },
      {
        name: "12 Live Coaching Calls",
        detail: "Two opportunities each month to get strategy and support from me as you implement",
        worth: "$3,600 value",
      },
      {
        name: "Business-Building Resource Library",
        detail:
          "Checklists, outreach tools, email and letter templates, trackers, and implementation resources",
        worth: "$497 value",
      },
      {
        name: "Marketing + Referral Resources",
        detail:
          "Tools to help you create consistent visibility and client flow without relying on random marketing",
        worth: "$397 value",
      },
      {
        name: "Prepare to Profit Guided Journal",
        detail:
          "Mindset and decision-making support for the fears that show up when you're building something of your own",
        worth: "$97 value",
      },
      {
        name: "Six Months of Community Access",
        detail: "Support from clinicians building alongside you",
        worth: "$600 value",
      },
    ],
  },

  pricing: {
    title: "Choose the Payment Option That Works Best for You",
    options: [
      { price: "$397/mo", terms: "for 6 months" },
      { price: "$1,997", terms: "paid in full" },
    ],
    cta: "JOIN THE CLUB",
    note: "You'll receive immediate access to The Club, The Boss Move, your enrollment resources, and your next steps.",
    guarantee: "Protected by the 14-Day Boss Move Guarantee.",
  },

  nextMove: {
    eyebrow: "YOUR NEXT MOVE",
    title: "Six Months From Now, You’ll Still Be Six Months Older.",
    paragraphs: [
      "The question is whether you’ll still be researching private practice, saving posts, and wondering when you’re finally going to start…",
      "or whether you’ll have spent those six months actually building it.",
      "You don’t have to quit your job tomorrow.",
      "You don’t have to know every step before you start.",
      "And you definitely don’t have to build it perfectly.",
      "You just need the right next steps, in the right order, with support while you take them.",
    ],
    closing: "Build a Private Practice You Won’t Have to Undo Later.",
    cta: "GET ME IN THE CLUB",
  },

  founder: {
    eyebrow: "I LEARNED THIS THE EXPENSIVE WAY",
    title: "Hey, I'm Yvette!",
    paragraphs: [
      "I started my private practice in 2018 while still working part-time at a dialysis clinic.",
      "Like a lot of clinicians, I knew how to do the clinical work. I did not know how to build a business.",
      "So I learned the way most of us do at first — Facebook groups, premade templates, advice from people a few steps ahead of me, and a whole lot of trial and error.",
      "Some of those lessons were expensive.",
      "I undercharged. I skipped systems I didn't know I needed. A Medicaid audit cost me thousands after I discovered the documentation templates I trusted weren't enough. I worked on platforms while building my own practice until I finally did the math and realized how differently I could structure the business for myself.",
      "Eventually, I went all in on my own practice — and spent the next several years learning what I wish someone had taught me from the beginning.",
      "Today I run a multi-six-figure group practice, but here's the part that matters for you:",
      "The decisions that shaped that business started long before I hired a team. They started with learning how to think like an owner.",
      "That's why I built The Club.",
      "I wanted clinicians to have the roadmap, support, and business education I wish I'd had before expensive mistakes became lessons.",
      "You already know how to be the clinician. I'm here to help you learn how to build the practice.",
    ],
    signoff: "All my best,",
    signature: "Yvette Howard, LCSW, Owner of Boss Clinician",
  },

  faq: {
    title: "YOU MAY BE ASKING..",
    items: [
      {
        q: "How long will it take me to complete?",
        a: "The program is designed to be completed in 6 months. However, the pace can be adjusted based on your individual needs and schedule, allowing you to take the time necessary to fully understand and implement each component.",
      },
      {
        q: "What if I fill my caseload before the 6 months are up?",
        a: "Yesss!!! That's exactly the energy this program is built for. But finishing the Boss Move doesn't mean you're finished needing support. You might still be second-guessing your website at 11pm, or white-knuckling the mindset part more than anyone can see. That's normal, and your full 6 months of coaching and community stay yours through the end of your term either way. The Club is an on-ramp, not a room you wait in. When your practice is running, the Lounge is your next room, where fully booked clinicians restructure their rates, income, and systems. Finish early, keep building through your term, and your seat is waiting. Make your boss move in the Club. Elevate your practice in the Lounge.",
        link: { label: "Explore the Lounge", to: "/lounge" },
      },
      {
        q: "Does this cover insurance credentialing and billing?",
        a: "Great question! This program does not cover insurance credentialing or billing, because those topics deserve a much more in-depth, step-by-step approach. That’s exactly why I created my Credential with Confidence training — it walks you through the process of getting credentialed effectively and confidently.",
        link: {
          label: "Credential with Confidence training",
          to: "/courses/credential-with-confidence",
        },
      },
      {
        q: "Do you offer refunds?",
        a: "Join the Club and do the work for 14 days. Complete your onboarding, work through Start Here and Module 01, finish the Module 01 worksheets, and attend or watch your first coaching call. If you have done all of that and still do not believe the Club is a powerful investment in your practice, show us your completed work within 14 days of enrollment and we will refund your tuition.",
      },
      {
        q: "What if I’m scared about losing benefits?",
        a: "We’ll help you think through the financial and business milestones you want in place before making a transition. You decide whether, when, or if leaving employment makes sense for you.",
      },
      {
        q: "I’ve never run a business before — can I do this?",
        a: "Yes. Most members start with zero business experience. That is exactly why the Club exists.",
      },
    ],
    cta: "SAY LESS.. I'M READY TO JOIN THE CLUB",
  },

  footerLine: "Build it. Sustain it. Lead it. Leave it on your terms.",
  nbcc: "Boss Clinician, LLC has been approved by NBCC as an Approved Continuing Education Provider, ACEP No. 7998. Programs that do not qualify for NBCC credit are clearly identified. Boss Clinician, LLC is solely responsible for all aspects of the programs. CE grievance, refund, and cancellation policies are available by request at support@bossclinician.com.",
};
