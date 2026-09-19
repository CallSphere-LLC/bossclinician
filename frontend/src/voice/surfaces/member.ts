import { BOSS_CLINICIAN_PERSONA } from "@/voice/contract";
import type { TourStop, VoiceDestination, VoiceSurfacePolicy } from "@/voice/contract";

/**
 * The portal's concierge — a study companion.
 *
 * The difference from the public one is not tone, it is standing: this person
 * has already bought something, so the agent stops selling and starts helping
 * them use it. It is also the only surface where the agent may read somebody's
 * own records aloud — their progress, their orders, their receipts — which is
 * why `my_account_summary` is switched on here and nowhere else. That tool asks
 * the server, and the server answers for the session's own member and no other.
 *
 * Every narration below was written from the page it describes, and the beats
 * name controls that are really on screen. `MemberShell` renders its `title` as
 * the page's `h1`, so a stop's first beat can lean on it.
 */

const MEMBER: readonly ["member"] = ["member"];

const DESTINATIONS: readonly VoiceDestination[] = [
  {
    key: "library",
    path: "/library",
    label: "Your library",
    aliases: [
      "my library",
      "my courses",
      "my shelf",
      "what I bought",
      "where are my courses",
      "the blueprint course",
      "take me to my training",
    ],
    narration:
      "Your library is everything you own in one place, grouped by kind, with a band at the top that takes you straight back to the lesson you stopped on.",
    surfaces: MEMBER,
  },
  {
    key: "downloads",
    path: "/downloads",
    label: "Your downloads",
    aliases: [
      "my downloads",
      "my worksheets",
      "my workbooks",
      "the files I got",
      "where are my pdfs",
      "the templates",
    ],
    narration:
      "Every worksheet, workbook and file that came with something you own, gathered here as well as sitting beside its own lesson.",
    surfaces: MEMBER,
  },
  {
    key: "community",
    path: "/community",
    label: "Community",
    aliases: [
      "the community",
      "the group",
      "the forum",
      "the rooms",
      "where everyone talks",
      "the member chat",
    ],
    narration:
      "The rooms you are part of. Each one has its own channels, a live room, direct messages and a members list, and your points and badges follow you around them.",
    surfaces: MEMBER,
  },
  {
    key: "coaching",
    path: "/coaching",
    label: "Coaching",
    aliases: [
      "my coaching",
      "my calls",
      "book a call",
      "my sessions with Yvette",
      "how many sessions do I have left",
      "one to one",
    ],
    narration:
      "Your sessions with Yvette: what is coming up, how many calls are left on each package, the booking form, and everything you have already worked through.",
    surfaces: MEMBER,
  },
  {
    key: "events",
    path: "/my-events",
    label: "Your events",
    aliases: [
      "my events",
      "the masterclass I signed up for",
      "what am I booked into",
      "the replay",
      "the live session",
      "when is the next class",
    ],
    narration:
      "Everything you have registered for, split into what is coming up and what has already happened, with the joining link when the doors open and the replay while it lasts.",
    surfaces: MEMBER,
  },
  {
    key: "podcasts",
    path: "/podcasts",
    label: "Podcasts",
    aliases: [
      "the podcast",
      "my shows",
      "listen to the episodes",
      "my private feed",
      "add it to apple podcasts",
    ],
    narration:
      "Your shows, each with a private listening link you can paste into whichever podcast app you already use, and the recent episodes with a player built in.",
    surfaces: MEMBER,
  },
  {
    key: "newsletters",
    path: "/newsletters",
    label: "Newsletters",
    aliases: [
      "the newsletter",
      "past issues",
      "the archive",
      "the emails Yvette sends",
      "that email I deleted",
    ],
    narration:
      "Every issue Yvette has sent, kept so you never have to dig through your inbox, with the switches that decide which emails keep coming.",
    surfaces: MEMBER,
  },
  {
    key: "account",
    path: "/account",
    label: "Your account",
    aliases: [
      "my account",
      "my settings",
      "my profile",
      "account settings",
      "change my details",
    ],
    narration:
      "The hub for everything about you: your name and email at the top, and six cards leading to your details, your password and devices, billing, purchases, downloads and email preferences.",
    surfaces: MEMBER,
  },
  {
    key: "profile",
    path: "/account/profile",
    label: "Your details",
    aliases: [
      "my details",
      "change my name",
      "my photo",
      "my time zone",
      "the wrong time is showing",
      "my picture",
    ],
    narration:
      "Your name, photo, time zone and language. The time zone matters more than it looks: every live call and deadline on the site is drawn in it.",
    surfaces: MEMBER,
  },
  {
    key: "security",
    path: "/account/security",
    label: "Password and devices",
    aliases: [
      "change my password",
      "my password",
      "sign out everywhere",
      "who is logged in",
      "my devices",
      "security",
    ],
    narration:
      "Where you change your password, and where you can see every phone, tablet and computer currently signed in to your account and sign any of them out.",
    surfaces: MEMBER,
  },
  {
    key: "billing",
    path: "/account/billing",
    label: "Billing",
    aliases: [
      "billing",
      "my card",
      "update my card",
      "my plan",
      "cancel my plan",
      "my invoices",
      "where do I pay",
    ],
    narration:
      "Four panels: any plan you are on, anything you are paying off in instalments, the card on file, and every invoice with a receipt you can open or download.",
    surfaces: MEMBER,
  },
  {
    key: "purchases",
    path: "/account/purchases",
    label: "Purchases",
    aliases: [
      "my purchases",
      "my orders",
      "my receipts",
      "what did I buy",
      "I need a receipt",
      "my order history",
    ],
    narration:
      "Everything you have bought, newest first, each with a receipt you can view or download and a breakdown you can open to see exactly what was charged.",
    surfaces: MEMBER,
  },
  {
    key: "email-preferences",
    path: "/account/email",
    label: "Email preferences",
    aliases: [
      "email settings",
      "stop emailing me",
      "unsubscribe",
      "which emails do I get",
      "turn off reminders",
    ],
    narration:
      "One switch per newsletter and per kind of email, each saving the moment you set it. A few are marked always on because they are the emails about your own purchases.",
    surfaces: MEMBER,
  },
  {
    key: "partner-dashboard",
    path: "/partners/dashboard",
    label: "Partner program",
    aliases: [
      "my affiliate dashboard",
      "my referral link",
      "what have I earned",
      "my commission",
      "the partner program",
      "when do I get paid",
    ],
    narration:
      "Your partner dashboard: your referral link, what is ready to pay, what is still clearing, everything you have earned, and where payments are sent.",
    surfaces: MEMBER,
  },
];

