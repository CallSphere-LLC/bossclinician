import { useId, useState } from "react";
import { Link } from "react-router";
import { motion, useReducedMotion } from "motion/react";
import { Seo } from "@/components/Seo";
import { GoldRule, Section, SectionTitle } from "@/components/luxe/Section";
import { GlassCard, type Accent } from "@/components/luxe/GlassCard";
import { LuxeButton, LuxePill } from "@/components/luxe/LuxeButton";
import { LuxePageHero } from "@/components/luxe/LuxePageHero";
import { RevealGroup, RevealItem } from "@/components/ui/Reveal";
import { useEntranceMotion } from "@/hooks/useEntranceMotion";
import { cn } from "@/lib/cn";
import { ORGANIZATION_ID, absoluteUrl, faqPageNode } from "@/seo/schema";
import type { JsonLdNode } from "@/seo/types";
import { useHeadContext } from "@/ssr/context";

/**
 * Retreats — FlourisHealer Retreats, Bali, June 15–20 2027.
 *
 * The longest page on the site, so it is built as one band per movement in the
 * live page's own order: hero → proof numbers → the retreat → what's included →
 * the villa → retreat moments → the pattern → the woman who returns → imagine →
 * reserve → your host → the closing line → what is and isn't included → FAQ.
 *
 * Every string below is reproduced character for character from the live page,
 * non-breaking spaces and en dashes included, which is why the separators are
 * written as explicit escapes rather than typed inline. The Kajabi cookie
 * banner, the in-page anchor nav and the Kajabi footer are chrome, not content,
 * and are not reproduced — the anchor ids the nav pointed at are kept so the
 * hero's own actions still land where they did.
 */

/* ══════════════════════════════════════════════════════════════════════════
   Shared vocabulary
   ══════════════════════════════════════════════════════════════════════════ */

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const VIEWPORT = { once: true, margin: "-12% 0px -8% 0px" } as const;

/** Cards cycle three accents so a long page of glass never reads as one wall. */
const ACCENTS: readonly Accent[] = ["gold", "plum", "green"];
const accentAt = (i: number): Accent => ACCENTS[i % ACCENTS.length];

/** One grading recipe for every photograph on the page. */
const GRADE = "brightness-[0.8] contrast-[1.06] saturate-[0.8]";

/**
 * One rise recipe for the whole page; only the delay changes. Reduced-motion
 * users get `initial={false}` — the final state on mount, never a blank element
 * waiting on an observer that never usefully fires.
 */
function rise(reduce: boolean | null, delay = 0) {
  return {
    initial: reduce ? false : { opacity: 0, y: 24 },
    whileInView: { opacity: 1, y: 0 },
    viewport: VIEWPORT,
    transition: { duration: 0.8, delay: reduce ? 0 : delay, ease: EASE },
  };
}

/** Foil numeral with a bloom behind it — flat foil reads dull at this size. */
function Numeral({ value, className }: { value: string; className?: string }) {
  return (
    <span className="relative inline-block shrink-0">
      <span
        aria-hidden
        className="pointer-events-none absolute -left-8 -top-9 h-28 w-28 rounded-full blur-2xl"
        style={{
          background: "radial-gradient(circle, rgba(201,164,106,0.20) 0%, transparent 70%)",
        }}
      />
      <span
        aria-hidden
        className={cn(
          "text-foil relative block font-display font-medium leading-none tracking-tight",
          className,
        )}
      >
        {value}
      </span>
    </span>
  );
}

