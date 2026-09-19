import { BOSS_CLINICIAN_PERSONA } from "@/voice/contract";
import type { TourStop, VoiceDestination, VoiceSurfacePolicy } from "@/voice/contract";

/**
 * The visitor's concierge — a warm concierge on a sales floor.
 *
 * This catalog is the first half of role-based access. It contains no portal
 * address and no admin address at all, so a public session cannot ask to be
 * taken to one: the model is never told they exist. The server re-decides who
 * the caller is on every admission, which is the half that actually defends
 * anything, but a model that cannot even name a private page is a model that
 * never has to be refused in front of a stranger.
 *
 * Every narration was written from the page it describes. A concierge that
 * oversells is worse than none, so where a page is a form, the line says it is
 * a form, and where something is free, it says free — because it is.
 */

const PUBLIC: readonly ["public"] = ["public"];

const DESTINATIONS: readonly VoiceDestination[] = [
  {
    key: "home",
    path: "/",
    label: "Home",
    aliases: ["home", "the home page", "the front page", "start", "take me back", "the beginning"],
    narration:
      "The home page makes the whole argument in order: build a private practice you can actually stay in, the three ways to work with Yvette, her story, the free masterclass and the two-minute quiz.",
    surfaces: PUBLIC,
  },
  {
    key: "work-with-me",
    path: "/work-with-me",
    label: "Work With Me",
    aliases: [
      "work with me",
      "work with Yvette",
      "coaching",
      "the boardroom",
      "one to one",
      "how do I hire her",
      "what are my options",
    ],
    narration:
      "Work With Me introduces the B.O.S.S. Boardroom, a group experience for practice owners. Read the current page for its format, application details and frequently asked questions. One-to-one consulting is no longer offered.",
    surfaces: PUBLIC,
  },
  {
    key: "club",
    path: "/club",
    label: "Boss Clinician Club",
    aliases: [
      "the club",
      "boss clinician club",
      "the six month program",
      "I'm just starting out",
      "how do I start a practice",
    ],
    narration:
      "The Club is a six-month coaching program for therapists and psychiatric providers building the business side of private practice. It is three hundred and ninety-seven dollars a month for six months, or one thousand nine hundred and ninety-seven paid in full, with a fourteen-day guarantee.",
    surfaces: PUBLIC,
  },
  {
    key: "lounge",
    path: "/lounge",
    label: "Boss Clinician Lounge",
    aliases: [
      "the lounge",
      "boss clinician lounge",
      "the membership",
      "the monthly one",
      "I'm already established",
      "I'm seeing too many clients",
    ],
    narration:
      "The Lounge is a monthly membership for therapists whose practice already works but who cannot keep working like this. There are two tiers at the founding rate — Member at a hundred and ninety-seven a month, and VIP at three hundred and forty-seven, which puts Yvette's eyes on your practice.",
    surfaces: PUBLIC,
  },
  {
    key: "retreats",
    path: "/retreats",
    label: "Retreats",
    aliases: [
      "the retreat",
      "retreats",
      "bali",
      "the trip",
      "the wellness retreat",
      "when is the retreat",
    ],
    narration:
      "A luxury wellness retreat for women mental health professionals: six days, five nights, twelve women and one private villa in Ubud, Bali, from the fifteenth to the twentieth of June 2027. A private king suite is five thousand five hundred dollars.",
    surfaces: PUBLIC,
  },
  {
    key: "courses",
    path: "/courses",
    label: "Courses",
    aliases: [
      "courses",
      "the training library",
      "self paced",
      "the blueprint course",
      "what can I buy",
      "online training",
    ],
    narration:
      "The training library is the self-paced side: courses and toolkits on credentialing, documentation, marketing, rates and niching, each with its own page, its own price and lifetime access.",
    surfaces: PUBLIC,
  },
  {
    key: "store",
    path: "/store",
    label: "Store",
    aliases: [
      "the store",
      "the shop",
      "consulting",
      "consulting services",
      "what does it cost",
      "prices",
      "where do I pay",
    ],
    narration:
      "The store shows the currently available offers. Read the live products and prices before describing them; never offer retired one-to-one consulting services.",
    surfaces: PUBLIC,
  },
  {
    key: "about",
    path: "/about",
    label: "About Yvette",
    aliases: [
      "about",
      "about Yvette",
      "who is Yvette",
      "her story",
      "her credentials",
      "is she qualified",
    ],
    narration:
      "Yvette Howard's own story in her words — how she came to be a therapist, the shortcuts that did not work, and the practice she ended up running by design rather than by accident — with the press she has been featured in and what clinicians say about her.",
    surfaces: PUBLIC,
  },
  {
    key: "resource-hub",
    path: "/resource-hub",
    label: "Resource Hub",
    aliases: [
      "the resource hub",
      "free tools",
      "the income calculator",
      "what's free",
      "how much could I earn",
    ],
    narration:
      "The Resource Hub sorts the free tools into three sections by where your practice actually is — just starting, maxed out, or building a team — and it holds the practice calculator that turns your rate and your caseload into a yearly figure.",
    surfaces: PUBLIC,
  },
  {
    key: "resources",
    path: "/resources",
    label: "Free Resources",
    aliases: [
      "free resources",
      "freebies",
      "the masterclass",
      "the free masterclass",
      "guides",
      "checklists",
    ],
    narration:
      "Freebies and resources: the free masterclass, the guides, the checklists and the income tool, each one free in exchange for an email address.",
    surfaces: PUBLIC,
  },
  {
    key: "practice-quiz",
    path: "/practice-quiz",
    label: "Practice Quiz",
    aliases: [
      "the quiz",
      "the practice quiz",
      "the free quiz",
      "is my practice working",
      "which offer is right for me",
    ],
    narration:
      "A free quiz asking whether your practice is set up to pay you or just keep you busy: six questions, two minutes, four possible results, and no email address needed to start.",
    surfaces: PUBLIC,
  },
  {
    key: "blog",
    path: "/blog",
    label: "Blog",
    aliases: ["the blog", "articles", "your writing", "read something", "posts"],
    narration:
      "The Boss Clinician blog: practical articles on documentation, pricing, compliance and mindset, with a row of topic chips so you can read only the ones about the thing you are stuck on.",
    surfaces: PUBLIC,
  },
  {
    key: "apply",
    path: "/apply",
    label: "Apply",
    aliases: [
      "apply",
      "the application",
      "the application form",
      "I want to work with her",
      "sign me up",
      "how do I get started",
    ],
    narration:
      "A letter from Yvette, and then the application form. It asks your name, your email, your phone if you want to give it, and what your biggest challenge in the practice is right now. Yvette reads every application herself and answers within a day.",
    surfaces: PUBLIC,
  },
  {
    key: "contact",
    path: "/contact",
    label: "Contact",
    aliases: [
      "contact",
      "get in touch",
      "email you",
      "I have a question",
      "customer support",
      "help",
    ],
    narration:
      "A help desk: a message form, the address for general questions, the one for help getting into something you have already bought, a comparison of the three programmes, and the next retreat.",
    surfaces: PUBLIC,
  },
  {
    key: "partners",
    path: "/partners",
    label: "Partner program",
    aliases: [
      "the partner program",
      "affiliate",
      "referrals",
      "can I earn commission",
      "recommend you",
    ],
    narration:
      "The partner programme: what you earn on every sale you send, how long a referral is remembered after somebody clicks your link, the terms, and the form to apply.",
    surfaces: PUBLIC,
  },
  {
    key: "cart",
    path: "/cart",
    label: "Your cart",
    aliases: ["my cart", "the basket", "what's in my cart", "checkout", "I want to buy this"],
    narration:
      "Your cart: the things you have chosen, a box for a discount code, the running total, and one payment that puts all of it into your library.",
    surfaces: PUBLIC,
  },
  {
    key: "sign-in",
    path: "/login",
    label: "Sign in",
    aliases: [
      "sign in",
      "log in",
      "I already bought this",
      "where do I log in",
      "get into my account",
    ],
    narration:
      "The sign-in page. If you have bought anything at all your account already exists, so this is usually the answer to where did my course go. There is a forgotten-password link, and a Google option where it is switched on.",
    surfaces: PUBLIC,
  },
  {
    key: "create-account",
    path: "/signup",
    label: "Create your account",
    aliases: [
      "create an account",
      "sign up",
      "register",
      "make an account",
      "I don't have a login",
    ],
    narration:
      "Creating an account takes a first name, an email address and a password, and gives you a library for your purchases. You can also buy without one — an account is made for you either way.",
    surfaces: PUBLIC,
  },
  {
    key: "privacy",
    path: "/privacy-policy",
    label: "Privacy policy",
    aliases: ["privacy", "privacy policy", "what do you do with my data", "my information"],
    narration:
      "The privacy policy, in seven clauses with an index down the side: what personal information is collected and when, your controls over it, how it is kept, and your rights to it.",
    surfaces: PUBLIC,
  },
  {
    key: "terms",
    path: "/terms",
    label: "Terms",
    aliases: ["terms", "terms and conditions", "the small print", "the contract"],
    narration:
      "The terms of use — a binding agreement, in eleven clauses with an index down the side, covering copyright, trademarks, access restrictions, warranties and governing law.",
    surfaces: PUBLIC,
  },
  {
    key: "disclaimer",
    path: "/disclaimer",
    label: "Disclaimer",
    aliases: ["the disclaimer", "is this therapy", "is this clinical advice", "legal notice"],
    narration:
      "A short notice in capitals saying plainly that case studies, examples and testimonials cannot guarantee you will achieve similar results.",
    surfaces: PUBLIC,
  },
  {
    key: "financial-disclaimer",
    path: "/financial-disclaimer",
    label: "Financial disclaimer",
    aliases: [
      "the financial disclaimer",
      "income claims",
      "are results guaranteed",
      "will I make money",
    ],
    narration:
      "The financial disclaimer, covering any figure mentioned anywhere on this site: examples are examples, and nobody's earnings are being promised to you.",
    surfaces: PUBLIC,
  },
];