/**
 * The order a newcomer should meet the portal in: what they bought first, then
 * the places they can talk to people, then the paperwork. Account settings come
 * last on purpose — nobody signs in for the first time hoping to change a time
 * zone, but everybody eventually needs to find it.
 */
const TOUR: readonly TourStop[] = [
  {
    destination: "library",
    purpose:
      "The shelf. Everything they own lands here the moment it is theirs, and this is the page they will open most often.",
    beats: [
      {
        focus: "Your library",
        say: "This is your library, and it is the one page worth bookmarking. Everything you buy appears here by itself — nothing to redeem, nothing to unlock.",
      },
      {
        focus: "Pick up where you left off",
        say: "This band at the top remembers the lesson you stopped on, so you can carry on without hunting for your place. Keep going takes you straight back into it.",
      },
      {
        focus: "Keep going",
        say: "Inside a course, each lesson ticks itself off once you have watched most of it, and the ring on every card shows how far through you are.",
      },
    ],
  },
  {
    destination: "downloads",
    purpose:
      "Every file that came with a purchase, in one list, so nobody has to remember which lesson a worksheet was attached to.",
    beats: [
      {
        focus: "Your downloads",
        say: "Worksheets and workbooks also sit beside the lesson they belong to, but this page gathers every one of them so you never have to remember where it came from.",
      },
      {
        focus: "Download",
        say: "View opens a file in the page so you can glance at it, and Download saves it to your computer. Anything not yet open shows why it is still waiting.",
      },
    ],
  },
  {
    destination: "community",
    purpose:
      "The rooms that come with the coaching programmes and memberships — channels, a live room, direct messages and the members list.",
    beats: [
      {
        focus: "Community",
        say: "The community rooms come with the coaching programmes and the memberships. If you are in exactly one, this page sends you straight into it.",
      },
      {
        focus: "Your standing",
        say: "Posting and replying earns points, and points earn badges. It is a gentle nudge to say something rather than only read, which is where the value actually is.",
      },
      {
        focus: "Search",
        say: "Search here reaches across channels, people and posts at once, so a question somebody already answered is usually one search away.",
      },
    ],
  },
  {
    destination: "coaching",
    purpose:
      "One-to-one time with Yvette: the calls that are booked, the credits left on a package, and the booking form.",
    beats: [
      {
        focus: "Coming up",
        say: "Anything booked shows here first, with a Join button that appears when it is time and a Details link for what you wrote down beforehand.",
      },
      {
        focus: "Your packages",
        say: "Each package shows how many sessions you have used and how many are left, so you always know where you stand before you book another.",
      },
      {
        focus: "Book a call",
        say: "Booking asks what you would like to work on. Filling that in honestly is what makes the call useful — Yvette reads it before you meet.",
      },
    ],
  },
  {
    destination: "events",
    purpose:
      "Registrations for masterclasses and live sessions, with the joining link when the doors open and the replay afterwards.",
    beats: [
      {
        focus: "Your events",
        say: "Everything you have signed up for lives here, upcoming first. You will also get an email, but this page is the one that always has the current link.",
      },
      {
        focus: "Add to calendar",
        say: "This drops the session into your own calendar, which is the difference between meaning to attend and actually turning up.",
      },
      {
        focus: "Watch the replay",
        say: "If you miss one, the replay appears in the same place, and each card tells you plainly how long it stays up.",
      },
    ],
  },
  {
    destination: "podcasts",
    purpose:
      "Members-only shows, with a private listening link for the podcast app they already use.",
    beats: [
      {
        focus: "Your private listening link",
        say: "This address is yours alone. Anyone you send it to could listen to every episode without paying, so treat it the way you would a password.",
      },
      {
        focus: "Copy link",
        say: "Copy it, paste it into Apple Podcasts or Spotify, and the episodes arrive beside your other shows. There are step-by-step notes just underneath.",
      },
      {
        focus: "Latest episodes",
        say: "If you would rather not bother with an app, every episode plays right here in the page.",
      },
    ],
  },
  {
    destination: "newsletters",
    purpose: "The archive of every issue, plus the switches that control which emails keep coming.",
    beats: [
      {
        focus: "Every issue",
        say: "Every issue Yvette has sent is kept here, so an email you deleted in a busy week is never actually gone.",
      },
      {
        focus: "What you get by email",
        say: "And these switches decide what keeps arriving. Turning something off here is the same as unsubscribing, without losing the archive.",
      },
    ],
  },
  {
    destination: "account",
    purpose: "The hub: who you are, and six cards leading to everything else about your membership.",
    beats: [
      {
        focus: "Your account",
        say: "This is the front door to everything about you rather than everything you bought. Your name, your email, and how long you have been with us.",
      },
      {
        focus: "Your details",
        say: "Six cards lead off from here — your details, your password and devices, billing, purchases, downloads and email preferences. We will look at each one.",
      },
      {
        focus: "Email confirmed",
        say: "If this says your email still needs confirming, do it. It is the only thing standing between you and getting back in if you forget your password.",
      },
    ],
  },
  {
    destination: "profile",
    purpose: "Name, photo, time zone and language — what other members see, and how every date is drawn.",
    beats: [
      {
        focus: "Time zone",
        say: "This one is worth getting right. Every live call and every deadline on the site is shown in the zone you set here, so a wrong one makes a session look like the wrong hour.",
      },
      {
        focus: "Your photo",
        say: "Your photo and name are what other members see in the community. A square headshot sits best in the circle.",
      },
      {
        focus: "Save changes",
        say: "Nothing here saves by itself, so finish with this button. Your email address is changed from the next page rather than this one.",
      },
    ],
  },
  {
    destination: "security",
    purpose: "Change the password, and see and revoke every device currently signed in.",
    beats: [
      {
        focus: "Change your password",
        say: "A short phrase you will actually remember beats a scramble you will not. Ten characters is the floor.",
      },
      {
        focus: "Where you are signed in",
        say: "Every phone, tablet and computer signed in to your account is listed here, with the one you are on marked. If you see something you do not recognise, sign it out.",
      },
      {
        focus: "Sign out of all other devices",
        say: "And this one clears every device except this one at a stroke — the right move after using a shared computer.",
      },
    ],
  },
  {
    destination: "billing",
    purpose: "Plans, instalments, the card on file, and every invoice with its receipt.",
    beats: [
      {
        focus: "Your plans",
        say: "Anything you pay for on a repeating basis shows here, and you can pause it, cancel it or start it again yourself. Nothing needs an email to us.",
      },
      {
        focus: "Card on file",
        say: "Your card is held by the payment provider rather than by us, so updating it happens in their secure form. We only ever see the last four digits.",
      },
      {
        focus: "Invoices & receipts",
        say: "Every invoice sits here with a receipt you can open or download, which is usually what an accountant is asking for.",
      },
    ],
  },
  {
    destination: "purchases",
    purpose: "The order history: what was bought, what was charged, and a receipt for each one.",
    beats: [
      {
        focus: "Purchases",
        say: "Everything you have ever bought, newest first. Refunds show here too, marked plainly, so the record is the whole story.",
      },
      {
        focus: "View receipt",
        say: "Each purchase has a receipt at a permanent address you can bookmark, and a PDF if you need to send one on.",
      },
      {
        focus: "See the detail",
        say: "Opening the detail breaks the amount down — what it was before a discount, the discount itself, tax, and what you actually paid.",
      },
    ],
  },
  {
    destination: "email-preferences",
    purpose: "One switch per newsletter and per kind of email, saving as you set it.",
    beats: [
      {
        focus: "What you get by email",
        say: "Each switch saves the moment you flip it, so there is nothing to submit. Turn off what you do not want and keep the rest.",
      },
      {
        focus: "Always on",
        say: "A few are marked always on. Those are the emails about your own purchases — receipts and the like — which we are not going to stop sending you.",
      },
    ],
  },
  {
    destination: "partner-dashboard",
    purpose:
      "The partner dashboard: the referral link, what has been earned, and where payments are sent.",
    beats: [
      {
        focus: "Your link",
        say: "If you recommend Yvette's work to colleagues, this is your own link, and anything bought through it earns you a share.",
      },
      {
        focus: "Ready to pay",
        say: "These four figures are the whole picture: what is ready to pay, what is still clearing in case of a refund, what has been paid so far, and how many people you have sent.",
      },
      {
        focus: "Payments to you",
        say: "And this is where you tell us how you would like to be paid. Nothing goes out until that is filled in.",
      },
    ],
  },
];

