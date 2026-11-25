/**
 * FlourisHealer Retreats — Bali, June 15–20 2027. The sales page copy.
 *
 * Transcribed from www.bossclinician.com/retreats (19 September 2026), band by
 * band and in the page's own order: hero → the numbers → the retreat → why
 * Yvette built it → what's included → why eleven guests → the villa gallery →
 * retreat moments → the pattern → the woman who returns → imagine → reserve →
 * your host → why Bali → what is and is not included → the burnout quiz → the
 * fourteen questions (seventeen since the 22 Nov 2026 travel FAQ and the second
 * 22 Nov owner reply, item 4: dietary, activity, mobility and transport answers
 * in her exact wording; transport is designated group transfers, never on demand).
 *
 * 21 November 2026 website handoff (sheet row 245, section 10): hero,
 * recognition, experience, audience/objections, host story, reservation
 * lead-in and closing use the approved ready-to-paste copy; dates, venue,
 * inclusions, prices and the 11 + Yvette guest count are unchanged.
 *
 * The 25 October owner update makes the private $5,500 room the public
 * reservation option. 22 November 2026 (owner email, item 4): shared rooms are
 * not available for public booking, so no shared price or option appears on
 * this page; the travel facts (Ubud, June 15–20, arrival June 15, checkout
 * June 20, DPS, designated group transfers) use her wording. The checkout offer and legal terms use the same amount.
 * The final payment date and cancellation policy retain the published terms. The separators in the uppercase strips
 * are non-breaking space + middle dot, written as escapes so a later edit
 * cannot silently turn them into ordinary spaces.
 *
 * The shared app provides navigation and footer. Source photographs, including
 * embedded photos of Yvette and the included experiences, are stored locally.
 */

const DOT = " · ";

/**
 * Public private-room checkout. The shared-room offer is invitation-only
 * (migration 217): Yvette arranges it privately, so nothing here links to it.
 * Internal on purpose: no button on this site sends a visitor to Kajabi.
 */
export const RETREAT_RESERVE_ROUTE = "/checkout/bali-private-room";

/** The travel insurance provider the page names, by its own link. */
export const RETREAT_TRAWICK_URL = "https://trawickinternational.com/";

/** Yvette's retreat conversation booking page. */
export const RETREAT_CALL_URL = "https://tidycal.com/profitwithyvette/retreat";

/**
 * The six-question Burnout Self-Assessment, served by this site at its original
 * path. The legacy `redirects` row /retreat-needed-quiz -> /retreats must be
 * gone once that page is live, or this button loops back to this page.
 */
export const RETREAT_QUIZ_URL = "/retreat-needed-quiz";

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
            body: ", traditional Balinese massage and additional restorative spa time, performed by local practitioners. The on-site arrangements described here are organized for you.",
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
            body: ", a guided stillness practice drawing on Balinese spiritual wisdom, using breath, visualization, and sound.",
          },
          {
            name: "Palm Reading and Holy Water Ceremony",
            body: ", an intimate cultural experience with a Balinese palm reading, followed by a holy water ceremony.",
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
    body: "Airport transportation is provided through designated group transfers during June 15–20, 2027. Final shuttle windows will be coordinated with guests and shared before travel. Plus a group call with Yvette before you land so you arrive already feeling held.",
  },
];

const COVERAGE: readonly RetreatCoverage[] = [
  {
    label: "NOT INCLUDED",
    lines: ["Airfare to and from", "Ngurah Rai International Airport, Denpasar (DPS)"],
  },
  {
    label: "ALSO NOT INCLUDED",
    lines: ["Travel insurance", "(strongly recommended)"],
    cta: "VIEW COVERAGE OPTIONS",
  },
  {
    label: "ALWAYS INCLUDED",
    lines: ["Designated group airport transfers", "during June 15–20"],
  },
];

/**
 * The source's fourteen questions, in its order and wording, plus the 22 Nov
 * 2026 travel question (owner email item 4) after the flight question, and the
 * activity-participation and mobility questions after the dietary one (second 22 Nov
 * reply, item 4, her wording verbatim: no replacement activity or treatment is
 * promised). The refund policy
 * is a financial term: it is the published wording exactly, and the Retreat
 * Terms & Agreement it names has no page of its own here yet, so the link goes
 * to /terms, where the redirect map also sends /retreatagreement.
 */
