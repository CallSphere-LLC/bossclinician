/**
 * FlourisHealer Retreats — Bali, June 15–20 2027. The sales page copy.
 *
 * Transcribed from www.bossclinician.com/retreats (19 September 2026), band by
 * band and in the page's own order: hero → the numbers → the retreat → why
 * Yvette built it → what's included → why twelve women → the villa gallery →
 * retreat moments → the pattern → the woman who returns → imagine → reserve →
 * your host → why Bali → what is and is not included → the burnout quiz → the
 * fourteen questions.
 *
 * Nothing here is paraphrased, rounded or invented. The price, the payment
 * plan, the final payment date and the cancellation policy are financial terms
 * and are the published wording exactly. The separators in the uppercase strips
 * are non-breaking space + middle dot, written as escapes so a later edit
 * cannot silently turn them into ordinary spaces.
 *
 * The shared app provides navigation and footer. Source photographs, including
 * embedded photos of Yvette and the included experiences, are stored locally.
 */

const DOT = " · ";

/** Hosted checkout remains on the original website until its offer is migrated. */
export const RETREAT_RESERVE_ROUTE = "https://www.bossclinician.com/offers/boofdeo2/checkout";

/** The travel insurance provider the page names, by its own link. */
export const RETREAT_TRAWICK_URL = "https://trawickinternational.com/";

/**
 * The six-question Burnout Self-Assessment still lives on the Kajabi site, so
 * this is deliberately an absolute .com URL.
 *
 * CUTOVER BLOCKER: /retreat-needed-quiz already redirects to /retreats in this
 * app's redirect map, so the moment bossclinician.com points here this button
 * becomes a loop back to this page. Publish the assessment here and switch this
 * to `/quiz/retreat-needed-quiz` before the cutover.
 */
export const RETREAT_QUIZ_URL = "https://www.bossclinician.com/retreat-needed-quiz";

export interface RetreatFaq {
  q: string;
  a: string;
  /** The one answer that points at a document. */
  link?: { label: string; to: string };
}

export interface RetreatPhoto {
  src: string;
  alt: string;
  width: number;
  height: number;
}

/**
 * One of the six things the package includes. Item 03 is the one the source
 * prints as two sub-lists rather than a paragraph — three experiences every
 * guest gets and one to choose between — so an inclusion carries either `body`
 * or `groups`, never both.
 */
export interface RetreatInclusion {
  number: string;
  title: string;
  body?: string;
  groups?: readonly {
    label: string;
    items: readonly { name: string; body: string }[];
  }[];
}

/** A card in the what-is-and-is-not-included band. */
export interface RetreatCoverage {
  label: string;
  lines: readonly string[];
  /** Only the travel insurance card carries a link out. */
  cta?: string;
}

const INCLUSIONS: readonly RetreatInclusion[] = [
  {
    number: "01",
    title: "Private Villa",
    body: "Five nights in a 12-bedroom private estate with two infinity pools, yoga shala, gym, and spa facility nestled in lush Ubud.",
  },
  {
    number: "02",
    title: "Chef-Prepared Meals",
    body: "Daily breakfast, brunch, and dinner prepared by your private villa chef. Outside villa meals included. Every bite, taken care of.",
  },
  {
    number: "03",
    title: "Wellness Experiences",
    groups: [
      {
        label: "Included for every guest:",
        items: [
          {
            name: "Flower Bath",
            body: ", a closing ritual bath with fresh flowers and warm water, marking the transition from holding everyone else to finally being held yourself.",
          },
          {
            name: "In-Villa Massages and Spa Day",
            body: ", traditional Balinese massage and additional restorative spa time, performed by local practitioners, to physically release the tension your job asks your body to carry. No planning or scheduling required on your part.",
          },
          {
            name: "Cabana Day at the Pool",
            body: ", a full day to simply float, rest, and do nothing at all.",
          },
        ],
      },
      {
        label: "Choose one:",
        items: [
          {
            name: "Healing Meditation",
            body: ", a guided stillness practice drawing on Balinese spiritual wisdom, using breath, visualization, and sound to calm the mind and restore energetic harmony.",
          },
          {
            name: "Palm Reading and Holy Water Ceremony",
            body: ", an intimate cultural experience where a Balinese healer reads the lines of your destiny, followed by a sacred holy water blessing for clarity and protection.",
          },
        ],
      },
    ],
  },
  {
    number: "04",
    title: "Curated Activities",
    body: "Temple tour, Balinese swing activity, fire show, beach day, photo day in bright colors, shared storytelling, and dancing. Culture, joy, and sisterhood woven into every day.",
  },
  {
    number: "05",
    title: "Luxury Welcome Gift",
    body: "A personalized welcome bag with thoughtfully selected luxury wellness gifts to open together, the intention starts before the first morning.",
  },
  {
    number: "06",
    title: "Airport Transfers & Pre-Trip Call",
    body: "Luxury transportation to and from DPS included. Plus a group call with Yvette before you land so you arrive already feeling held.",
  },
];