/**
 * The order a stranger should meet the site in.
 *
 * It follows the argument the home page already makes — what this is, who it is
 * for, the three ways in, who is teaching — and only then reaches the free
 * things, which is the natural moment to ask for an email address. Buying,
 * signing in and the small print come last, because a visitor who is still
 * deciding does not want the checkout first.
 */
const TOUR: readonly TourStop[] = [
  {
    destination: "home",
    purpose:
      "The whole argument in one page: what Boss Clinician is, who it is for, and the three ways to work with Yvette.",
    beats: [
      {
        focus: "Build a private practice you can actually stay in",
        say: "That headline is the whole idea. This is not about opening a practice — it is about building one you are still happy to be in five years from now.",
      },
      {
        focus: "Find Your Path",
        say: "This button jumps down to the three ways in, which differ by the stage you are at rather than by how much you are willing to spend.",
      },
      {
        focus: "Watch the Free Masterclass",
        say: "There is also a free masterclass and a two-minute quiz further down. Most people start with one of those rather than with a payment, and that is the right order.",
      },
    ],
  },
  {
    destination: "work-with-me",
    purpose:
      "The full menu of strategic partnerships, with who each is for and how the work actually runs.",
    beats: [
      {
        focus: "Built to heal others.",
        say: "Built to heal others — now let's build something that sustains you. That is the whole premise of this page, and it is the one that costs money, so it is worth reading properly.",
      },
      {
        focus: "Strategic partnerships",
        say: "This is the B.O.S.S. Boardroom. Read the details on screen to explain the current group experience and who it serves.",
      },
      {
        focus: "How we work together",
        say: "And this part is the mechanics: what happens after you apply, how often you meet, and what is expected of you in between.",
      },
      {
        focus: "Frequently asked questions",
        say: "The questions at the bottom are the ones people actually ask before applying, so it is worth a scroll before you fill anything in.",
      },
    ],
  },
  {
    destination: "club",
    purpose:
      "The six-month programme for someone still building the foundation of a private practice.",
    beats: [
      {
        focus: "Build a Private Practice You Won't Have to Undo Later.",
        say: "The Club is for therapists and psychiatric providers who are starting out, building while still employed, or rebuilding after a false start.",
      },
      {
        focus: "Join the Club",
        say: "Six months, with twelve live coaching calls alongside the curriculum. It is three hundred and ninety-seven a month, or one thousand nine hundred and ninety-seven paid in full, and there is a fourteen-day guarantee.",
      },
    ],
  },
  {
    destination: "lounge",
    purpose:
      "The monthly membership for a practice that already works but is costing its owner too much.",
    beats: [
      {
        focus: "Your practice is working.",
        say: "The Lounge starts from a different question: your practice works, but can you keep working like this? It is for established therapists, not beginners.",
      },
      {
        focus: "Choose your path into the Lounge",
        say: "Two tiers. Member is a hundred and ninety-seven a month, VIP is three hundred and forty-seven and puts Yvette's eyes on your practice. Both are founding rates on limited seats, and the rate you join at is the rate you keep.",
      },
    ],
  },
  {
    destination: "retreats",
    purpose: "The Bali retreat — the one thing here that is rest rather than work.",
    beats: [
      {
        focus: "BALI, INDONESIA",
        say: "Bali, the fifteenth to the twentieth of June 2027, in a private villa, for women mental health professionals.",
      },
      {
        focus: "When was the last time someone took care of you?",
        say: "That line is the whole pitch. Yvette made herself a promise on her own first retreat in 2023, and this is that promise kept.",
      },
    ],
  },
  {
    destination: "courses",
    purpose: "The self-paced training library, for someone who wants the material without the coaching.",
    beats: [
      {
        focus: "Explore the Library",
        say: "These are self-paced courses and toolkits — credentialing, documentation, marketing, rates and niching. You buy one, and it is yours in your library for good.",
      },
      {
        focus: "Boss Clinician Training Library",
        say: "Each course has its own page with what is inside it, how many lessons there are and what it costs, so nothing is hidden behind a call.",
      },
    ],
  },
  {
    destination: "store",
    purpose: "The current offers available to purchase.",
    beats: [
      {
        focus: "Store",
        say: "Read the available offers and current prices on this page. The Club, Boardroom and retreats are the current ways to work with Boss Clinician; one-to-one consulting is no longer offered.",
      },
      {
        focus: "Get Started",
        say: "If you already know exactly what you need help with, this is usually faster than applying for a programme — the button takes you to the same application form with the service named.",
      },
    ],
  },
  {
    destination: "about",
    purpose: "Yvette's own story, which is what most people want before they trust any of this.",
    beats: [
      {
        focus: "I'm Yvette Howard.",
        say: "Yvette Howard is a licensed clinical social worker, a multi-six-figure group practice owner and a doctoral candidate — and this page is how she got there.",
      },
      {
        focus: "THE TRUTH NOBODY TOLD ME",
        say: "This part is the honest bit: she tried every shortcut the industry offered, and none of them worked the way they promised.",
      },
      {
        focus: "What I help you build",
        say: "And these five cards are what the work is actually aiming at — a private pay or hybrid practice, ethical and scalable systems, sustainable revenue, a leadership identity, and a business that supports your life.",
      },
    ],
  },
  {
    destination: "resource-hub",
    purpose: "The free tools, sorted by the stage the visitor is actually at.",
    beats: [
      {
        focus: "Resource Hub",
        say: "Everything free on the site is gathered here, sorted by where your practice is now rather than by what kind of file it is.",
      },
      {
        focus: "Annual Income Potential",
        say: "The practice calculator is the one to try first. Set your session rate, your clients a week and your working weeks, and it gives you a yearly figure — usually a surprise in one direction or the other.",
      },
    ],
  },
  {
    destination: "resources",
    purpose: "The free masterclass, guides and checklists.",
    beats: [
      {
        focus: "Freebies & Resources",
        say: "The masterclass, the guides and the checklists. Each one asks for an email address, and that is the whole cost.",
      },
      {
        focus: "Watch Free Masterclass",
        say: "The masterclass is the longest of them, and the closest thing to sitting in on how Yvette thinks about a practice.",
      },
    ],
  },
  {
    destination: "practice-quiz",
    purpose: "The two-minute quiz that tells someone which of the offers fits them.",
    beats: [
      {
        focus: "Is Your Practice Set Up to Pay You or Just Keep You Busy?",
        say: "Two minutes, and it needs no email address to start. If you are not sure which programme is yours, this answers it faster than reading three sales pages.",
      },
      {
        focus: "Take the free quiz",
        say: "Six questions, four possible results, and each one ends on a recommendation — so you finish knowing what to do next rather than just how you scored.",
      },
    ],
  },
  {
    destination: "blog",
    purpose: "The articles, for someone who wants to read before they commit to anything.",
    beats: [
      {
        focus: "Best of",
        say: "Practical articles on documentation, pricing, compliance and the mindset side, with the strongest one featured at the top.",
      },
      {
        focus: "All Topics",
        say: "And this filter narrows them to the thing you are stuck on, rather than making you scroll through everything.",
      },
    ],
  },
  {
    destination: "apply",
    purpose: "The application form — the single front door to the coaching programmes.",
    beats: [
      {
        focus: "Hey my therapist friend!",
        say: "Worth reading before you fill anything in. It is a letter rather than a sales pitch, and it sets out what applying actually means — a conversation, not a commitment.",
      },
      {
        focus: "Fill out the form below",
        say: "The form asks your name, your email and what your biggest challenge in the practice is right now. Yvette reads every one herself and answers within a day, so an honest answer gets you a better conversation.",
      },
    ],
  },
  {
    destination: "contact",
    purpose: "How to reach a human, and which address to use.",
    beats: [
      {
        focus: "Send Message",
        say: "The quickest route is the form itself. There are also two addresses — one for general questions and one for help getting into something you have already bought — and using the right one gets you a faster answer.",
      },
      {
        focus: "Not sure which Boss Clinician program is right for you?",
        say: "This section compares the programmes side by side, which is often all somebody needed before getting in touch.",
      },
    ],
  },
  {
    destination: "partners",
    purpose:
      "The partner programme, for a visitor who already recommends this work to colleagues.",
    beats: [
      {
        focus: "Earn on every sale you send",
        say: "If you already point clinicians towards this work, this is how you get paid for it. The headline shows the actual rate.",
      },
      {
        focus: "Apply to become a partner",
        say: "The terms are worth opening before you tick the box — they set out how long a referral is remembered after somebody clicks your link, and when you get paid.",
      },
      {
        focus: "Apply to join",
        say: "Every application is read. It helps to say who you would be sharing this with, because that is the part Yvette is actually weighing.",
      },
    ],
  },
  {
    destination: "cart",
    purpose: "The basket, and where a discount code goes.",
    beats: [
      {
        focus: "Continue to checkout",
        say: "Everything you have chosen sits here and goes through as one payment. This button carries you into the payment step without leaving the page.",
      },
      {
        focus: "Discount code",
        say: "If you have a code, this is where it goes — before you pay, not after.",
      },
    ],
  },
  {
    destination: "sign-in",
    purpose: "Getting an existing customer back into what they already own.",
    beats: [
      {
        focus: "Sign in",
        say: "If you have bought anything here your account already exists, so signing in is usually the answer to where did my course go. There is a forgotten-password link just below, and where it is switched on you can continue with Google instead.",
      },
    ],
  },
  {
    destination: "create-account",
    purpose: "Making an account before buying, for someone who prefers it that way.",
    beats: [
      {
        focus: "Create account",
        say: "A first name, an email address and a password, and you have a library waiting. You can also buy first and let the account be made for you — either way works.",
      },
    ],
  },
  {
    destination: "privacy",
    purpose: "The privacy policy.",
    beats: [
      {
        focus: "What Personal Information We Collect and When",
        say: "This sets out exactly what is collected and when — the contact form, the newsletter, comments on a post, and the rest.",
      },
    ],
  },
  {
    destination: "terms",
    purpose: "The terms of use.",
    beats: [
      {
        focus: "This is a binding legal contract. Please read it in full.",
        say: "The terms are a real agreement rather than a formality, covering copyright, trademarks and what you agree to by using the site.",
      },
    ],
  },
  {
    destination: "disclaimer",
    purpose: "The line between business guidance and clinical advice.",
    beats: [
      {
        focus: "Disclaimer",
        say: "One short notice, in capitals: case studies, examples and testimonials cannot guarantee that you will achieve similar results.",
      },
    ],
  },
  {
    destination: "financial-disclaimer",
    purpose: "The line about money, which matters because the site talks about income.",
    beats: [
      {
        focus: "Financial Disclaimer",
        say: "Any figure you see anywhere on this site is an example rather than a promise. Nobody's earnings are being guaranteed to you, including the ones in the calculator.",
      },
    ],
  },
];