const FAQS: readonly RetreatFaq[] = [
  {
    q: "Are CEUs offered at this retreat?",
    a: "No. And that is intentional. If you have been on retreats before where you still had to work, still had to learn, still had to produce something, this is not that. FlourisHealer Retreats exist for one reason: to give you the experience of receiving. No professional training agenda. No credentials. No content to create. Just you, finally resting.",
  },
  {
    q: "Who is this retreat designed for?",
    a: "This retreat is designed for women healthcare and mental health professionals who spend their careers caring for, supporting, and holding space for others, including therapists, nurses, nurse practitioners, physicians, allied health professionals, and other women in helping professions. This retreat is about stepping away from the roles you carry every day and allowing yourself to receive.",
  },
  {
    q: "What is the total group size?",
    a: "The group is limited to 11 guests plus Yvette, for 12 people total. That intimacy is intentional. One private villa creates space for genuine connection and a chance to fully exhale.",
  },
  {
    q: "What is included in my package?",
    a: "Your package includes five nights in the villa, all meals, wellness experiences, curated activities, and designated group airport transfers during June 15–20.",
  },
  {
    q: "What is not included in my package?",
    a: "Airfare and travel insurance are not included. Flight costs and routes vary too much from woman to woman for us to build one into the package, so booking your own means you get the best price and schedule for where you are flying from. Travel insurance is strongly recommended, not required. You are welcome to choose any provider that meets your needs, we suggest Trawick International for convenience.",
  },
  {
    q: "What is my room like?",
    a: "The Private King Suite is $5,500 per person. You have the room to yourself. For room questions, email retreats@bossclinician.com.",
  },
  {
    q: "How does the payment plan work?",
    a: "Reserve your room with a $500 deposit. The remaining $5,000 is divided into monthly payments based on when you enroll. The earlier you reserve, the lower your monthly payment. All balances must be paid in full by June 8, 2027. Payment plans are available for new enrollments before February 1, 2027 only. From February onward, new enrollments require payment in full. Your checkout shows each payment amount and date.",
  },
  {
    q: "When is the final payment due?",
    a: "All payments must be completed in full by June 8, 2027, one week before the retreat begins on June 15. See the cancellation and refund policy below for what happens if a balance is not paid by this date.",
  },
  {
    q: "What is the cancellation and refund policy?",
    a: "All retreat payments are non-refundable. If you need to cancel while your payments are current, eligible payments made beyond your $500 non-refundable deposit may be applied as a credit toward a future FlourisHealer retreat within 12 months, subject to availability. Missed payments or failure to pay the balance by the final deadline may result in forfeiture of your reservation and payments made. Please review the full Retreat Terms & Agreement before purchasing.",
    link: { label: "Retreat Terms & Agreement", to: "/retreatagreement" },
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
    a: "Please share dietary preferences, restrictions, and allergies in your pre-retreat questionnaire. We’ll review requests with the villa team and confirm what can be accommodated. For severe allergies, contact retreats@bossclinician.com before booking.",
  },
  {
    q: "Do I have to take part in every activity?",
    a: "You’re welcome to opt out of an activity and take personal time. Please let us know so we can coordinate the group’s plans. Contact us about any activity-specific concerns before travel.",
  },
  {
    q: "What if I have mobility or accessibility needs?",
    a: "If you have mobility or accessibility needs, please contact retreats@bossclinician.com before booking. We’ll confirm relevant details about the villa, transportation, and planned activities so you can assess whether the retreat meets your needs.",
  },
  {
    q: "When should I book my flight?",
    a: "Airfare pricing shifts constantly, so we leave the timing of your purchase entirely up to you. You can complete your retreat profile before you book, then return to your dashboard to add your airline, flight number, and arrival and departure times once your flight is booked.",
  },
  {
    q: "Where and when is the retreat, and how do I get there?",
    a: "The retreat is in Ubud, Bali. Fly into Ngurah Rai International Airport, Denpasar (DPS). The retreat runs June 15–20, 2027, with checkout June 20. Airport transportation is provided through designated group transfers during these dates. Final shuttle windows will be coordinated with guests and shared before travel. Airfare and travel insurance are not included.",
  },
  {
    q: "How do I secure my spot?",
    a: "The retreat is designed for 11 guests plus Yvette, for 12 people total. Choose your payment option above to lock in your place. Remember, all payments must be completed by June 8, 2027, see the cancellation and refund policy above for details.",
  },
];