const COVERAGE: readonly RetreatCoverage[] = [
  {
    label: "NOT INCLUDED",
    lines: ["Airfare to and from", "I Gusti Ngurah Rai International Airport (DPS)"],
  },
  {
    label: "ALSO NOT INCLUDED",
    lines: ["Travel insurance", "(strongly recommended)"],
    cta: "VIEW COVERAGE OPTIONS",
  },
  {
    label: "ALWAYS INCLUDED",
    lines: ["Luxury airport transfers", "are part of every package"],
  },
];

/**
 * The source's fourteen questions, in its order and wording. The refund policy
 * is a financial term: it is the published wording exactly, and the Retreat
 * Terms & Agreement it names has no page of its own here yet, so the link goes
 * to /terms, where the redirect map also sends /retreatagreement.
 */
const FAQS: readonly RetreatFaq[] = [
  {
    q: "Are CEUs offered at this retreat?",
    a: "No. And that is intentional. If you have been on retreats before where you still had to work, still had to learn, still had to produce something, this is not that. FlourisHealer Retreats exist for one reason: to give you the experience of receiving. No agenda. No credentials. No content to create. Just you, finally resting.",
  },
  {
    q: "Who is this retreat designed for?",
    a: "This retreat is designed for women healthcare and mental health professionals who spend their careers caring for, supporting, and holding space for others, including therapists, nurses, nurse practitioners, physicians, allied health professionals, and other women in helping professions. This retreat is about stepping away from the roles you carry every day and allowing yourself to receive.",
  },
  {
    q: "What is the total group size?",
    a: "This retreat is limited to twelve women. That intimacy is intentional. Twelve women in one private villa creates genuine connection and a space where you can fully exhale.",
  },
  {
    q: "What is included in my package?",
    a: "Your package includes five nights in the villa, all meals, wellness experiences, curated activities, and luxury airport transfers.",
  },
  {
    q: "What is not included in my package?",
    a: "Airfare and travel insurance are not included. Flight costs and routes vary too much from woman to woman for us to build one into the package, so booking your own means you get the best price and schedule for where you are flying from. Travel insurance is strongly recommended. You are welcome to choose any provider that meets your needs, we suggest Trawick International for convenience.",
  },
  {
    q: "What is my room like?",
    a: "Every attendee enjoys a Private King Suite, your own private bedroom with a king bed and en suite bathroom, your own quiet space to retreat into each night, inside the shared luxury of the full villa. Attending with a friend and hoping to room together? Email retreats@bossclinician.com and ask about our companion room option.",
  },
  {
    q: "How does the payment plan work?",
    a: "A $500 deposit secures your spot. The remaining $5,000 balance is then divided into equal monthly payments based on your enrollment date, with the full balance due by June 8, 2027. Checkout will show your exact monthly schedule. The earlier you enroll, the lower your monthly payment.",
  },
  {
    q: "When is the final payment due?",
    a: "All payments must be completed in full by June 8, 2027, one week before the retreat begins on June 15. See the cancellation and refund policy below for what happens if a balance is not paid by this date.",
  },
  {
    q: "What is the cancellation and refund policy?",
    a: "All retreat payments are non-refundable. If you need to cancel while your payments are current, eligible payments made beyond your $500 non-refundable deposit may be applied as a credit toward a future FlourisHealer retreat within 12 months, subject to availability. Missed payments or failure to pay the balance by the final deadline may result in forfeiture of your reservation and payments made. Please review the full Retreat Terms & Agreement before purchasing.",
    link: { label: "Retreat Terms & Agreement", to: "https://www.bossclinician.com/retreatagreement" },
  },
  {
    q: "Do I have to come with someone?",
    a: "Not at all. You are welcome to come solo, in fact, many retreat guests do. The experience is intentionally designed so you arrive as an individual and have opportunities to naturally connect with the other women throughout the week.",
  },
  {
    q: "How structured are the six days?",
    a: "There is a thoughtfully curated rhythm to the retreat, but this is not a packed itinerary. There will be experiences we share together as well as room to rest, wander, sit by the pool, book quiet time, or simply do nothing.",
  },
  {
    q: "I have dietary restrictions. Can those be accommodated?",
    a: "Yes. Our private villa chef can accommodate most dietary needs and restrictions. You will receive a form before the retreat to share your specific requirements. If you have severe allergies, please reach out directly so we can discuss the details ahead of time.",
  },
  {
    q: "When should I book my flight?",
    a: "Airfare pricing shifts constantly, so we leave the timing of your purchase entirely up to you. Just know that your flight details are needed when you complete your retreat forms, so plan to have your flight booked before filling those out.",
  },
  {
    q: "How do I secure my spot?",
    a: "Spots are limited to twelve women and fill in the order reservations are received. Choose your payment option above to lock in your place. Remember, all payments must be completed by June 8, 2027, see the cancellation and refund policy above for details.",
  },
];