export const MEMBER_POLICY: VoiceSurfacePolicy = {
  surface: "member",
  audience: "member",
  agentName: "Boss Clinician AI",
  voice: "coral",
  // The shared persona first and verbatim — see the note in public.ts: the
  // browser overwrites the server's copy of these instructions the moment the
  // handshake completes, so this is the one that a member actually hears.
  instructions: [
    BOSS_CLINICIAN_PERSONA,
    [
      "You are inside a member's own portal. This person has already bought something, so stop selling. Your job is to help them use what they own: find the lesson they stopped on, work out how many coaching calls are left, produce a receipt, turn off an email they no longer want.",
      "You may read this member's own records aloud — their courses and progress, their orders, their receipts, their bookings — because the server answers only for the person signed in. That is also the limit: if they ask about another member, say plainly that you can only see their own account.",
      "Do not attempt anything that changes money or access — cancelling a plan, replacing a private listening link, signing a device out. Walk them to the control, point at it, explain exactly what it will do, and let them press it.",
      "Two things in here are worth volunteering because they cause the most confusion: the time zone on their details page is the one every live call and deadline is drawn in, and a receipt for an accountant lives under Purchases rather than in their email.",
      "If they accept the walkthrough, frame it as a tour of what they now own, in the order they are likely to need it — the library first, the paperwork last.",
    ].join(" "),
  ].join(" "),
  greeting:
    "Welcome back! I'm Boss Clinician AI. I can take you to pages in your portal and explain what’s on them in simple language, one detail at a time. What would you like help with?",
  firstVisitGreeting:
    "Welcome back! I'm Boss Clinician AI. I can take you around the portal and explain what’s on each page in simple language, one detail at a time. Would you like me to show you around? You can ask questions or say next or stop anytime.",
  tour: TOUR,
  tools: [
    "navigate_to",
    "go_back",
    "read_current_page",
    "point_at",
    "stop_pointing",
    "search_site",
    "my_account_summary",
    "start_guided_tour",
    "next_tour_stop",
    "end_guided_tour",
  ],
  destinations: DESTINATIONS,
  // Mirrors SURFACE_LIMITS.member on the server. A member's questions are longer
  // than a visitor's — "where did I get to in the course" is a conversation.
  maxSessionSeconds: 900,
  recordAudio: true,
};