export const retreat = {
  seo: {
    title: "Bali Retreat for Women Therapists | FlourisHealer",
    description:
      "A luxury wellness retreat in Ubud, Bali for women therapists and other mental health and wellness professionals, hosted by Yvette. June 15–20, 2027.",
  },

  /**
   * 21 Nov 2026 handoff (row 245, section 10). Order is fixed by the developer
   * note: brand name → tagline → H1 → paragraph → dates and location → Explore
   * the Retreat → Have Questions? Talk With Yvette. The tagline stays a smaller
   * line above the H1, never part of it.
   */
  hero: {
    brand: "FLOURISHEALER RETREATS",
    tagline: "Release. Restore. Reconnect.",
    title: "You Spend Your Days Making Room for Other People.",
    titleAccent: "This Is Time Set Aside for You.",
    lede: "A six-day, five-night Bali retreat for women in mental health and wellness who want room to rest, enjoy themselves, and connect beyond the provider role.",
    when: "June 15–20, 2027 • Ubud, Bali",
    exploreCta: "Explore the Retreat",
    questionsCta: "Have Questions? Talk With Yvette",
    /** The Imagine band's button to the reservation block. */
    reserveCta: "RESERVE YOUR PLACE",
  },

  stats: [
    { value: "6", lines: ["DAYS IN", "BALI"] },
    { value: "5", lines: ["NIGHTS", "VILLA"] },
    { value: "12", lines: ["WOMEN", "ONLY"] },
    { value: "1", lines: ["PRIVATE", "VILLA"] },
  ],

  /** Row 256 (24 Nov): owner's Bali villa walkthrough video, placed after the stats. */
  video: {
    eyebrow: "A GLIMPSE INTO WHAT’S POSSIBLE",
    title: "Imagine Six Days Where You Don’t Have to Be Everything to Everyone.",
    body: [
      "Imagine waking up without a client to prepare for, a team to manage, or an itinerary to coordinate. Six days to laugh, explore, be cared for, and reconnect with the woman you are outside of everything you do for others.",
      "This is the intention behind FlourisHealer.",
    ],
    cta: "Explore Your Bali Experience",
    playerTitle: "Behind the scenes: a preview of the Bali retreat villa",
    prefix: "/videos/retreat-bali-preview-v1",
    captions: "/videos/captions/retreat-bali-preview-v1.en.vtt",
    playLabel: "Watch the villa tour",
    duration: "4:51",
  },

  /** Recognition (21 Nov handoff, ready-to-paste). */
  about: {
    eyebrow: "THE RETREAT",
    title: "Your Last Appointment Ends.",
    titleAccent: "The Day Still Hasn’t Let Go of You.",
    body: [
      "Maybe you sit in the car for a few minutes before going inside because you need a moment when nobody needs an answer.",
      "You spend your workday listening closely, making decisions, and responding to other people’s needs. By the time you have space for yourself, you may not have the energy to decide what would feel good.",
      "You can explain why rest matters and still feel guilty making room for your own. Even when the people around you support you going, you may find yourself asking whether taking this much time for yourself is selfish.",
      "And a vacation? Sometimes that becomes another thing you manage—the research, the reservations, the group chat, and the work messages you keep checking while you’re away.",
    ],
    pull: "You don’t need another assignment about taking care of yourself. You may need time that is actually set aside for it.",
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
      "I came home feeling more grounded, clear, and rested than I had in a long time—and that clarity showed up in the decisions I made.",
      "I redesigned the Boss Clinician logo to reflect the true meaning behind the name. I gained connections with like-minded women who continue to support my businesses. And I experienced the peace of knowing my group practice could keep running—and I could still get paid—while I trusted my team to hold things down without me.",
      "I also came home with new ways to keep myself grounded and a deeper commitment to taking care of my health. The experience gave me space to think about what I needed and how I wanted to move forward, both personally and as a business owner.",
    ],
    /** Sits where the old “That is what I want for you in Bali” line was. */
    pull: "That’s part of what inspired the experience I’m creating for you in Bali: space to rest, connect, and hear yourself clearly enough to decide what you want to carry home.",
    /** 21 Nov handoff r247: whole portrait photo, never cropped. */
    photo: {
      src: "/images/retreat-founder-thailand-portrait.webp",
      alt: "A breathwork session on a seaside deck in Thailand: women lie on blue towels wearing eye masks and headphones while a woman in a patterned kimono stands beside them",
      width: 942,
      height: 1670,
    } satisfies RetreatPhoto,
    close:
      "This is our first FlourisHealer retreat. I am bringing everything I have learned from every retreat I have invested in since 2023, and everything I know about what women in this field actually need to exhale, into six days in Ubud.",
  },

  included: {
    eyebrow: "WHAT'S INCLUDED",
    title: "Rest, Connection, and an Experience",
    titleAccent: "Worth Looking Forward To.",
    body: [
      "Five nights at a private villa in Ubud give our group a shared place to settle in. Chef-prepared meals take everyday meal planning off your plate while you are with us. Spa experiences, time by the pool, cultural outings, and shared meals create different ways to enjoy the week.",
      "Maybe you promised yourself a trip after getting licensed, opening your practice, or reaching a milestone you worked years for. Then the next responsibility arrived, and celebrating yourself got pushed back again. This can be time to enjoy what you have worked toward—with room for rest, new experiences, and connection. You do not need to arrive with a breakthrough to achieve or a business goal to complete.",
    ],
    items: INCLUSIONS,
  },

  intimacy: {
    eyebrow: "THE INTIMACY IS THE POINT",
    title: "Why eleven guests.",
    titleAccent: "Why this villa.",
    blocks: [
      {
        title: "Why Only 11 Guests",
        body: [
          "This is not a conference. It is not a room of a hundred people nodding along to a speaker and going home strangers. Eleven guests and Yvette in one private villa means you are not performing for anyone. You are not managing your face. You get to actually be known, by the end of six days, by name and by story, not just by profession.",
        ],
      },
      {
        title: "Why This Villa",
        body: [
          "We chose one private twelve bedroom estate in Ubud on purpose. No other guests at the pool. No shared spaces with strangers. The entire property, both infinity pools, the yoga shala, the gym, the spa facility, is only for our group of twelve, including me, the entire time we are there.",
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
        alt: "Five women leaning in together for a photograph, all smiling",
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

  /**
   * Audience and objections (21 Nov handoff, ready-to-paste). Takes the band the
   * old “interrupting a pattern” narrative held. The old “woman who returns”
   * band is gone: it promised permanent change and that clients would feel it.
   */
  audience: {
    title: "A Room Full of Women Who Understand the Work—",
    titleAccent: "Without Making the Whole Week About Work.",
    body: [
      "FlourisHealer is for women in mental health and wellness who spend much of their professional lives caring for, guiding, or supporting other people.",
      "You may be a therapist, a psychiatric provider, or a wellness practitioner. You may work for an organization, own your practice, or be considering your next chapter. You do not need to be a business owner or a Boss Clinician member.",
      "You can love your work and still want time away from being the person who is always available.",
    ],
    objections: [
      {
        q: "“I’m interested, but taking time away feels like a lot.”",
        // The handoff says "described below"; on this page the inclusions sit above this band.
        a: "That makes sense. For some providers, time away means arranging coverage, adjusting appointments, budgeting for fewer billable hours, or coordinating responsibilities at home. The retreat does not remove those realities. It gives you dates and an experience to plan toward, with a pre-trip group call and the on-site arrangements described above. Review the full cost and travel requirements before deciding.",
      },
      {
        q: "“I would be coming by myself.”",
        a: "You may have wanted a trip like this for a while, but finding a friend whose schedule lines up has kept it in the group chat. You do not have to arrive with a friend. You can reserve your place and join women with a shared connection to mental health and wellness. The pre-trip group call offers an opportunity to meet before traveling, and shared meals and experiences create ways to get to know one another during the week.",
      },
      {
        q: "“Is this a training or a networking event?”",
        a: "No CEUs are offered. The retreat is centered on rest, connection, and the Bali experience. There is no business curriculum to complete and no need to make this trip a professional-development project.",
      },
      {
        q: "“I want to go, but I need to understand the full cost.”",
        a: "Wanting the experience and thinking carefully about the money can both be true. Private rooms are $5,500. Airfare and travel insurance are additional charges. Review the room options, included experiences, deposit, remaining payment schedule, and cancellation terms together so you can decide whether the trip fits your budget and responsibilities at home.",
      },
      {
        q: "“Can I bring a friend who works in wellness?”",
        a: "This retreat welcomes women in mental health and wellness, including therapists and wellness practitioners. You do not need to own a practice or be a Boss Clinician member. If you and a friend are considering attending, review the room options together and ask Yvette about availability and shared-room arrangements before reserving.",
      },
    ],
  },

  /** Desire and experience (21 Nov handoff, ready-to-paste), in the Imagine band. */
  imagine: {
    eyebrow: "CLOSE YOUR EYES",
    title: "Imagine Having Less to Coordinate Once You Arrive.",
    body: [
      "Breakfast is being prepared. Your accommodation is arranged. The group experiences are planned. You have space to enjoy Bali without being responsible for creating everyone else’s experience.",
      "There is time for a meal you can linger over. A conversation that isn’t a consultation. A new experience you choose because it interests you. A moment when you can notice what you want before moving to the next thing someone needs.",
      "That is the intention behind FlourisHealer: a hosted retreat where women in mental health and wellness can spend time together as people, beyond their professional roles.",
    ],
  },

  reserve: {
    eyebrow: "11 GUESTS + YVETTE",
    /** Reservation lead-in (21 Nov handoff, ready-to-paste). */
    title: "Choose the Room Option That Fits Your Trip.",
    leadA:
      "Review your accommodation, what is included, the total price, and the payment and cancellation terms before reserving. If you have questions about the experience or traveling with the group, ",
    leadLink: "schedule a retreat conversation with Yvette",
    leadB: ".",
    strip: `BALI${DOT}JUNE 15–20, 2027${DOT}LUXURY RETREAT PACKAGE`,
    price: "Private King Suite $5,500 per person",
    terms: `All payments due by June 8, 2027${DOT}See cancellation and refund policy in the FAQ`,
    includedLabel: "WHAT'S INCLUDED IN YOUR PRIVATE KING SUITE",
    included: [
      "A private king suite with a king bed and private en suite bathroom for all five nights",
      "Five nights in the private villa, with full run of both infinity pools, the yoga shala, gym, and spa facility",
      "All chef-prepared meals, breakfast, brunch, and dinner, daily",
      "Flower bath, in-villa massages and spa day, and a full cabana day at the pool",
      "Your choice of Healing Meditation or Palm Reading and Holy Water Ceremony",
      "Temple tour, Balinese swing, fire show, beach day, photo day, and shared storytelling",
      "A personalized luxury welcome gift",
      "Designated group airport transfers during June 15–20 and a pre-trip group call with Yvette",
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
        amount: "$500 Deposit",
        body: "Reserve with a $500 deposit, then divide the remaining $5,000 into monthly payments based on your enrollment date. The earlier you reserve, the lower your monthly payment. All balances are due by June 8, 2027.",
        primary: false,
      },
    ],
    cta: "Reserve a Private Room",
    ctaNote: "Choose pay in full or a $500 deposit with monthly payments. New payment plans close February 1, 2027; all balances are due by June 8, 2027.",
    scarcity: `11 GUESTS + YVETTE${DOT}12 PEOPLE TOTAL`,
    insurance:
      "Travel insurance is strongly recommended, not required. You are welcome to choose any provider that meets your needs. For convenience, you can view options from Trawick International below.",
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
    body: "Six honest questions about how you are actually doing, not how you tell everyone you are doing. Two minutes. Just you and the truth.",
    cta: "TAKE THE QUIZ",
  },

  faq: {
    eyebrow: "COMMON QUESTIONS",
    title: "Everything you",
    titleAccent: "need to know",
    questions: FAQS,
  },

  /**
   * Reservation closing (21 Nov handoff). The footer's /retreats next step
   * (content/site.ts footer.nextStep) carries the Talk With Yvette link.
   */
  closing: {
    body: "You do not have to wait until you have nothing left to make room for yourself. If this experience fits what you need and what you can plan for, we would love to welcome you to Bali.",
    cta: "Explore Room Options",
  },
} as const;