/** Small uppercase separator strip (BALI · JUNE 15–20, 2027 · ALL-INCLUSIVE). */
function MetaStrip({ children, className }: { children: string; className?: string }) {
  return (
    <p
      className={cn(
        "text-pretty text-[0.72rem] font-semibold uppercase leading-[1.9] tracking-[0.11em] text-gold/85",
        "sm:text-[0.7rem] sm:tracking-[0.2em]",
        className,
      )}
    >
      {children}
    </p>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Content — verbatim from www.bossclinician.com/retreats
   ══════════════════════════════════════════════════════════════════════════ */

const HERO_EYEBROW = "BALI, INDONESIA  ·  JUNE 15–20, 2027";
const HERO_TITLE = "You have been taking care of everyone.";
const HERO_ACCENT = "When was the last time someone took care of you?";
const TRIAD = ["Release.", "Restore.", "Reconnect."] as const;
const HERO_LEDE_A = "A LUXURY WELLNESS RETREAT FOR WOMEN MENTAL HEALTH PROFESSIONALS";
const HERO_LEDE_B =
  "BECAUSE THE WOMEN WHO SPEND THEIR LIVES HOLDING SPACE FOR OTHERS DESERVE A SPACE CREATED JUST FOR THEM.";
const HERO_STRIP =
  "6 DAYS  ·  5 NIGHTS  ·  12 WOMEN  ·  ONE PRIVATE VILLA IN UBUD, BALI";

const STATS: readonly { value: string; lines: readonly [string, string] }[] = [
  { value: "6", lines: ["DAYS IN", "BALI"] },
  { value: "5", lines: ["NIGHTS", "VILLA"] },
  { value: "12", lines: ["WOMEN", "ONLY"] },
  { value: "1", lines: ["PRIVATE", "VILLA"] },
];

const ABOUT_BODY: readonly string[] = [
  "You are a mental health professional. You spend your days holding space for others — listening, healing, supporting. You know what rest should look like. You teach it to your clients. And somehow you are still the last person on your own list.",
  "Everyone sees the successful clinician you have become.",
  "Very few people see what it takes to keep holding it all together.",
  "You tell yourself you will rest after the next session block. After the next quarter. After things settle.",
  "But somehow they never do.",
  "The retreats you have taken before? More work in a different location. Another CEU. Another credential. Another thing to justify the trip.",
  "You have never just stopped.",
  "I built this because I have been exactly where you are. In 2022 I was a clinician, a doctoral student, a business owner, and a mom running completely on empty.",
  "In 2023 I went on my first retreat. On the last day I made myself a promise.",
];
const ABOUT_PROMISE = "One day I am going to create this for other women.";
const ABOUT_KEPT = "This is that promise kept.";

const EXPERIENCE_BODY: readonly string[] = [
  "You have done the workshops. You have sat through the CEU trainings. You have attended the conferences and come home with a notebook full of strategies and a body that is still exhausted. You do not need more information. You need permission to stop.",
  "For six days in Bali — someone else plans, cooks, coordinates, and holds the space. Your only responsibility is to receive.",
];

const INCLUSIONS: readonly { number: string; title: string; body: string }[] = [
  {
    number: "01",
    title: "Private Villa",
    body: "Six nights in a 12-bedroom private estate with two infinity pools, yoga shala, gym, and spa facility nestled in lush Ubud.",
  },
  {
    number: "02",
    title: "Chef-Prepared Meals",
    body: "Daily breakfast, brunch, and dinner prepared by your private villa chef. Outside villa meals included. Every bite, taken care of.",
  },
  {
    number: "03",
    title: "Wellness Experiences",
    body: "Sound bath, breathwork, Balinese massage, and flower bath — sequenced to restore your nervous system and reconnect you with yourself.",
  },
  {
    number: "04",
    title: "Curated Activities",
    body: "Temple tour, fire show, beach day, photo day in bright colors, shared storytelling, and dancing. Culture, joy, and sisterhood woven into every day.",
  },
  {
    number: "05",
    title: "Luxury Welcome Gift",
    body: "A personalized welcome bag with thoughtfully selected luxury wellness gifts to open together — the intention starts before the first morning.",
  },
  {
    number: "06",
    title: "Airport Transfers & Pre-Trip Call",
    body: "Luxury transportation to and from DPS included. Plus a group call with Yvette before you land so you arrive already feeling held.",
  },
];

const VILLA_LABELS = ["VILLA", "POOL", "DINING", "WELLNESS"] as const;

/** The villa photograph is served from the Kajabi CDN, so it is used as-is. */
const VILLA_IMAGE =
  "/images/migrated-b30c1c7757ef.png";

/**
 * The captions are the page's own labels for these frames, so the alt text has
 * to describe the photograph itself — a caption repeated into the alt tells a
 * screen reader nothing it has not already been told.
 */
const MOMENTS: readonly { src: string; alt: string; caption: string }[] = [
  { src: "/images/retreat-luxury-rest.jpg", alt: "Luxury outdoor bath", caption: "LUXURY & REST" },
  {
    src: "/images/retreat-sisterhood.jpg",
    alt: "Five retreat guests leaning in together for a photograph, all smiling",
    caption: "SISTERHOOD",
  },
  {
    src: "/images/retreat-joy.jpg",
    alt: "Three women laughing together on a sunlit terrace above the ocean",
    caption: "PURE JOY",
  },
];

const PATTERNS: readonly string[] = [
  '"I will go after I get caught up."',
  '"I cannot leave my clients."',
  '"My practice needs me right now."',
  '"I will do something for myself next year."',
];
const PATTERN_BODY =
  "You help your clients break patterns every week. You know the cost of chronic stress better than almost anyone. And yet here you are. Still waiting. Still last on your own list.";
const PATTERN_PULL: readonly string[] = [
  "Sometimes the hardest part is not leaving for six days.",
  "It is believing you are allowed to.",
];
const PATTERN_COST = "What is the cost of never giving yourself permission?";
const PATTERN_COST_BODY =
  "To your health. Your relationships. Your clinical presence. Your joy. Your practice.";
const PATTERN_CLOSE =
  "At some point choosing yourself stops being indulgent. It becomes necessary.";

const RETURNS_LEAD =
  "She returns not because Bali fixed her. She returns because she finally experienced what it feels like to be fully held.";
const RETURNS_BODY =
  "She notices when guilt — not wisdom — is driving her decisions. She no longer believes rest has to be earned. She leads her practice from clarity instead of chronic depletion. She comes home and her clients feel it. Not because she told them. Because something in her is different.";
const RETURNS_CAPS =
  "CARING FOR HERSELF DID NOT WEAKEN HER LEADERSHIP. IT STRENGTHENED IT.";

const IMAGINE_STANZAS: readonly (readonly string[])[] = [
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
];
const IMAGINE_CLOSE_A = "That is not a daydream.";
const IMAGINE_CLOSE_B = "That is June 15-20, 2027. And your room is waiting.";

/* Pricing re-read from the source on 18 September 2026. Early Bird ($4,500)
   ended on 1 September, as this page itself used to announce; the published
   price is now $5,500 and the Early Bird notice is gone from the source, which
   prints the suite's inclusions in that slot instead. */
const RESERVE_STRIP = "BALI  ·  JUNE 15–20, 2027  ·  LUXURY RETREAT PACKAGE";
const RESERVE_PRICE = "Private King Suite $5,500";
const RESERVE_INCLUDED_LABEL = "WHAT'S INCLUDED IN YOUR PRIVATE KING SUITE";
const RESERVE_INCLUDED: readonly string[] = [
  "Your own private bedroom with a king bed and en suite bathroom",
  "Five nights in the private villa, with full run of both infinity pools, the yoga shala, gym, and spa facility",
  "All chef-prepared meals, breakfast, brunch, and dinner, daily",
  "Flower bath, in-villa massages and spa day, and a full cabana day at the pool",
  "Your choice of Healing Meditation or Palm Reading and Holy Water Ceremony",
  "Temple tour, Balinese swing, fire show, beach day, photo day, and shared storytelling",
  "A personalized luxury welcome gift",
  "Luxury airport transfers and a pre-trip group call with Yvette",
];
const RESERVE_INCLUDED_NOTE =
  "Airfare and travel insurance are not included, see the FAQ below for details.";
const RESERVE_TERMS =
  "All payments due by June 8, 2027  ·  See cancellation and refund policy in the FAQ";
const RESERVE_SCARCITY =
  "RESERVE BEFORE SPOTS CLOSE  ·  LIMITED TO 12 WOMEN";

/**
 * Where both reservation buttons go.
 *
 * They used to be the Kajabi checkout URLs (bossclinician.com/offers/<token>/
 * checkout). After the domain cutover that host is this app, and the redirect
 * map sends both tokens back to /retreats — each button was a loop. The retreat
 * has no offer row here yet, so reservations go through the contact form; once
 * the two offers are published in the admin, give each option its own
 * `/checkout/<offer-slug>` here.
 */
const RESERVE_ROUTE = "/contact";

const RESERVE_OPTIONS: readonly {
  label: string;
  title: string;
  body: string;
  cta: string;
  href: string;
  accent: Accent;
  primary: boolean;
}[] = [
  {
    label: "PRIVATE KING SUITE",
    title: "Pay In Full — $5,500",
    body: "One payment, reservation complete.",
    cta: "RESERVE YOUR PLACE",
    href: RESERVE_ROUTE,
    accent: "gold",
    primary: true,
  },
  {
    label: "PRIVATE KING SUITE",
    title: "Payment Plan — $500 deposit",
    body: "$500 deposit, then the remaining balance divided into monthly payments based on your enrollment date. All balances must be paid in full by June 8, 2027. The earlier you reserve, the lower your monthly payments.",
    cta: "RESERVE YOUR PLACE",
    href: RESERVE_ROUTE,
    accent: "plum",
    primary: false,
  },
];

const TRAWICK_URL = "https://trawickinternational.com/";

/** Yvette's portrait is served from the Kajabi CDN, so it is used as-is. */
const HOST_IMAGE =
  "/images/migrated-9f074ef824a3.png";

const HOST_BODY_A =
  "Yvette Howard is a Licensed Clinical Social Worker, doctoral candidate, and founder of Boss Clinician, LLC — helping therapists and psych NPs build sustainable private practices. She is a group practice owner, a mom, and a woman who knows firsthand what it feels like to pour everything into everyone else while quietly losing yourself in the process.";
const HOST_BODY_B =
  "At the end of 2022 she was depleted in a way she could not explain. Doctoral program. Two businesses. Clients. Family. She kept adding more because she thought more was the answer. It was not.";
const HOST_PULL_A: readonly string[] = [
  "I kept telling myself I would rest after.",
  "After the doctoral program.",
  "After the business stabilized.",
  "After hiring.",
  "After the next launch.",
];
const HOST_PULL_B = "I kept moving the finish line.";
const HOST_PULL_C: readonly string[] = [
  "Until I realized I was not waiting for time.",
  "I was waiting for permission.",
];
const HOST_BODY_C =
  "In 2023 she went on her first retreat and found something she had been missing for years. Real rest. Women who understood her. The feeling of someone else handling everything while she just existed. On the last day she made herself a promise — one day I am going to create this for other women.";
const HOST_BODY_D =
  "She has invested in retreats every year since. She built this one from everything she has learned — with intention, with care, and with you specifically in mind.";
const HOST_BODY_E = "This retreat is her promise kept.";
const HOST_CREDENTIALS: readonly string[] = [
  "Licensed Clinical Social Worker (LCSW)",
  "Doctoral Candidate",
  "Founder, Boss Clinician, LLC",
  "Private Practice Strategist",
  "Group Practice Owner",
];

const BALI_LINE_A = "Not because Bali changes you.";
const BALI_LINE_B =
  "Because sometimes the environment you have been surviving in is not the one where you can finally hear yourself again.";

const COVERAGE: readonly {
  label: string;
  lines: readonly string[];
  cta?: string;
  accent: Accent;
}[] = [
  {
    label: "NOT INCLUDED",
    lines: ["Airfare to and from", "I Gusti Ngurah Rai International Airport (DPS)"],
    accent: "neutral",
  },
  {
    label: "ALSO NOT INCLUDED",
    lines: ["Travel insurance", "(strongly recommended)"],
    cta: "VIEW COVERAGE OPTIONS",
    accent: "plum",
  },
  {
    label: "ALWAYS INCLUDED",
    lines: ["Luxury airport transfers", "are part of every package"],
    accent: "green",
  },
];

/**
 * The source page's fourteen questions, in its order and wording (re-read
 * 18 September 2026 — the price, the payment plan and the refund policy all
 * changed when Early Bird ended on 1 September). `link` is the one answer that
 * points at a document: the Retreat Terms & Agreement, which has no page of its
 * own here yet and lives under /terms, where the redirect map also sends
 * /retreatagreement.
 */
const FAQS: readonly { q: string; a: string; link?: { label: string; to: string } }[] = [
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
    link: { label: "Retreat Terms & Agreement", to: "/terms" },
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

/* ══════════════════════════════════════════════════════════════════════════
   Structured data
   ══════════════════════════════════════════════════════════════════════════ */

const RETREAT_PATH = "/retreats";

/**
 * The retreat as an Event.
 *
 * Every field is something the page already states in words: the dates in the
 * hero eyebrow, the villa and its town in the hero strip, the twelve places in
 * the stats band, and the Private King Suite's $5,500 in the reserve band (the
 * $4,500 Early Bird rate ended on 1 September and is no longer published). No
 * `priceValidUntil` is claimed — the page states no end date. The offer points at the page's own reserve band
 * rather than at one of the two Kajabi checkouts, because the choice between
 * paying in full and starting a plan belongs to the visitor.
 */
function retreatEventNode(origin: string): JsonLdNode {
  return {
    "@type": "Event",
    "@id": `${origin}${RETREAT_PATH}#event`,
    name: "FlourisHealer Retreats",
    description: HERO_LEDE_A,
    url: `${origin}${RETREAT_PATH}`,
    image: absoluteUrl(origin, VILLA_IMAGE),
    startDate: "2027-06-15",
    endDate: "2027-06-20",
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    location: {
      "@type": "Place",
      name: "Private villa, Ubud",
      address: {
        "@type": "PostalAddress",
        addressLocality: "Ubud",
        addressRegion: "Bali",
        addressCountry: "ID",
      },
    },
    maximumAttendeeCapacity: 12,
    organizer: { "@id": `${origin}/${ORGANIZATION_ID}` },
    offers: {
      "@type": "Offer",
      name: "Private King Suite",
      url: `${origin}${RETREAT_PATH}#reserve`,
      price: "5500.00",
      priceCurrency: "USD",
      availability: "https://schema.org/InStock",
    },
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   Page
   ══════════════════════════════════════════════════════════════════════════ */

export default function Retreats() {
  const { origin } = useHeadContext();

  return (
    <>
      {/* The hero is set in type, so the villa is the one photograph that can
          stand for this page — it serves as the share card and as the Event's
          image both. */}
      <Seo
        title="Release. Restore. Reconnect."
        description="Luxury retreats for healthcare and wellness providers "
        image={VILLA_IMAGE}
        jsonLd={[retreatEventNode(origin), faqPageNode(origin, RETREAT_PATH, FAQS)]}
      />

      <HeroBlock />
      <StatsBand />
      <AboutSection />
      <FounderRetreatSection />
      <ExperienceSection />
      <IntimacySection />
      <MomentsSection />
      <PatternSection />
      <ReturnsSection />
      <ImagineSection />
      <ReserveSection />
      <HostSection />
      <BaliBand />
      <CoverageSection />
      <BurnoutQuizSection />
      <FaqSection />
    </>
  );
}

/* ── 1 · Hero ─────────────────────────────────────────────────────────────── */

/**
 * The aside carries the page's three-word promise. It is set as a stacked foil
 * triad inside a hairline frame rather than over a photograph, because foil is
 * a gradient fill — over a daylight image it loses the contrast that makes it
 * read as metal at all.
 */
function TriadPlate() {
  return (
    <div className="relative isolate mx-auto max-w-[19rem] sm:max-w-sm lg:max-w-none">
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-8 -z-10 rounded-[2.5rem] blur-3xl"
        style={{
          background:
            "radial-gradient(62% 55% at 50% 34%, rgba(123,94,167,0.45) 0%, transparent 72%)",
        }}
      />

      <GlassCard
        accent="gold"
        interactive={false}
        spotlight={false}
        className="px-7 py-10 text-center sm:px-10 sm:py-12"
      >
        <p className="font-display text-[2.1rem] font-normal italic leading-[1.28] sm:text-[2.6rem]">
          {TRIAD.map((word, i) => (
            <span key={word} className="block">
              {i > 0 && <span aria-hidden className="rule-gold mx-auto my-4 block w-12" />}
              <span className="text-foil">{word}</span>
            </span>
          ))}
        </p>
      </GlassCard>

      {/* Offset registration marks — the frame reads as a mounted plate. */}
      <span
        aria-hidden
        className="pointer-events-none absolute -left-3 -top-3 h-12 w-12 rounded-tl-xl border-l border-t border-gold/45 sm:-left-4 sm:-top-4 sm:h-16 sm:w-16"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute -bottom-3 -right-3 h-12 w-12 rounded-br-xl border-b border-r border-gold/45 sm:-bottom-4 sm:-right-4 sm:h-16 sm:w-16"
      />
    </div>
  );
}

function HeroBlock() {
  return (
    <LuxePageHero
      eyebrow={HERO_EYEBROW}
      title={HERO_TITLE}
      titleAccent={HERO_ACCENT}
      tone="plum"
      lede={
        <>
          <span className="block text-[0.8rem] font-semibold uppercase leading-[1.75] tracking-[0.1em] text-gold/90 sm:text-[0.84rem] sm:tracking-[0.17em]">
            {HERO_LEDE_A}
          </span>
          <span className="mt-3 block text-[0.84rem] font-light uppercase leading-[1.85] tracking-[0.06em] text-orchid sm:text-[0.9rem] sm:tracking-[0.1em]">
            {HERO_LEDE_B}
          </span>
        </>
      }
      actions={
        <>
          <MetaStrip className="w-full">{HERO_STRIP}</MetaStrip>
          {/* Full-width and tighter-tracked on phones: at 360px a `lg` pill
              carrying "DISCOVER THE EXPERIENCE" is wider than the gutter. */}
          <LuxeButton
            variant="foil"
            size="lg"
            href="#imagine"
            className="w-full tracking-[0.12em] sm:w-auto sm:tracking-[0.2em]"
          >
            RESERVE YOUR PLACE
          </LuxeButton>
          <LuxeButton
            variant="glass"
            size="lg"
            href="#experience"
            className="w-full tracking-[0.12em] sm:w-auto sm:tracking-[0.2em]"
          >
            DISCOVER THE EXPERIENCE
          </LuxeButton>
        </>
      }
      aside={<TriadPlate />}
    />
  );
}

/* ── 2 · The numbers ──────────────────────────────────────────────────────── */

function StatsBand() {
  return (
    <Section
      surface="raised"
      space="sm"
      aurora="gold"
      auroraIntensity={0.4}
      aria-label="Retreat at a glance"
    >
      <RevealGroup
        as="ul"
        className="mx-auto grid max-w-sm list-none grid-cols-2 items-stretch gap-5 sm:max-w-none lg:grid-cols-4 lg:gap-6"
      >
        {STATS.map((stat, i) => (
          <RevealItem key={stat.lines.join(" ")} as="li" className="h-full">
            <GlassCard
              accent={accentAt(i)}
              className="flex h-full flex-col items-center overflow-hidden px-4 py-7 text-center sm:px-6 sm:py-8"
            >
              <Numeral value={stat.value} className="text-[2.6rem] sm:text-[3.2rem]" />
              <GoldRule width="w-8" className="mt-4" />
              <p className="mt-4 text-[0.68rem] font-semibold uppercase leading-[1.7] tracking-[0.12em] text-orchid sm:text-[0.66rem] sm:tracking-[0.2em]">
                <span className="block">{stat.lines[0]}</span>
                <span className="block">{stat.lines[1]}</span>
              </p>
            </GlassCard>
          </RevealItem>
        ))}
      </RevealGroup>
    </Section>
  );
}

/* ── 3 · The retreat ──────────────────────────────────────────────────────── */

function AboutSection() {
  const reduce = useEntranceMotion();

  return (
    <Section
      id="about"
      surface="base"
      space="md"
      aurora="plum"
      auroraIntensity={0.45}
      aria-label="The retreat"
      containerClassName="max-w-3xl"
      className="scroll-mt-24"
    >
      <SectionTitle
        eyebrow="THE RETREAT"
        title={
          <>
            Designed for the women who hold space for everyone.
            <span className="text-foil mt-2 block font-display italic">
              It is time someone held space for you.
            </span>
          </>
        }
      />

      <motion.div {...rise(reduce, 0.08)} className="mx-auto mt-10 max-w-[62ch] space-y-5">
        {ABOUT_BODY.map((p) => (
          <p key={p} className="copy-luxe text-pretty">
            {p}
          </p>
        ))}
      </motion.div>

      <motion.div {...rise(reduce, 0.16)} className="mt-10 text-center">
        <p className="text-foil mx-auto max-w-2xl text-balance font-display text-[1.45rem] italic leading-[1.32] sm:text-[1.85rem]">
          {ABOUT_PROMISE}
        </p>
        <GoldRule className="mx-auto mt-8" />
        <p className="copy-luxe mt-8 text-balance">{ABOUT_KEPT}</p>
      </motion.div>
    </Section>
  );
}

/* ── 3b · Why Yvette built it ─────────────────────────────────────────────── */

const FOUNDER_EYEBROW = "THIS IS STILL SOMETHING I DO FOR MYSELF";
const FOUNDER_BODY: readonly string[] = [
  "In July 2026, I went on a retreat in Thailand. Not for my clients. Not for content. For me.",
  "I came home feeling more grounded, clear, and rested than I had in a long time. I noticed that the clarity I came home with changed the way I moved through my business, my relationships, and my own clinical work.",
  "That is what I want for you in Bali.",
  "This is our first FlourisHealer retreat. I am bringing everything I have learned from every retreat I have invested in since 2023, and everything I know about what women in this field actually need to exhale, into six days in Ubud.",
];

function FounderRetreatSection() {
  const reduce = useEntranceMotion();

  return (
    <Section
      surface="raised"
      space="md"
      aria-label="Why Yvette built FlourisHealer"
      containerClassName="max-w-3xl"
    >
      <SectionTitle
        eyebrow={FOUNDER_EYEBROW}
        title={
          <>
            I built FlourisHealer
            <span className="text-foil mt-2 block font-display italic">
              because I needed it first.
            </span>
          </>
        }
      />

      <motion.div {...rise(reduce, 0.08)} className="mx-auto mt-10 max-w-[62ch] space-y-5">
        {FOUNDER_BODY.map((p) => (
          <p key={p} className="copy-luxe text-pretty">
            {p}
          </p>
        ))}
      </motion.div>
    </Section>
  );
}

/* ── 4b · Why twelve women, why this villa ────────────────────────────────── */

const INTIMACY_EYEBROW = "THE INTIMACY IS THE POINT";
const INTIMACY: readonly { title: string; body: readonly string[] }[] = [
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
];

function IntimacySection() {
  return (
    <Section
      surface="deep"
      space="md"
      aurora="violet"
      auroraIntensity={0.45}
      aria-label="Why twelve women, why this villa"
    >
      <SectionTitle
        eyebrow={INTIMACY_EYEBROW}
        title={
          <>
            Why twelve women.
            <span className="text-foil mt-2 block font-display italic">Why this villa.</span>
          </>
        }
      />

      <RevealGroup
        as="ul"
        className="mx-auto mt-10 grid max-w-md list-none grid-cols-1 items-stretch gap-6 sm:max-w-5xl sm:grid-cols-2 sm:gap-7"
      >
        {INTIMACY.map((block, i) => (
          <RevealItem key={block.title} as="li" className="h-full">
            <GlassCard accent={accentAt(i)} interactive={false} className="h-full p-7 sm:p-9">
              <h3 className="font-display text-[1.4rem] font-medium leading-[1.25] text-white">
                {block.title}
              </h3>
              <GoldRule width="w-10" className="mt-5" />
              <div className="mt-5 space-y-4">
                {block.body.map((p) => (
                  <p key={p} className="copy-luxe text-pretty text-[0.95rem]">
                    {p}
                  </p>
                ))}
              </div>
            </GlassCard>
          </RevealItem>
        ))}
      </RevealGroup>
    </Section>
  );
}

/* ── 12b · Still on the fence ─────────────────────────────────────────────── */

const BURNOUT_EYEBROW = "STILL ON THE FENCE?";
const BURNOUT_BODY =
  "Six honest questions about how you are actually doing, not how you tell everyone you are doing. Two minutes. Just you and the truth. If your cup is running lower than you have been letting on, this is the sign to stop waiting.";
const BURNOUT_CTA = "TAKE THE QUIZ";
/**
 * The six-question Burnout Self-Assessment still lives on the Kajabi site, so
 * this is deliberately an absolute .com URL, like the practice quiz.
 *
 * CUTOVER BLOCKER: once bossclinician.com points at this app, publish the
 * assessment here and switch this to `/quiz/retreat-needed-quiz`.
 */
const BURNOUT_QUIZ_URL = "https://www.bossclinician.com/retreat-needed-quiz";

function BurnoutQuizSection() {
  const reduce = useEntranceMotion();

  return (
    <Section
      surface="base"
      space="md"
      aurora="gold"
      auroraIntensity={0.4}
      aria-label="Burnout self-assessment"
      containerClassName="max-w-3xl text-center"
    >
      <SectionTitle
        eyebrow={BURNOUT_EYEBROW}
        title={
          <>
            Take the Burnout
            <span className="text-foil mt-2 block font-display italic">Self-Assessment</span>
          </>
        }
      />
      <motion.div {...rise(reduce, 0.08)} className="mt-10">
        <p className="copy-luxe mx-auto max-w-[62ch] text-pretty">{BURNOUT_BODY}</p>
        <LuxeButton
          variant="foil"
          size="lg"
          href={BURNOUT_QUIZ_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-9 w-full tracking-[0.14em] sm:w-auto sm:tracking-[0.2em]"
        >
          {BURNOUT_CTA}
        </LuxeButton>
      </motion.div>
    </Section>
  );
}

/* ── 4 · What's included ──────────────────────────────────────────────────── */

/**
 * The villa photograph closes the inclusions band, exactly where the live page
 * runs its VILLA / POOL / DINING / WELLNESS strip, so the labels keep the frame
 * they belong to instead of floating as four bare chips.
 */
function VillaPlate() {
  return (
    <div className="mx-auto mt-10 max-w-4xl">
      <div className="relative overflow-hidden rounded-2xl border border-gold/25 shadow-[0_44px_100px_-36px_rgba(0,0,0,0.95)]">
        <img
          src={VILLA_IMAGE}
          alt="The private Ubud villa from above — a long pool and sun loungers under palms, below two storeys of glass"
          width={1500}
          height={1125}
          loading="lazy"
          decoding="async"
          className={cn("aspect-[4/3] w-full max-w-full object-cover sm:aspect-[16/9]", GRADE)}
        />
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(112%_78%_at_50%_30%,transparent_26%,rgba(10,7,19,0.48)_66%,rgba(6,4,11,0.9)_100%)]"
        />
        <div aria-hidden className="absolute inset-0 bg-glow-violet/20 mix-blend-soft-light" />
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-gold/45 to-transparent"
        />
      </div>

      <ul className="mt-6 flex list-none flex-wrap justify-center gap-2.5">
        {VILLA_LABELS.map((label) => (
          <li key={label}>
            <LuxePill accent="gold">{label}</LuxePill>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ExperienceSection() {
  const reduce = useEntranceMotion();

  return (
    <Section
      id="experience"
      surface="raised"
      space="md"
      aurora="violet"
      auroraIntensity={0.5}
      aria-label="What's included"
      className="scroll-mt-24"
    >
      <SectionTitle
        eyebrow="WHAT'S INCLUDED"
        title={
          <>
            This is not a training.
            <span className="text-foil mt-2 block font-display italic">This is a retreat.</span>
          </>
        }
      />

      <motion.div {...rise(reduce, 0.08)} className="mx-auto mt-10 max-w-[62ch] space-y-5">
        {EXPERIENCE_BODY.map((p) => (
          <p key={p} className="copy-luxe text-pretty">
            {p}
          </p>
        ))}
      </motion.div>

      <RevealGroup
        as="ol"
        className="mx-auto mt-10 grid max-w-md list-none grid-cols-1 items-stretch gap-6 sm:max-w-none sm:grid-cols-2 lg:grid-cols-3 lg:gap-7"
      >
        {INCLUSIONS.map((item, i) => (
          <RevealItem key={item.number} as="li" className="h-full">
            <GlassCard
              accent={accentAt(i)}
              className="flex h-full flex-col overflow-hidden p-7 sm:p-8"
            >
              <Numeral value={item.number} className="text-[2.4rem] sm:text-[2.8rem]" />
              <GoldRule width="w-10" className="mt-5" />
              <h3 className="mt-5 text-pretty font-display text-[1.25rem] font-medium leading-snug text-white">
                {item.title}
              </h3>
              <p className="copy-luxe mt-3.5 flex-1 text-pretty text-sm">{item.body}</p>
            </GlassCard>
          </RevealItem>
        ))}
      </RevealGroup>

      <VillaPlate />
    </Section>
  );
}

/* ── 5 · Retreat moments ──────────────────────────────────────────────────── */

function MomentsSection() {
  return (
    <Section
      surface="deep"
      space="md"
      aurora="mixed"
      auroraIntensity={0.5}
      aria-label="Retreat moments"
    >
      <SectionTitle eyebrow="RETREAT MOMENTS" title="This is what receiving looks like." />

      <RevealGroup
        as="ul"
        className="mx-auto mt-10 grid max-w-sm list-none grid-cols-1 items-stretch gap-6 sm:max-w-none sm:grid-cols-2 lg:grid-cols-3 lg:gap-7"
      >
        {MOMENTS.map((m, i) => (
          <RevealItem key={m.caption} as="li" className="h-full">
            <GlassCard
              as="figure"
              accent={accentAt(i)}
              className="group flex h-full flex-col overflow-hidden"
            >
              <div className="relative w-full overflow-hidden bg-night-deep">
                <img
                  src={m.src}
                  alt={m.alt}
                  loading="lazy"
                  decoding="async"
                  className={cn(
                    "aspect-[4/5] w-full max-w-full object-cover transition-transform duration-700 ease-luxe group-hover:scale-[1.05]",
                    GRADE,
                  )}
                />
                <div
                  aria-hidden
                  className="absolute inset-0 bg-glow-violet/35 mix-blend-multiply"
                />
                <div
                  aria-hidden
                  className="absolute inset-0"
                  style={{
                    background:
                      "linear-gradient(to top, rgb(var(--c-night, 9 6 17) / 0.92) 0%, rgb(var(--c-night, 9 6 17) / 0.42) 26%, rgb(var(--c-night, 9 6 17) / 0) 62%)",
                  }}
                />
                <div
                  aria-hidden
                  className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-gold/45 to-transparent"
                />
              </div>

              <figcaption className="px-6 py-5 text-center text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-gold sm:text-[0.7rem] sm:tracking-[0.22em]">
                {m.caption}
              </figcaption>
            </GlassCard>
          </RevealItem>
        ))}
      </RevealGroup>
    </Section>
  );
}

/* ── 6 · The pattern ──────────────────────────────────────────────────────── */

function PatternSection() {
  const reduce = useEntranceMotion();

  return (
    <Section
      surface="base"
      space="md"
      aurora="plum"
      auroraIntensity={0.45}
      aria-label="This is not a vacation"
    >
      <SectionTitle
        eyebrow="THIS IS NOT A VACATION"
        title={
          <>
            It is about
            <span className="text-foil mt-2 block font-display italic">
              interrupting a pattern.
            </span>
          </>
        }
        body="The pattern that tells you:"
      />

      <RevealGroup
        as="ul"
        className="mx-auto mt-10 grid max-w-md list-none grid-cols-1 items-stretch gap-5 sm:max-w-3xl sm:grid-cols-2 sm:gap-6"
      >
        {PATTERNS.map((line, i) => (
          <RevealItem key={line} as="li" className="h-full">
            <GlassCard
              accent={accentAt(i)}
              className="flex h-full items-center p-6 sm:p-7"
            >
              <p className="text-pretty font-display text-[1.05rem] italic leading-[1.6] text-orchid sm:text-[1.15rem]">
                {line}
              </p>
            </GlassCard>
          </RevealItem>
        ))}
      </RevealGroup>

      <motion.div {...rise(reduce, 0.1)} className="mx-auto mt-10 max-w-[62ch]">
        <p className="copy-luxe text-pretty">{PATTERN_BODY}</p>
      </motion.div>

      <motion.div {...rise(reduce, 0.16)} className="mt-10 text-center">
        <p className="mx-auto max-w-2xl text-balance font-display text-[1.3rem] italic leading-[1.5] text-orchid sm:text-[1.55rem]">
          {PATTERN_PULL.map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        </p>

        <GoldRule className="mx-auto mt-8" />

        <h3 className="mt-8 text-balance font-display text-[1.4rem] font-medium leading-[1.24] text-white sm:text-[1.7rem]">
          {PATTERN_COST}
        </h3>
        <p className="copy-luxe mx-auto mt-5 max-w-2xl text-balance">{PATTERN_COST_BODY}</p>
        <p className="copy-luxe mx-auto mt-5 max-w-2xl text-balance">{PATTERN_CLOSE}</p>
      </motion.div>
    </Section>
  );
}

/* ── 7 · The woman who returns ────────────────────────────────────────────── */

function ReturnsSection() {
  const reduce = useEntranceMotion();

  return (
    <Section
      surface="raised"
      space="md"
      aurora="violet"
      auroraIntensity={0.45}
      aria-label="The woman who returns"
      containerClassName="max-w-3xl"
    >
      <motion.div {...rise(reduce, 0)}>
        <GlassCard accent="plum" interactive={false} className="overflow-hidden p-7 sm:p-10">
          <div
            aria-hidden
            className="pointer-events-none absolute -left-6 -top-10 h-40 w-40 rounded-full blur-3xl"
            style={{
              background: "radial-gradient(circle, rgba(167,139,196,0.20) 0%, transparent 70%)",
            }}
          />

          <span
            aria-hidden
            className="text-foil pointer-events-none relative block select-none font-display text-[3.6rem] leading-none sm:text-[4.2rem]"
          >
            &ldquo;
          </span>

          <blockquote className="relative mt-2">
            <p className="text-balance font-display text-[1.3rem] italic leading-[1.5] text-white sm:text-[1.6rem]">
              {RETURNS_LEAD}
            </p>
            <p className="copy-luxe mt-6 text-pretty">{RETURNS_BODY}</p>
          </blockquote>

          <div aria-hidden className="rule-faint mt-8 w-full" />

          <p className="mt-6 text-pretty text-[0.72rem] font-bold uppercase leading-[1.85] tracking-[0.12em] text-gold sm:text-[0.7rem] sm:tracking-[0.2em]">
            {RETURNS_CAPS}
          </p>
        </GlassCard>
      </motion.div>
    </Section>
  );
}

/* ── 8 · Imagine ──────────────────────────────────────────────────────────── */

function ImagineSection() {
  const reduce = useEntranceMotion();

  return (
    <Section
      id="imagine"
      surface="deep"
      space="md"
      aurora="gold"
      auroraIntensity={0.55}
      aria-label="Imagine"
      containerClassName="max-w-3xl text-center"
      className="scroll-mt-24"
    >
      <SectionTitle eyebrow="CLOSE YOUR EYES" title="Imagine..." />

      <div className="mt-10 space-y-8">
        {IMAGINE_STANZAS.map((stanza, i) => (
          <motion.p
            key={stanza[0]}
            {...rise(reduce, Math.min(i, 5) * 0.06)}
            className="mx-auto max-w-2xl text-balance font-display text-[1.15rem] font-normal italic leading-[1.65] text-orchid sm:text-[1.35rem]"
          >
            {stanza.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </motion.p>
        ))}
      </div>

      <GoldRule className="mx-auto mt-10" />

      <motion.div {...rise(reduce, 0.1)} className="mt-10">
        <p className="text-balance font-display text-[1.5rem] font-medium leading-[1.25] text-white sm:text-[1.9rem]">
          {IMAGINE_CLOSE_A}
        </p>
        <p className="text-foil mt-2 text-balance font-display text-[1.45rem] italic leading-[1.3] sm:text-[1.85rem]">
          {IMAGINE_CLOSE_B}
        </p>
      </motion.div>
    </Section>
  );
}

/* ── 9 · Reserve ──────────────────────────────────────────────────────────── */

function ReserveSection() {
  const reduce = useEntranceMotion();

  return (
    <Section
      id="reserve"
      surface="base"
      space="md"
      aurora="mixed"
      auroraIntensity={0.7}
      aria-label="Reserve your place"
      className="scroll-mt-24"
    >
      <SectionTitle
        eyebrow="LIMITED TO 12 WOMEN"
        title={
          <>
            Stop saying next year.
            <span className="text-foil mt-2 block font-display italic">Next year is now.</span>
          </>
        }
      />

      <motion.div {...rise(reduce, 0.08)} className="mx-auto mt-10 max-w-3xl text-center">
        <MetaStrip>{RESERVE_STRIP}</MetaStrip>
        <p className="copy-luxe mt-5 text-balance text-white/90">{RESERVE_PRICE}</p>

        <GlassCard
          accent="gold"
          interactive={false}
          spotlight={false}
          className="mt-8 p-6 text-center sm:p-8"
        >
          <p className="text-[0.72rem] font-bold uppercase tracking-[0.13em] text-gold sm:text-[0.7rem] sm:tracking-[0.22em]">
            {RESERVE_INCLUDED_LABEL}
          </p>
          <ul className="mx-auto mt-5 max-w-xl space-y-3 text-left">
            {RESERVE_INCLUDED.map((item) => (
              <li key={item} className="flex gap-3">
                <span aria-hidden className="mt-[0.1rem] shrink-0 text-[0.7rem] text-gold">
                  ✦
                </span>
                <span className="copy-luxe min-w-0 text-pretty text-sm">{item}</span>
              </li>
            ))}
          </ul>
          <p className="copy-luxe mx-auto mt-5 max-w-xl text-pretty text-xs">
            {RESERVE_INCLUDED_NOTE}
          </p>
        </GlassCard>

        <p className="mt-6 text-pretty text-[0.72rem] font-semibold uppercase leading-[1.9] tracking-[0.1em] text-orchid-dim sm:text-[0.7rem] sm:tracking-[0.16em]">
          {RESERVE_TERMS}
        </p>
      </motion.div>

      <RevealGroup
        as="ul"
        className="mx-auto mt-10 grid max-w-md list-none grid-cols-1 items-stretch gap-6 sm:max-w-4xl sm:grid-cols-2 sm:gap-7"
      >
        {RESERVE_OPTIONS.map((option) => (
          <RevealItem key={option.title} as="li" className="h-full">
            <GlassCard
              accent={option.accent}
              className="flex h-full flex-col overflow-hidden p-7 sm:p-8"
            >
              <p className="text-[0.7rem] font-bold uppercase tracking-[0.13em] text-gold sm:text-[0.66rem] sm:tracking-[0.2em]">
                {option.label}
              </p>
              <h3 className="mt-4 text-balance font-display text-[1.5rem] font-medium leading-tight text-white sm:text-[1.7rem]">
                {option.title}
              </h3>
              <GoldRule width="w-10" className="mt-5" />
              <p className="copy-luxe mt-5 flex-1 text-pretty text-sm">{option.body}</p>

              <LuxeButton
                variant={option.primary ? "foil" : "glass"}
                size="sm"
                to={option.href}
                className="mt-7 min-h-[44px] w-full tracking-[0.12em]"
              >
                {option.cta}
                <span aria-hidden>&rarr;</span>
              </LuxeButton>
            </GlassCard>
          </RevealItem>
        ))}
      </RevealGroup>

      <motion.div {...rise(reduce, 0.12)} className="mx-auto mt-10 max-w-2xl text-center">
        <MetaStrip>{RESERVE_SCARCITY}</MetaStrip>

        <p className="copy-luxe mt-5 text-pretty">
          Questions?{" "}
          <a
            href="mailto:retreats@bossclinician.com"
            className="text-orchid underline decoration-white/20 underline-offset-[6px] transition-colors duration-300 ease-luxe hover:text-gold hover:decoration-gold/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold"
          >
            Reach out directly
          </a>{" "}
          &mdash; payment arrangements are available.
        </p>

        {/* A 41-character label cannot ride on a fixed-width pill at 360px, so
            the button becomes a block that wraps its own text. */}
        <LuxeButton
          variant="outline"
          size="sm"
          href={TRAWICK_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mx-auto mt-7 min-h-[44px] w-full max-w-md px-5 py-3.5 text-center leading-[1.5] tracking-[0.08em]"
        >
          GET TRAVEL INSURANCE &mdash; TRAWICK INTERNATIONAL
        </LuxeButton>
      </motion.div>
    </Section>
  );
}

/* ── 10 · Your host ───────────────────────────────────────────────────────── */

function HostPortrait() {
  return (
    <div className="relative isolate mx-auto max-w-[19rem] sm:max-w-sm lg:max-w-none">
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-8 -z-10 rounded-[2.5rem] blur-3xl"
        style={{
          background:
            "radial-gradient(62% 55% at 45% 30%, rgba(123,94,167,0.45) 0%, transparent 72%)",
        }}
      />

      <div className="relative overflow-hidden rounded-2xl border border-gold/25 shadow-[0_44px_100px_-36px_rgba(0,0,0,0.95)]">
        <img
          src={HOST_IMAGE}
          alt="Yvette Howard, LCSW"
          width={882}
          height={1440}
          loading="lazy"
          decoding="async"
          className="aspect-[4/5] w-full max-w-full object-cover object-top"
        />
      </div>

      <p className="mt-5 text-center text-[0.72rem] font-bold uppercase tracking-[0.14em] text-gold sm:text-[0.7rem] sm:tracking-[0.22em]">
        YVETTE HOWARD, LCSW
      </p>

      <span
        aria-hidden
        className="pointer-events-none absolute -left-3 -top-3 h-12 w-12 rounded-tl-xl border-l border-t border-gold/45 sm:-left-4 sm:-top-4 sm:h-16 sm:w-16"
      />
    </div>
  );
}

/**
 * Small uppercase chip that is also a link. It shares the pill geometry of the
 * credential row beside it so the three host marks read as one set, and keeps
 * the 44px touch floor a bare `LuxePill` would not clear.
 */
type HostChipProps = { children: string } & (
  | { to: string; href?: undefined }
  | { href: string; to?: undefined }
);

function HostChip(props: HostChipProps) {
  const classes = cn(
    "inline-flex min-h-[44px] items-center rounded-full border border-gold/30 bg-gold/[0.09] px-4 py-2",
    "text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-gold sm:text-[0.64rem] sm:tracking-[0.16em]",
    "transition-colors duration-300 ease-luxe hover:border-gold/60 hover:bg-gold/[0.16] hover:text-gold-bright",
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold",
  );

  if (props.to) {
    return (
      <Link to={props.to} className={classes}>
        {props.children}
      </Link>
    );
  }

  return (
    <a href={props.href} target="_blank" rel="noopener noreferrer" className={classes}>
      {props.children}
    </a>
  );
}

function HostSection() {
  const reduce = useEntranceMotion();

  return (
    <Section
      id="host"
      surface="raised"
      space="md"
      aurora="plum"
      auroraIntensity={0.45}
      aria-label="Your host"
      className="scroll-mt-24"
    >
      <div className="grid items-start gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:gap-14">
        <motion.div {...rise(reduce, 0)}>
          <HostPortrait />
        </motion.div>

        <motion.div {...rise(reduce, 0.1)} className="min-w-0">
          <span className="eyebrow-luxe">YOUR HOST</span>

          <h2 className="text-balance font-display text-[2rem] font-medium leading-[1.14] text-white sm:text-[2.5rem]">
            She has been
            <span className="text-foil mt-2 block font-display italic">
              exactly where you are.
            </span>
          </h2>

          <GoldRule className="mt-8" />

          <div className="mt-8 space-y-5">
            <p className="copy-luxe text-pretty">{HOST_BODY_A}</p>
            <p className="copy-luxe text-pretty">{HOST_BODY_B}</p>
          </div>

          <GlassCard
            accent="gold"
            interactive={false}
            spotlight={false}
            className="mt-8 p-6 sm:p-8"
          >
            <blockquote className="font-display text-[1.05rem] italic leading-[1.75] text-orchid sm:text-[1.15rem]">
              <p className="text-pretty">
                {HOST_PULL_A.map((line) => (
                  <span key={line} className="block">
                    {line}
                  </span>
                ))}
              </p>
              <p className="mt-5 text-pretty">{HOST_PULL_B}</p>
              <p className="mt-5 text-pretty">
                {HOST_PULL_C.map((line) => (
                  <span key={line} className="block">
                    {line}
                  </span>
                ))}
              </p>
            </blockquote>
          </GlassCard>

          <div className="mt-8 space-y-5">
            <p className="copy-luxe text-pretty">{HOST_BODY_C}</p>
            <p className="copy-luxe text-pretty">{HOST_BODY_D}</p>
            <p className="text-foil text-pretty font-display text-[1.2rem] italic leading-[1.5] sm:text-[1.35rem]">
              {HOST_BODY_E}
            </p>
          </div>

          <ul className="mt-8 flex list-none flex-wrap gap-2.5">
            {HOST_CREDENTIALS.map((c) => (
              <li key={c}>
                <LuxePill accent="plum">{c}</LuxePill>
              </li>
            ))}
          </ul>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <HostChip href="https://instagram.com/bossclinician">@BOSSCLINICIAN</HostChip>
            {/* The live page points this at bossclinician.com itself, which on
                this build is the home route. */}
            <HostChip to="/">BOSSCLINICIAN.COM</HostChip>
            <LuxePill accent="gold">FLOURISHEALER</LuxePill>
          </div>
        </motion.div>
      </div>
    </Section>
  );
}

/* ── 11 · Not because Bali changes you ────────────────────────────────────── */

function BaliBand() {
  const reduce = useEntranceMotion();

  return (
    <Section
      surface="deep"
      space="md"
      aurora="mixed"
      auroraIntensity={0.85}
      aria-label="Why Bali"
      containerClassName="max-w-3xl text-center"
    >
      <motion.h2
        {...rise(reduce, 0)}
        className="text-balance font-display font-normal leading-[1.14] text-white"
      >
        <span className="block text-[1.7rem] sm:text-[2.3rem] lg:text-[2.7rem]">
          {BALI_LINE_A}
        </span>
        <span className="text-foil mt-4 block font-display text-[1.15rem] italic leading-[1.5] sm:text-[1.5rem] lg:text-[1.7rem]">
          {BALI_LINE_B}
        </span>
      </motion.h2>
    </Section>
  );
}

/* ── 12 · What is and is not included ─────────────────────────────────────── */

function CoverageSection() {
  return (
    <Section
      surface="base"
      space="md"
      aurora="green"
      auroraIntensity={0.45}
      aria-label="What is and is not included"
    >
      <RevealGroup
        as="ul"
        className="mx-auto grid max-w-md list-none grid-cols-1 items-stretch gap-6 sm:max-w-none md:grid-cols-3"
      >
        {COVERAGE.map((item) => (
          <RevealItem key={item.label} as="li" className="h-full">
            <GlassCard
              accent={item.accent}
              className="flex h-full flex-col p-7 text-center sm:p-8"
            >
              <h3 className="text-[0.72rem] font-bold uppercase tracking-[0.13em] text-gold sm:text-[0.68rem] sm:tracking-[0.2em]">
                {item.label}
              </h3>
              <div aria-hidden className="rule-faint mx-auto mt-5 w-16" />

              <div className="mt-5 flex-1">
                {item.lines.map((line) => (
                  <p key={line} className="copy-luxe text-pretty">
                    {line}
                  </p>
                ))}
              </div>

              {item.cta && (
                <LuxeButton
                  variant="glass"
                  size="sm"
                  href={TRAWICK_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-6 min-h-[44px] w-full px-5 py-3.5 text-center leading-[1.5] tracking-[0.08em]"
                >
                  {item.cta}
                </LuxeButton>
              )}
            </GlassCard>
          </RevealItem>
        ))}
      </RevealGroup>
    </Section>
  );
}

/* ── 13 · FAQ ─────────────────────────────────────────────────────────────── */

function FaqSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  const reduce = useReducedMotion();
  const uid = useId();

  return (
    <Section
      id="terms"
      surface="raised"
      space="md"
      aurora="plum"
      auroraIntensity={0.4}
      aria-label="Common questions"
      containerClassName="max-w-3xl"
      className="scroll-mt-24"
    >
      <SectionTitle
        eyebrow="COMMON QUESTIONS"
        title={
          <>
            Everything you
            <span className="text-foil mt-2 block font-display italic">need to know</span>
          </>
        }
      />

      <div className="mt-10 space-y-3.5">
        {FAQS.map((faq, i) => {
          const isOpen = openIndex === i;
          const panelId = `${uid}-faq-panel-${i}`;
          const buttonId = `${uid}-faq-button-${i}`;

          return (
            <GlassCard
              key={faq.q}
              accent={accentAt(i)}
              interactive={false}
              spotlight={false}
              className="overflow-hidden"
            >
              <h3>
                <button
                  type="button"
                  id={buttonId}
                  onClick={() => setOpenIndex(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  className={cn(
                    "flex w-full items-center justify-between gap-4 px-6 py-5 text-left",
                    "min-h-[56px] transition-colors duration-300 ease-luxe hover:bg-white/[0.03]",
                    "focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold",
                  )}
                >
                  <span className="min-w-0 text-pretty text-[0.95rem] font-medium text-white">
                    {faq.q}
                  </span>
                  <span
                    aria-hidden
                    className={cn(
                      "shrink-0 font-display text-2xl leading-none text-gold transition-transform duration-500 ease-luxe",
                      isOpen && "rotate-45",
                    )}
                  >
                    +
                  </span>
                </button>
              </h3>

              <motion.div
                id={panelId}
                aria-hidden={!isOpen}
                initial={false}
                animate={{ height: isOpen ? "auto" : 0, opacity: isOpen ? 1 : 0 }}
                transition={{ duration: reduce ? 0 : 0.35, ease: EASE }}
                className="overflow-hidden"
              >
                <div aria-hidden className="rule-faint mx-6 w-auto" />
                <div className="px-6 pb-6 pt-5">
                  <p className="copy-luxe text-pretty text-sm">{faq.a}</p>
                  {faq.link && (
                    // The collapsed panel is aria-hidden, so its link leaves the
                    // tab order with it.
                    <p className="mt-4 text-sm">
                      <Link
                        to={faq.link.to}
                        tabIndex={isOpen ? undefined : -1}
                        className="text-orchid underline decoration-white/20 underline-offset-[6px] transition-colors duration-300 ease-luxe hover:text-gold hover:decoration-gold/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold"
                      >
                        {faq.link.label} &rarr;
                      </Link>
                    </p>
                  )}
                </div>
              </motion.div>
            </GlassCard>
          );
        })}
      </div>
    </Section>
  );
}