export const PUBLIC_POLICY: VoiceSurfacePolicy = {
  surface: "public",
  audience: "anonymous",
  agentName: "Boss Clinician AI",
  voice: "coral",
  // The shared persona has to come FIRST and verbatim. The browser re-sends
  // these instructions to the live model straight after the handshake, which
  // overwrites whatever the broker set when it minted the session — so a
  // persona that lives only on the server survives about one second of a real
  // call. Everything after it is what is true of THIS surface and nothing else;
  // restating the persona's own rules here would only give the model two
  // slightly different versions of them to choose between.
  instructions: [
    BOSS_CLINICIAN_PERSONA,
    [
      "You are standing on the public website, talking to someone who has not bought anything and may never. Boss Clinician helps therapists, counsellors and psychiatric providers build private practices that pay them properly and do not consume them. The people you meet here are clinicians, often tired ones.",
      "Match the answer to the stage they are at. The Club offers ongoing support and practical resources; the Boardroom offers focused coaching for the next stage of a practice; retreats offer time away to reflect and plan. Use the current page details to explain who each is for. If you cannot tell, the free two-minute quiz decides it faster than you can, and offering that is usually better than a third sales page.",
      "Prefer the free things when someone is still deciding — the masterclass, the planner, the practice calculator. A visitor who leaves with something useful comes back; a visitor pushed at a checkout does not.",
      "When money comes up, describe what something costs and what is included, and say plainly that any figure on this site is an example rather than a promise.",
      "You cannot see anybody's account from here, and you must never ask for a password, a card number or anything else private. If someone needs help with a purchase they have already made, offer to take them to the sign-in page, or to the support address on the contact page.",
      "You know nothing about the administration of this business and can change nothing on the site. Say so cheerfully if you are asked.",
      "If they accept the walkthrough, treat it as a tour of a building rather than a pitch: say what each page is for, point at the one thing on it that matters, and let them interrupt whenever they like.",
    ].join(" "),
  ].join(" "),
  greeting:
    "Hi, welcome! I'm Boss Clinician AI. I can take you to pages on this site and explain what’s on them in simple language, one detail at a time. What would you like help with?",
  firstVisitGreeting:
    "Hi, welcome! I'm Boss Clinician AI. I can take you around the site and explain what’s on each page in simple language, one detail at a time. Would you like me to show you around? You can ask questions or say next or stop anytime.",
  tour: TOUR,
  tools: [
    "navigate_to",
    "go_back",
    "read_current_page",
    "point_at",
    "stop_pointing",
    "search_site",
    "start_guided_tour",
    "next_tour_stop",
    "end_guided_tour",
  ],
  destinations: DESTINATIONS,
  // Mirrors SURFACE_LIMITS.public on the server. Five minutes is long enough to
  // answer a stranger's question and short enough that an open tab left running
  // cannot quietly spend the day on a call.
  maxSessionSeconds: 300,
  recordAudio: true,
};