export const retreat = {
  seo: {
    title: "Release. Restore. Reconnect.",
    description:
      "A luxury wellness retreat in Ubud, Bali for twelve women mental health and wellness professionals. June 15–20, 2027.",
  },

  hero: {
    eyebrow: `BALI, INDONESIA${DOT}JUNE 15–20, 2027`,
    title: "You have been taking care of everyone.",
    titleAccent: "When was the last time someone took care of you?",
    triad: ["Release.", "Restore.", "Reconnect."],
    ledeA: "A LUXURY WELLNESS RETREAT FOR WOMEN MENTAL HEALTH AND WELLNESS PROFESSIONALS",
    ledeB:
      "BECAUSE THE WOMEN WHO SPEND THEIR LIVES HOLDING SPACE FOR OTHERS DESERVE A SPACE CREATED JUST FOR THEM.",
    strip: `6 DAYS${DOT}5 NIGHTS${DOT}12 WOMEN${DOT}ONE PRIVATE VILLA IN UBUD, BALI`,
    reserveCta: "RESERVE YOUR PLACE",
    discoverCta: "DISCOVER THE EXPERIENCE",
  },

  stats: [
    { value: "6", lines: ["DAYS IN", "BALI"] },
    { value: "5", lines: ["NIGHTS", "VILLA"] },
    { value: "12", lines: ["WOMEN", "ONLY"] },
    { value: "1", lines: ["PRIVATE", "VILLA"] },
  ],

  about: {
    eyebrow: "THE RETREAT",
    title: "Designed for the women who hold space for everyone.",
    titleAccent: "It is time someone held space for you.",
    body: [
      "You are a mental health professional. You spend your days holding space for others, listening, healing, supporting. You know what rest should look like. You teach it to your clients. And somehow you are still the last person on your own list.",
      "Everyone sees the successful clinician you have become.",
      "Very few people see what it takes to keep holding it all together.",
      "You tell yourself you will rest after the next session block. After the next quarter. After things settle.",
      "But somehow they never do.",
      "The retreats you have taken before? More work in a different location. Another CEU. Another credential. Another thing to justify the trip.",
      "You have never just stopped.",
      "I built this because I have been exactly where you are. In 2022 I was a clinician, a doctoral student, a business owner, and a mom running completely on empty.",
      "In 2023 I went on my first retreat. On the last day I made myself a promise.",
    ],
    promise: "One day I am going to create this for other women.",
    kept: "This is that promise kept.",
    photo: {
      src: "/images/retreat-villa-aerial.webp",
      alt: "The private Ubud villa from above: a long green pool, sun loungers under palms, and two storeys of glass bedrooms behind them",
      width: 1400,
      height: 1050,
    } satisfies RetreatPhoto,
  },

  founder: {
    eyebrow: "THIS IS STILL SOMETHING I DO FOR MYSELF",
    title: "I built FlourisHealer",
    titleAccent: "because I needed it first.",
    body: [
      "In July 2026, I went on a retreat in Thailand. Not for my clients. Not for content. For me.",
      "I came home feeling more grounded, clear, and rested than I had in a long time. I noticed that the clarity I came home with changed the way I moved through my business, my relationships, and my own clinical work.",
    ],
    pull: "That is what I want for you in Bali.",
    close:
      "This is our first FlourisHealer retreat. I am bringing everything I have learned from every retreat I have invested in since 2023, and everything I know about what women in this field actually need to exhale, into six days in Ubud.",
  },

  included: {
    eyebrow: "WHAT'S INCLUDED",
    title: "This is not a training.",
    titleAccent: "This is a retreat.",
    body: [
      "You have done the workshops. You have sat through the CEU trainings. You have attended the conferences and come home with a notebook full of strategies and a body that is still exhausted. You do not need more information. You need permission to stop.",
      "For six days in Bali, someone else plans, cooks, coordinates, and holds the space. Your only responsibility is to receive.",
    ],
    items: INCLUSIONS,
  },

  intimacy: {
    eyebrow: "THE INTIMACY IS THE POINT",
    title: "Why twelve women.",
    titleAccent: "Why this villa.",
    blocks: [
      {
        title: "Why Only 12 Women",
        body: [
          "This is not a conference. It is not a room of a hundred people nodding along to a speaker and going home strangers. Twelve women in one private villa means you are not performing for anyone. You are not managing your face. You get to actually be known, by the end of six days, by name and by story, not just by profession.",
          "Smaller also means safer. The kind of rest we are talking about, the kind where your nervous system actually lets go, does not happen in a crowd. It happens when you know exactly who is in the room with you.",
        ],
      },
      {
        title: "Why This Villa",
        body: [
          "We chose one private twelve bedroom estate in Ubud on purpose. No hotel staff walking through common areas. No other guests at the pool. No shared spaces with strangers. The entire property, both infinity pools, the yoga shala, the gym, the spa facility, is only for the twelve of us the entire time we are there.",
          "That privacy is not a luxury detail. It is what makes it possible for you to actually exhale. You cannot fully let your guard down in a space you are sharing with people who do not know what you carry. Here, you do not have to.",
        ],
      },
    ],
  },

  /**
   * The source's four-cell gallery strip, in its order and under its own
   * labels. The alt text describes the photograph; repeating the label into it
   * would tell a screen reader nothing it has not already been given.
   */
  gallery: [
    {
      label: "VILLA",
      src: "/images/retreat-villa-lounge.webp",
      alt: "A sunken outdoor lounge of long cushioned benches under a timber pergola, open on one side to a green plunge pool and rice terraces",
      width: 1200,
      height: 800,
    },
    {
      label: "POOL",
      src: "/images/retreat-villa-pool.webp",
      alt: "Day beds and rolled towels under wide parasols along a turquoise lap pool, palms and jungle catching the late sun behind",
      width: 1200,
      height: 800,
    },
    {
      label: "DINING",
      src: "/images/retreat-villa-dining.webp",
      alt: "The villa's double-height living room at dusk: a long sectional sofa, a laid table for twelve under woven pendant lights, and the open kitchen beyond",
      width: 1200,
      height: 800,
    },
    {
      label: "WELLNESS",
      src: "/images/retreat-villa-shala.webp",
      alt: "The open-sided yoga shala, mats laid out in rows on a teak deck under a slatted timber ceiling, bamboo and jungle on every side",
      width: 1200,
      height: 800,
    },
  ] satisfies readonly (RetreatPhoto & { label: string })[],

  moments: {
    eyebrow: "RETREAT MOMENTS",
    title: "This is what receiving looks like.",
    photos: [
      {
        caption: "LUXURY & REST",
        src: "/images/retreat-luxury-rest.jpg",
        alt: "An outdoor stone bath strewn with flower petals, set in a private garden",
        width: 1200,
        height: 800,
      },
      {
        caption: "SISTERHOOD",
        src: "/images/retreat-sisterhood.jpg",
        alt: "Five retreat guests leaning in together for a photograph, all smiling",
        width: 1200,
        height: 1599,
      },
      {
        caption: "PURE JOY",
        src: "/images/retreat-joy.jpg",
        alt: "Three women laughing together on a sunlit terrace above the ocean",
        width: 1200,
        height: 1800,
      },
    ] satisfies readonly (RetreatPhoto & { caption: string })[],
  },

  pattern: {
    eyebrow: "THIS IS NOT A VACATION",
    title: "It is about",
    titleAccent: "interrupting a pattern.",
    lead: "The pattern that tells you:",
    lines: [
      "“I will go after I get caught up.”",
      "“I cannot leave my clients.”",
      "“My practice needs me right now.”",
      "“I will do something for myself next year.”",
    ],
    body: "You help your clients break patterns every week. You know the cost of chronic stress better than almost anyone. And yet here you are. Still waiting. Still last on your own list.",
    pull: [
      "Sometimes the hardest part is not leaving for six days.",
      "It is believing you are allowed to.",
    ],
    cost: "What is the cost of never giving yourself permission?",
    costBody: "To your health. Your relationships. Your clinical presence. Your joy. Your practice.",
    close: "At some point choosing yourself stops being indulgent. It becomes necessary.",
  },

  returns: {
    lead: "She returns not because Bali fixed her. She returns because she finally experienced what it feels like to be fully held.",
    body: "She notices when guilt, not wisdom, is driving her decisions. She no longer believes rest has to be earned. She leads her practice from clarity instead of chronic depletion. She comes home and her clients feel it. Not because she told them. Because something in her is different.",
    caps: "CARING FOR HERSELF DID NOT WEAKEN HER LEADERSHIP. IT STRENGTHENED IT.",
  },

  imagine: {
    eyebrow: "CLOSE YOUR EYES",
    title: "Imagine ...",
    stanzas: [
      [
        "Stepping off the plane and someone is already waiting for you.",
        "Holding a sign with your name on it.",
      ],
      [
        "Walking into a villa where everything has been thought of.",
        "Nothing for you to plan. Nothing for you to manage.",
      ],
      [
        "Waking up with nowhere to rush.",
        "Breakfast floating toward you in the pool.",
        "Flower petals on the water.",
      ],
      [
        "Laughing at a dinner table with women who get it.",
        "Nobody needing anything from you.",
        "Nothing to hold together.",
      ],
      [
        "And coming home to your practice, your family, your life",
        "as a woman who finally got poured into.",
      ],
    ],
    closeA: "That is not a daydream.",
    closeB: "That is June 15-20, 2027. And your room is waiting.",
  },

  reserve: {
    eyebrow: "LIMITED TO 12 WOMEN",
    title: "Stop saying next year.",
    titleAccent: "Next year is now.",
    strip: `BALI${DOT}JUNE 15–20, 2027${DOT}LUXURY RETREAT PACKAGE`,
    price: "Private King Suite $5,500",
    terms: `All payments due by June 8, 2027${DOT}See cancellation and refund policy in the FAQ`,
    includedLabel: "WHAT'S INCLUDED IN YOUR PRIVATE KING SUITE",
    included: [
      "Your own private bedroom with a king bed and en suite bathroom",
      "Five nights in the private villa, with full run of both infinity pools, the yoga shala, gym, and spa facility",
      "All chef-prepared meals, breakfast, brunch, and dinner, daily",
      "Flower bath, in-villa massages and spa day, and a full cabana day at the pool",
      "Your choice of Healing Meditation or Palm Reading and Holy Water Ceremony",
      "Temple tour, Balinese swing, fire show, beach day, photo day, and shared storytelling",
      "A personalized luxury welcome gift",
      "Luxury airport transfers and a pre-trip group call with Yvette",
    ],
    includedNote: "Airfare and travel insurance are not included, see the FAQ below for details.",
    options: [
      {
        label: "PAY IN FULL",
        amount: "$5,500",
        body: "One payment, reservation complete.",
        primary: true,
      },
      {
        label: "PAYMENT PLAN",
        amount: "$500 deposit",
        body: "$500 deposit, then the remaining balance divided into monthly payments based on your enrollment date. All balances must be paid in full by June 8, 2027. The earlier you reserve, the lower your monthly payments.",
        primary: false,
      },
    ],
    cta: "RESERVE YOUR PLACE",
    ctaNote: "Choose pay in full or the payment plan at checkout.",
    scarcity: `RESERVE BEFORE SPOTS CLOSE${DOT}LIMITED TO 12 WOMEN`,
    insurance:
      "Travel insurance is strongly recommended. You are welcome to choose any provider that meets your needs. For convenience, you can view options from Trawick International below.",
    insuranceCta: "VIEW TRAVEL INSURANCE OPTIONS",
  },

  host: {
    eyebrow: "YOUR HOST",
    title: "She has been",
    titleAccent: "exactly where you are.",
    tag: "YVETTE HOWARD, LCSW",
    photo: {
      src: "/images/retreat-host-yvette.webp",
      alt: "Yvette Howard, LCSW, arms folded and smiling, in a T-shirt reading Empowered Women Empower The World",
      width: 882,
      height: 1440,
    } satisfies RetreatPhoto,
    bodyA:
      "Yvette Howard is a Licensed Clinical Social Worker, doctoral candidate, and founder of Boss Clinician, LLC, helping therapists and psych NPs build sustainable private practices. She is a group practice owner, a mom, and a woman who knows firsthand what it feels like to pour everything into everyone else while quietly losing yourself in the process.",
    bodyB:
      "At the end of 2022 she was depleted in a way she could not explain. Doctoral program. Two businesses. Clients. Family. She kept adding more because she thought more was the answer. It was not.",
    pullA: [
      "I kept telling myself I would rest after.",
      "After the doctoral program.",
      "After the business stabilized.",
      "After hiring.",
      "After the next launch.",
    ],
    pullB: "I kept moving the finish line.",
    pullC: ["Until I realized I was not waiting for time.", "I was waiting for permission."],
    bodyC:
      "In 2023 she went on her first retreat and found something she had been missing for years. Real rest. Women who understood her. The feeling of someone else handling everything while she just existed. On the last day she made herself a promise. One day I am going to create this for other women.",
    bodyD:
      "She has invested in retreats every year since. She built this one from everything she has learned, with intention, with care, and with you specifically in mind.",
    bodyE: "This retreat is her promise kept.",
    credentials: [
      "Licensed Clinical Social Worker (LCSW)",
      "Doctoral Candidate",
      "Founder, Boss Clinician, LLC",
      "Private Practice Strategist",
      "Group Practice Owner",
    ],
  },

  bali: {
    lineA: "Not because Bali changes you.",
    lineB:
      "Because sometimes the environment you have been surviving in is not the one where you can finally hear yourself again.",
  },

  coverage: COVERAGE,

  quiz: {
    eyebrow: "STILL ON THE FENCE?",
    title: "Take the Burnout",
    titleAccent: "Self-Assessment",
    body: "Six honest questions about how you are actually doing, not how you tell everyone you are doing. Two minutes. Just you and the truth. If your cup is running lower than you have been letting on, this is the sign to stop waiting.",
    cta: "TAKE THE QUIZ",
  },

  faq: {
    eyebrow: "COMMON QUESTIONS",
    title: "Everything you",
    titleAccent: "need to know",
    questions: FAQS,
  },
} as const;
