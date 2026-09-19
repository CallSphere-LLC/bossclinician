import { BOSS_CLINICIAN_PERSONA } from "@/voice/contract";
import type { TourStop, VoiceDestination, VoiceSurfacePolicy } from "@/voice/contract";

/**
 * The owner's concierge — a candid operations assistant.
 *
 * This is the only surface where the agent can change anything, and the only
 * one where it is allowed to be blunt. Yvette is running a business off these
 * screens; she does not need encouragement, she needs the number and the name
 * of the page it is on.
 *
 * Two rules shape the whole file.
 *
 * The first is that nothing happens without her. Every action goes
 * `propose_admin_action` → she approves it by voice, in the chat or by clicking
 * the card → `run_approved_action`. Anything destructive never takes a spoken
 * yes, because "yeah, go on" is a thing people say while thinking about
 * something else.
 *
 * The second is that every word below is read aloud to a non-technical business
 * owner. There is no "webhook" here, no "slug" and no "record identifier": it is
 * "the link people land on", "a label you put on people", "the list of everyone
 * you know". The app's own copy already talks this way, and the agent must not
 * be the one thing in the admin that reverts to the language of the API.
 */

const ADMIN: readonly ["admin"] = ["admin"];

const DESTINATIONS: readonly VoiceDestination[] = [
  {
    key: "dashboard",
    path: "/admin",
    label: "Dashboard",
    aliases: [
      "the dashboard",
      "home",
      "the front page",
      "how are we doing",
      "the overview",
      "my numbers",
    ],
    narration:
      "Your morning screen. Five figures across the top — money coming in, money every month, new sign-ups, things sold, money you have kept — a chart under whichever one you pick, your latest enquiries, and how many members, lessons and chats you have.",
    surfaces: ADMIN,
  },
  {
    key: "products",
    path: "/admin/products",
    label: "All products",
    aliases: [
      "products",
      "all products",
      "everything I sell",
      "what am I selling",
      "my products",
    ],
    narration:
      "One overview of everything you sell or give away — downloads, coaching, podcasts, newsletters, courses, communities and recurring plans — with a count for each and a Manage button into it.",
    surfaces: ADMIN,
  },
  {
    key: "catalogue",
    path: "/admin/catalogue",
    label: "Your catalogue",
    aliases: [
      "the catalogue",
      "my catalogue",
      "the things people can be given",
      "what can I put a price on",
      "add something to sell",
    ],
    narration:
      "The list of everything a buyer can be given access to, grouped by kind. Put a price on one of these and you have an offer; this page is where the thing itself is created, edited or retired.",
    surfaces: ADMIN,
  },
  {
    key: "downloads",
    path: "/admin/downloads",
    label: "Downloads",
    aliases: [
      "downloads",
      "my files people buy",
      "the workbooks I sell",
      "guides and toolkits",
      "add a download",
    ],
    narration:
      "The same catalogue, filtered to the things that are files — guides, workbooks and toolkits people buy and then re-download from their library. A live download with no files attached cannot be bought, and the page says so.",
    surfaces: ADMIN,
  },
  {
    key: "courses",
    path: "/admin/courses",
    label: "Courses",
    aliases: ["courses", "my courses", "the trainings", "add a course", "what I teach"],
    narration:
      "A card for every course you teach, with its cover, its summary and its price. Course content on a card opens the place where its sections and lessons are built.",
    surfaces: ADMIN,
  },
  {
    key: "community",
    path: "/admin/community",
    label: "Community",
    aliases: [
      "the community",
      "my communities",
      "the members group",
      "the forum",
      "create a community",
    ],
    narration:
      "Your private spaces where members talk to you and to each other. Each card shows whether it is free or paid and how many channels, members and posts it has.",
    surfaces: ADMIN,
  },
  {
    key: "media",
    path: "/admin/media",
    label: "Media library",
    aliases: [
      "media",
      "my files",
      "the media library",
      "upload a file",
      "my pictures",
      "my videos",
    ],
    narration:
      "Every picture, video, audio file and document you have uploaded, ready to drop into a course, a post, an episode or your website. Each file is marked either for anyone on the website or for buyers only.",
    surfaces: ADMIN,
  },
  {
    key: "coaching",
    path: "/admin/coaching",
    label: "Coaching",
    aliases: [
      "coaching",
      "my coaching packages",
      "my sessions",
      "who have I got booked",
      "book a session",
    ],
    narration:
      "Two tabs: Offers, where your coaching packages are created and priced, and Sessions, where every booked call sits with its date, its link, what you will cover and your private notes.",
    surfaces: ADMIN,
  },
  {
    key: "podcasts",
    path: "/admin/podcasts",
    label: "Podcasts",
    aliases: ["podcasts", "my show", "my episodes", "add an episode", "the podcast"],
    narration:
      "Your shows — public ones anybody can subscribe to, and members-only ones with a private listening link per person. Each show has a short checklist of what the podcast apps still want before it can be listed.",
    surfaces: ADMIN,
  },
  {
    key: "newsletters",
    path: "/admin/newsletters",
    label: "Newsletters",
    aliases: [
      "newsletters",
      "my newsletter",
      "write an issue",
      "the editions",
      "send a newsletter",
    ],
    narration:
      "Your newsletters on the left, and the chosen one's editions on the right, each showing whether it was sent, when, and to how many people.",
    surfaces: ADMIN,
  },
  {
    key: "offers",
    path: "/admin/offers",
    label: "Offers",
    aliases: [
      "offers",
      "my offers",
      "prices",
      "change a price",
      "the checkout links",
      "put something up for sale",
    ],
    narration:
      "An offer is a price and a checkout page for something you have already made, so the same thing can be sold at as many prices as you like. Three figures on top: offers in total, live right now, and sales so far.",
    surfaces: ADMIN,
  },
  {
    key: "payments",
    path: "/admin/sales/payments",
    label: "Payments",
    aliases: [
      "payments",
      "who bought something",
      "one-off purchases",
      "did that payment go through",
      "my sales",
    ],
    narration:
      "Every one-off purchase from your site — what they bought, how much, whether it went through and when — with the total collected so far in a badge above the table.",
    surfaces: ADMIN,
  },
  {
    key: "plans",
    path: "/admin/sales/plans",
    label: "Plans and pricing",
    aliases: [
      "plans",
      "pricing",
      "memberships",
      "monthly payments",
      "set up a monthly plan",
      "recurring",
    ],
    narration:
      "What people pay you every month or every year, for memberships and paid communities. Each card shows the price, any free trial, what it unlocks and how many people are paying it.",
    surfaces: ADMIN,
  },
  {
    key: "subscriptions",
    path: "/admin/sales/subscriptions",
    label: "Subscriptions",
    aliases: [
      "subscriptions",
      "who pays me monthly",
      "my members on a plan",
      "who cancelled",
      "overdue payments",
    ],
    narration:
      "Everyone paying you regularly and where each of them is up to — paying, on a free trial, overdue, cancelled or paused — with how much and when their next payment falls.",
    surfaces: ADMIN,
  },
  {
    key: "invoices",
    path: "/admin/sales/invoices",
    label: "Invoices and receipts",
    aliases: [
      "invoices",
      "receipts",
      "send someone a receipt",
      "she wants an invoice",
      "proof of payment",
    ],
    narration:
      "A receipt for every payment a member has made, one-off purchases and renewals alike, each one openable, downloadable as a document, or viewable in your payment provider.",
    surfaces: ADMIN,
  },
  {
    key: "coupons",
    path: "/admin/sales/coupons",
    label: "Coupons",
    aliases: [
      "coupons",
      "discount codes",
      "a code for a launch",
      "money off",
      "make a discount",
    ],
    narration:
      "Discount codes people type in while paying. Each shows how much it takes off, how many times it has been used, the dates it works between, and whether it currently works at all.",
    surfaces: ADMIN,
  },
  {
    key: "payouts",
    path: "/admin/sales/payouts",
    label: "Payouts",
    aliases: [
      "payouts",
      "when do I get paid",
      "money into my bank",
      "my bank transfers",
      "where is my money",
    ],
    narration:
      "One card, on purpose. Your bank details and the timing of each transfer live with your payment provider, so this page sends you straight there rather than keeping a second copy that would be slightly out of date.",
    surfaces: ADMIN,
  },
  {
    key: "partners",
    path: "/admin/partners",
    label: "Partners",
    aliases: [
      "partners",
      "affiliates",
      "who is promoting me",
      "pay a partner",
      "commission",
      "referrals",
    ],
    narration:
      "People who recommend your work and earn a share of what they send. Six tabs: an overview, your partners, paying them, things they can use, news for partners, and how it works.",
    surfaces: ADMIN,
  },
  {
    key: "blog",
    path: "/admin/blog",
    label: "Blog posts",
    aliases: ["the blog", "blog posts", "my articles", "write a post", "publish an article"],
    narration:
      "Every article on your website, with who wrote it, how long it takes to read, and whether readers can see it yet.",
    surfaces: ADMIN,
  },
  {
    key: "testimonials",
    path: "/admin/testimonials",
    label: "Testimonials",
    aliases: [
      "testimonials",
      "reviews",
      "kind words",
      "what clients said",
      "add a testimonial",
    ],
    narration:
      "The kind words clients have said about working with you, each with a name, their credentials and a photo, and a switch for whether it shows on your website.",
    surfaces: ADMIN,
  },
  {
    key: "resources",
    path: "/admin/resources",
    label: "Free resources",
    aliases: [
      "free resources",
      "my freebies",
      "the giveaways",
      "the masterclass listing",
      "the resources page",
    ],
    narration:
      "The guides, checklists and tools you give away, each with a name, a description, a cover image and the button that takes people to it. These are what fill your Resources page.",
    surfaces: ADMIN,
  },
  {
    key: "pages",
    path: "/admin/pages",
    label: "Website pages",
    aliases: [
      "pages",
      "my website words",
      "edit the home page",
      "change the wording on my site",
      "website text",
    ],
    narration:
      "Draft the words for each page of your website here — the title, the summary that shows in a search result, and every block of wording in its own labelled box. Nothing you save here is live yet; that switch-over needs your developer.",
    surfaces: ADMIN,
  },
  {
    key: "marketing-overview",
    path: "/admin/marketing/overview",
    label: "Marketing overview",
    aliases: [
      "marketing",
      "the marketing overview",
      "how is my marketing doing",
      "are my emails working",
      "marketing numbers",
    ],
    narration:
      "A scoreboard for the last thirty days: marketing emails sent with how many were opened and clicked, active sequences, form replies, automations that ran, and upcoming live events.",
    surfaces: ADMIN,
  },
  {
    key: "community-events",
    path: "/admin/marketing/events",
    label: "Community events",
    aliases: [
      "community events",
      "events inside a community",
      "a live session for my members",
      "put a date in the community diary",
    ],
    narration:
      "The diary of live sessions, question-and-answer calls and meet-ups that sit inside a community, where your existing members find them. Split into what is coming up and what has already happened.",
    surfaces: ADMIN,
  },
  {
    key: "campaigns",
    path: "/admin/marketing/campaigns",
    label: "Email campaigns",
    aliases: [
      "campaigns",
      "email campaigns",
      "write an email",
      "send an email to everyone",
      "my broadcasts",
    ],
    narration:
      "Everything you email people, in one list — one-off emails and the sequences that run on their own — filterable by kind, by state and by folder, with Send, copy and cancel on each row.",
    surfaces: ADMIN,
  },
  {
    key: "funnels",
    path: "/admin/marketing/funnels",
    label: "Funnels",
    aliases: [
      "funnels",
      "the path people take",
      "my landing pages",
      "how many people got to the offer",
    ],
    narration:
      "The path you walk somebody down, from the page they land on through to the thing you are selling. For the funnel you pick: how many times each stage was viewed, how many went on, and what share that is.",
    surfaces: ADMIN,
  },
  {
    key: "sequences",
    path: "/admin/marketing/sequences",
    label: "Email sequences",
    aliases: [
      "sequences",
      "email sequences",
      "the automatic emails after someone joins",
      "a drip",
      "start a sequence",
    ],
    narration:
      "A set of emails that goes out one after another, on your schedule, once somebody joins it. Each card shows how many emails it holds, how many people are going through it, and how many have finished.",
    surfaces: ADMIN,
  },
  {
    key: "automations",
    path: "/admin/marketing/automations-v2",
    label: "Automations",
    aliases: [
      "automations",
      "rules that run themselves",
      "if this then that",
      "tag someone automatically",
      "set up a rule",
    ],
    narration:
      "Rules that run themselves: when something happens, check a condition, then do something about it. Each card shows what starts it and the steps it takes, and whether it is running or paused.",
    surfaces: ADMIN,
  },
  {
    key: "automatic-emails",
    path: "/admin/marketing/emails",
    label: "Automatic emails",
    aliases: [
      "automatic emails",
      "the receipt email",
      "the welcome email",
      "the password reset email",
      "change what the site sends",
    ],
    narration:
      "The emails your site sends on its own — receipts, password resets, welcome notes. You can rewrite the words of any of them, and leaving a box blank puts the original wording back.",
    surfaces: ADMIN,
  },
  {
    key: "quizzes",
    path: "/admin/marketing/quizzes",
    label: "Quizzes",
    aliases: ["quizzes", "my quiz", "the practice quiz", "a survey", "add a quiz"],
    narration:
      "Ask people a few questions, add up their answers, and send each of them the result that fits. Opening one leads to where the questions and the result for each score are written.",
    surfaces: ADMIN,
  },
  {
    key: "events",
    path: "/admin/marketing/events-v2",
    label: "Events and webinars",
    aliases: [
      "events",
      "webinars",
      "my masterclass",
      "who signed up for the webinar",
      "who turned up",
      "schedule an event",
    ],
    narration:
      "Webinars, workshops and recordings people register for from your website: who signed up, who turned up, and what happened next. Different from community events, which sit inside a community for members you already have.",
    surfaces: ADMIN,
  },
  {
    key: "forms",
    path: "/admin/marketing/forms-v2",
    label: "Forms",
    aliases: [
      "forms",
      "my forms",
      "an application form",
      "a waitlist form",
      "build a form",
      "the replies to my form",
    ],
    narration:
      "Ask people whatever you need to know, then label them and start their emails automatically. Opening a form leads to its questions, its thank-you step and the link people fill it in at.",
    surfaces: ADMIN,
  },
  {
    key: "contacts",
    path: "/admin/contacts",
    label: "People",
    aliases: [
      "contacts",
      "people",
      "everyone I know",
      "find someone",
      "look up a person",
      "my list",
    ],
    narration:
      "Everyone you know — whoever enquired, joined your list, signed up or bought something — one card each, with filters, sorting, and bulk actions for labelling them or starting their emails.",
    surfaces: ADMIN,
  },
  {
    key: "contacts-insights",
    path: "/admin/contacts/insights",
    label: "Contact insights",
    aliases: [
      "insights",
      "how healthy is my list",
      "who unsubscribed",
      "bounced emails",
      "who stopped opening my emails",
    ],
    narration:
      "The health of your list: how many contacts, how many subscribed, how many are customers, who is no longer receiving marketing and why, and how engaged your subscribers still are.",
    surfaces: ADMIN,
  },
  {
    key: "segments",
    path: "/admin/segments",
    label: "Groups",
    aliases: [
      "groups",
      "segments",
      "saved searches",
      "everyone who bought the masterclass",
      "a saved question about my people",
    ],
    narration:
      "Saved questions about your people that keep themselves up to date — bought the masterclass, on the retreat waitlist and never bought. Each card shows how many people match right now.",
    surfaces: ADMIN,
  },
  {
    key: "tags",
    path: "/admin/tags",
    label: "Tags",
    aliases: [
      "tags",
      "labels",
      "label people",
      "the waitlist tag",
      "how many people have that label",
    ],
    narration:
      "Labels you put on people so you can find them again — quiz answers, waitlists, anyone who has been to a retreat — each showing how many people carry it.",
    surfaces: ADMIN,
  },
  {
    key: "leads",
    path: "/admin/leads",
    label: "Enquiries",
    aliases: [
      "enquiries",
      "leads",
      "who got in touch",
      "my inbox",
      "new applications",
      "who do I need to reply to",
    ],
    narration:
      "Everyone who has reached out through your website — applications, contact forms and anything else people fill in — filed by what you have done about each one, with the whole message in a pop-up.",
    surfaces: ADMIN,
  },
  {
    key: "conversations",
    path: "/admin/conversations",
    label: "Conversations",
    aliases: [
      "conversations",
      "the website chat",
      "what did people ask the assistant",
      "chat transcripts",
    ],
    narration:
      "Every chat somebody has had with the assistant on your website, typed or spoken, word for word, with the most recent first.",
    surfaces: ADMIN,
  },
  {
    key: "voice-sessions",
    path: "/admin/voice-sessions",
    label: "Voice conversations",
    aliases: [
      "voice conversations",
      "the calls with the assistant",
      "who talked to you",
      "the recordings",
      "what did I ask you yesterday",
    ],
    narration:
      "Every call somebody has taken with me — on your website, in the members' portal, or in here — with what was said and the recording where there is one.",
    surfaces: ADMIN,
  },
  {
    key: "members",
    path: "/admin/members",
    label: "Members",
    aliases: [
      "members",
      "my students",
      "who has access",
      "who is in that course",
      "give someone access",
    ],
    narration:
      "Everyone with an account: what they are enrolled in, whether they have access, are invited, paused or ended, and when you last saw them.",
    surfaces: ADMIN,
  },
  {
    key: "subscribers",
    path: "/admin/subscribers",
    label: "Subscribers",
    aliases: [
      "subscribers",
      "my email list",
      "who signed up for emails",
      "download my list",
      "where did they sign up",
    ],
    narration:
      "Everyone on your email list, which sign-up box on the site they came through, and when they joined — downloadable as a spreadsheet.",
    surfaces: ADMIN,
  },
  {
    key: "analytics",
    path: "/admin/analytics",
    label: "Analytics overview",
    aliases: [
      "analytics",
      "my charts",
      "how much money have I made",
      "audience growth",
      "most popular course",
    ],
    narration:
      "Four all-time figures — money coming in, money every month, enquiries and people on your email list — over four charts of the last thirty days: revenue, audience growth, where your enquiries are up to, and your most popular courses.",
    surfaces: ADMIN,
  },
  {
    key: "reports",
    path: "/admin/analytics/reports",
    label: "Reports",
    aliases: [
      "reports",
      "my numbers",
      "find a report",
      "a breakdown of something",
      "saved views",
    ],
    narration:
      "Everything the platform keeps track of, grouped the way you would ask for it, with a search box and any views you have saved. The figures are worked out overnight, and there is a button to redo them now.",
    surfaces: ADMIN,
  },
  {
    key: "settings",
    path: "/admin/settings",
    label: "Settings",
    aliases: [
      "settings",
      "change a setting",
      "the checkout settings",
      "my email settings",
      "branding",
      "how my business runs",
    ],
    narration:
      "The front door to settings, as a grid of cards: the basics, payments and checkout, email, customers, course delivery, coaching, forms, your website and connected services — and below them, coaching availability, who can get in, connections and the activity log.",
    surfaces: ADMIN,
  },
  {
    key: "settings-team",
    path: "/admin/settings/team",
    label: "Who can get in",
    aliases: [
      "team",
      "who can get in",
      "invite someone to help me",
      "my assistant's access",
      "sign-in security",
    ],
    narration:
      "The people who can sign in to this admin and what each is allowed to do, plus your own sign-in security. An invitation can be withdrawn before it is accepted, and access suspended afterwards without losing their history.",
    surfaces: ADMIN,
  },
  {
    key: "settings-connections",
    path: "/admin/settings/connections",
    label: "Connections",
    aliases: [
      "connections",
      "connect another tool",
      "zapier",
      "plug in my other software",
      "tell another tool when someone buys",
    ],
    narration:
      "Where you plug your other tools into this one. You can have us tell another tool the moment somebody buys, signs up or fills in a form, see whether those messages arrived, and give a tool a key so it can look your information up.",
    surfaces: ADMIN,
  },
  {
    key: "settings-availability",
    path: "/admin/settings/availability",
    label: "Coaching availability",
    aliases: [
      "availability",
      "my coaching hours",
      "when can people book me",
      "block a holiday",
      "my calendar rules",
    ],
    narration:
      "The hours clients may book, date-by-date exceptions for holidays or extra time, and a preview of the exact appointment times a client would actually be offered. Four rules on top: your time zone, how often a slot starts, how much notice you need, and how far ahead people can book.",
    surfaces: ADMIN,
  },
  {
    key: "settings-website",
    path: "/admin/settings/advanced",
    label: "Website details",
    aliases: [
      "website details",
      "my menu",
      "the footer",
      "my contact details on the site",
      "change the top menu",
    ],
    narration:
      "Your top menu, your footer wording and small-print links, and the contact details your website shows. Nothing saves by itself here — there is a Save changes button, and a marker when you have something unsaved.",
    surfaces: ADMIN,
  },
  {
    key: "settings-activity",
    path: "/admin/settings/activity",
    label: "Activity log",
    aliases: [
      "activity log",
      "what changed",
      "who changed that",
      "the history",
      "who deleted it",
    ],
    narration:
      "Everything that has been changed in this admin — who did it, when, and what the record looked like before and after. Nothing on this page can be edited or removed, which is the point of it.",
    surfaces: ADMIN,
  },
  {
    key: "email-log",
    path: "/admin/settings/email/log",
    label: "Delivery log",
    aliases: [
      "delivery log",
      "did my email arrive",
      "email log",
      "she says she never got it",
      "what happened to my emails",
    ],
    narration:
      "Every message this site sent and whether it actually arrived. This is the page to open when somebody tells you they never received a receipt.",
    surfaces: ADMIN,
  },
];

/**
 * The walkthrough, in the order of the menu she already reads down.
 *
 * Following the navigation rather than inventing a better order is deliberate:
 * a tour that visits pages in some cleverer sequence teaches a map of the
 * product that the sidebar then contradicts. Each stop says what the page is
 * FOR before it says what is on it, because "Offers" is a word that means
 * nothing until somebody explains that it is a price rather than a thing.
 */
const TOUR: readonly TourStop[] = [
  {
    destination: "dashboard",
    purpose:
      "The morning screen. If she only ever opens one page, this is the one, so it has to be the one she understands best.",
    beats: [
      {
        focus: "Money coming in",
        say: "Everything people paid you over the last thirty days. Press the tile and the chart underneath redraws itself as that figure day by day.",
      },
      {
        focus: "Money every month",
        say: "This is what everyone on a membership adds up to each month as things stand today — the figure that tells you whether next month is already covered.",
      },
      {
        focus: "Enquiries",
        say: "And these four cards are the work waiting for you. If this one says there are new enquiries to reply to, that is the most valuable thing on the screen.",
      },
      {
        focus: "Work them out now",
        say: "The figures are recalculated every night. If you have just made a sale and want to see it immediately, this redoes them on the spot.",
      },
    ],
  },
  {
    destination: "products",
    purpose: "The map of everything she sells, so nothing she has made is ever forgotten about.",
    beats: [
      {
        focus: "All Products",
        say: "Everything you sell or give away, counted by kind — downloads, coaching, podcasts, newsletters, courses, communities and recurring plans.",
      },
      {
        focus: "Manage",
        say: "Each row's Manage button drops you into the proper screen for that kind of thing. Think of this page as the index rather than a place you work.",
      },
    ],
  },
  {
    destination: "catalogue",
    purpose:
      "The distinction the whole sales side rests on: the thing itself lives here, and its price lives somewhere else.",
    beats: [
      {
        focus: "Your catalogue",
        say: "This is the list of things a buyer can be given. A course, a pack of files, a community, time with you — the thing itself, with no price on it.",
      },
      {
        focus: "Add something to sell",
        say: "You make the thing here, then put a price on it under Offers. Keeping them apart is what lets you sell the same course at three different prices without making it three times.",
      },
      {
        focus: "Show the retired ones",
        say: "One more thing worth knowing: retiring something takes it out of use without deleting it, and the people who already bought it keep their access. It is almost always the right choice over deleting, and this brings them back into view.",
      },
    ],
  },
  {
    destination: "downloads",
    purpose: "The same catalogue narrowed to file products, which have one trap worth naming.",
    beats: [
      {
        focus: "Downloads",
        say: "The same list, showing only the things that are files — guides, workbooks, toolkits. Buyers find them again in their own library whenever they like.",
      },
      {
        focus: "Add files",
        say: "Here is the trap: a download with no files attached cannot be bought at all. If you see a warning on this page, this is the button that clears it.",
      },
    ],
  },
  {
    destination: "courses",
    purpose: "Where a course is created, and the door into building its lessons.",
    beats: [
      {
        focus: "Add a course",
        say: "This creates the course and asks for its name, its summary, its cover and its price. That is the outside of it.",
      },
      {
        focus: "Course content",
        say: "And this is the inside. It opens the builder, where you add sections, then the lessons that go in each one, and choose when each part opens to students.",
      },
      {
        focus: "Not visible yet",
        say: "A course stays marked not visible until you say otherwise, so you can build it in the open without anybody stumbling into a half-finished one.",
      },
    ],
  },
  {
    destination: "community",
    purpose: "The private spaces members talk in, and what makes one paid rather than free.",
    beats: [
      {
        focus: "New community",
        say: "A community is a private space with channels, challenges and live events. When you make one you choose whether anyone can join or only paying members.",
      },
      {
        focus: "Channels",
        say: "These three counts — channels, members and posts — are the quickest read on whether a space is actually alive or quietly empty.",
      },
    ],
  },
  {
    destination: "media",
    purpose: "The one place every image and video lives, and the audience choice that matters.",
    beats: [
      {
        focus: "Who is this file for?",
        say: "Set this before you upload. Anyone on the website means the file can be seen by the public; only people who bought it means it stays behind a purchase.",
      },
      {
        focus: "Drag your files here",
        say: "Drop files here or choose them from your computer. Uploads keep running while you work on something else — there is a tray in the corner that shows them.",
      },
      {
        focus: "Copy link",
        say: "Copy gives you the address of a file so you can drop it into a lesson, a post or an episode.",
      },
    ],
  },
  {
    destination: "coaching",
    purpose: "Selling coaching, and then running the calls you sold.",
    beats: [
      {
        focus: "Offers",
        say: "This tab is what you sell — a package of sessions, one to one or group, with a price on it.",
      },
      {
        focus: "Sessions",
        say: "And this tab is the calls themselves: when each one is, the joining link, what the client wanted to work on, and your private notes, which only you ever see.",
      },
      {
        focus: "Book a session",
        say: "You can also put a session in yourself, for a client who arranged it with you directly rather than through the site.",
      },
    ],
  },
  {
    destination: "podcasts",
    purpose: "Publishing a show, and the difference between a public one and a members-only one.",
    beats: [
      {
        focus: "New show",
        say: "A show can be public, so anyone can subscribe in Apple Podcasts or Spotify, or members-only, where each listener gets a private link of their own.",
      },
      {
        focus: "Add an episode",
        say: "Episodes go in one at a time, with the audio and the notes. The podcast apps pick them up from there.",
      },
      {
        focus: "Everything they ask for is here",
        say: "There is a short checklist on each show — cover art, a description, your name as host, a category. The apps will not list a show until it is complete.",
      },
    ],
  },
  {
    destination: "newsletters",
    purpose: "Writing to the list on a rhythm, and who each newsletter reaches.",
    beats: [
      {
        focus: "New newsletter",
        say: "A newsletter is the publication; an edition is one issue of it. A newsletter can be free for everyone or only for people paying for one of your plans.",
      },
      {
        focus: "New edition",
        say: "You can write an edition, save it, and come back to it. It sits marked not sent until you press Send, so there is no way to fire one off by accident.",
      },
    ],
  },
  {
    destination: "offers",
    purpose: "The other half of the catalogue: this is where money gets attached to a thing.",
    beats: [
      {
        focus: "Create an offer",
        say: "An offer is a price and a checkout page for something already in your catalogue. Pick what they get, say what it costs, and you have a link you can share anywhere.",
      },
      {
        focus: "Copy the checkout link",
        say: "This gives you the address that takes somebody straight to paying. It is what goes in an email, a post or a message.",
      },
      {
        focus: "Live on your site",
        say: "Nothing sells until it says live. Stop selling it takes the price down without deleting anything, which is how you close a launch.",
      },
    ],
  },
  {
    destination: "payments",
    purpose: "The record of every one-off purchase.",
    beats: [
      {
        focus: "Payments",
        say: "Every one-off purchase from your site, with what was bought, how much, whether it went through and when. Nothing here can be changed — it is a record.",
      },
      {
        focus: "collected so far",
        say: "The badge above the table is the running total, which is the fastest honest answer to how much has come in.",
      },
    ],
  },
  {
    destination: "plans",
    purpose: "The recurring side of the business, which is the part that compounds.",
    beats: [
      {
        focus: "New plan",
        say: "A plan is what somebody pays you every month or every year. You set the price, the interval, any free trial, and what it unlocks for them.",
      },
      {
        focus: "people paying",
        say: "Each card tells you how many people are currently paying it. This number moving up is the healthiest signal in the whole admin.",
      },
    ],
  },
  {
    destination: "subscriptions",
    purpose: "Every person on a plan, and where each of them is up to.",
    beats: [
      {
        focus: "Subscriptions",
        say: "Everyone paying you regularly, with their state beside them — paying, on a free trial, overdue, cancelled or paused.",
      },
      {
        focus: "Next payment",
        say: "And when their next payment falls. Payment overdue is the one to act on: it usually means a card expired rather than somebody changing their mind.",
      },
    ],
  },
  {
    destination: "invoices",
    purpose: "Producing a receipt when somebody asks for one, which they will.",
    beats: [
      {
        focus: "Invoices & receipts",
        say: "A receipt for every payment a member has made, one-off purchases and renewals alike.",
      },
      {
        focus: "See the receipt",
        say: "See the receipt opens it; the document button gives you a file you can email. Members can also find their own without asking you.",
      },
    ],
  },
  {
    destination: "coupons",
    purpose: "Discounting on purpose, and the difference between switching a code off and deleting it.",
    beats: [
      {
        focus: "New coupon",
        say: "A code somebody types in while paying. A code that only works for a few days is the simplest way to get people to buy now rather than later.",
      },
      {
        focus: "Switch off",
        say: "Switching a code off keeps it in this list but stops it working, so you can run the same offer again next time. Deleting it removes it for good.",
      },
    ],
  },
  {
    destination: "payouts",
    purpose: "Where the money actually lands, and why this page is deliberately thin.",
    beats: [
      {
        focus: "Your payouts live in Stripe",
        say: "One card, on purpose. Your bank details and the timing of each transfer are held by your payment provider, so this sends you there rather than showing you a copy that might be a day behind.",
      },
    ],
  },
  {
    destination: "partners",
    purpose: "Running a referral programme: approving people, and paying them.",
    beats: [
      {
        focus: "Your partners",
        say: "People who recommend your work and earn a share of what they send. Somebody who applies through your partner page lands here waiting for your yes.",
      },
      {
        focus: "Paying them",
        say: "Money earned stays inside the refund window for a few weeks before it can be paid. This tab shows what has cleared, prepares a payment, and lets you mark it off once the money has actually gone.",
      },
      {
        focus: "Things they can use",
        say: "And this is worth filling in. Pictures and wording a partner can drop straight into a post is the difference between a partner who means to promote you and one who does.",
      },
    ],
  },
  {
    destination: "blog",
    purpose: "The articles on her website.",
    beats: [
      {
        focus: "Write a post",
        say: "Your articles. You can write one from scratch, or ask for a first draft and edit it into your own words.",
      },
      {
        focus: "On your site",
        say: "A post stays marked not visible until you put it live, so a half-written one can sit here as long as you like.",
      },
    ],
  },
  {
    destination: "testimonials",
    purpose: "The social proof that appears across the marketing site.",
    beats: [
      {
        focus: "Add a testimonial",
        say: "The kind words clients have said about working with you — a name, their credentials, a photo and the quote.",
      },
      {
        focus: "Live on your site",
        say: "Each one has a switch for whether it shows on your website, so you can hold one back without throwing it away.",
      },
    ],
  },
  {
    destination: "resources",
    purpose: "The free things she gives away, which is how most people first arrive.",
    beats: [
      {
        focus: "Add a free resource",
        say: "The guides, checklists and tools you give away. Each one needs a name, a description, a cover and the button that takes people to it.",
      },
      {
        focus: "Resource",
        say: "Everything switched on here fills your public Resources page, which is where most people meet you before they ever buy anything.",
      },
    ],
  },
  {
    destination: "pages",
    purpose: "Drafting website wording, with one honest limitation.",
    beats: [
      {
        focus: "Your pages",
        say: "Pick a page of your website on the left and its wording opens on the right, in labelled boxes — the top of the page, the headline, the button text.",
      },
      {
        focus: "Description for Google",
        say: "This one is the sentence that shows underneath your page in a search result. It is worth writing properly; it is often the only thing a stranger reads.",
      },
      {
        focus: "Save page",
        say: "Be aware that what you save here is a draft. It is not on your live website yet — that switch-over is a job for your developer, and the page says so.",
      },
    ],
  },
  {
    destination: "marketing-overview",
    purpose: "One scoreboard for whether the marketing is working at all.",
    beats: [
      {
        focus: "Marketing emails sent",
        say: "The last thirty days at a glance: emails sent, and underneath them how many were opened and how many were clicked.",
      },
      {
        focus: "Form replies",
        say: "Along with active sequences, form replies, automations that ran and upcoming live events. Nothing here can be changed — it is the read before you decide what to do.",
      },
    ],
  },
  {
    destination: "community-events",
    purpose: "Live sessions for the members she already has.",
    beats: [
      {
        focus: "Add an event",
        say: "These are live sessions and question-and-answer calls that sit inside a community, so your existing members find them where they already are.",
      },
      {
        focus: "Coming up",
        say: "One thing to know: an event has to belong to a community, so if you have not made a community yet, that comes first.",
      },
    ],
  },
  {
    destination: "campaigns",
    purpose: "Everything she emails people, in one place.",
    beats: [
      {
        focus: "Write an email",
        say: "This is a one-off email — you write it, choose who gets it, and send or schedule it.",
      },
      {
        focus: "New sequence",
        say: "And this is a set of emails that goes out on its own once somebody joins. Both kinds appear in this one list so you never have to remember which screen a message was made on.",
      },
      {
        focus: "Clear filters",
        say: "Three filters sit above the list — by kind, by state and by folder — and this clears all of them at once when you have narrowed yourself into a corner.",
      },
    ],
  },
  {
    destination: "funnels",
    purpose: "The path from a first click to a purchase, and where people fall out of it.",
    beats: [
      {
        focus: "New funnel",
        say: "A funnel is the path you walk somebody down — the page they land on, then the next step, then the thing you are selling.",
      },
      {
        focus: "Times viewed",
        say: "For each stage: how many times it was viewed, how many people went on, and what share that is. The stage where the share collapses is the one to fix.",
      },
    ],
  },
  {
    destination: "sequences",
    purpose: "Emails that arrive in order after somebody joins.",
    beats: [
      {
        focus: "New sequence",
        say: "Everybody who joins a sequence gets your emails in order, spaced however you like. It is the most useful thing here that runs while you are with clients.",
      },
      {
        focus: "Going through",
        say: "These three figures — emails, going through, finished — tell you whether a sequence is actually being fed with new people or has quietly run dry.",
      },
    ],
  },
  {
    destination: "automations",
    purpose: "The if-this-then-that rules, explained without the vocabulary.",
    beats: [
      {
        focus: "New automation",
        say: "A rule that runs itself: when something happens — somebody buys, somebody fills in a form — check a condition, then do something about it.",
      },
      {
        focus: "Running",
        say: "Each one says whether it is running or paused, and every step it takes is written out in plain sentences so you can read what it will do before switching it on.",
      },
      {
        focus: "Needs attention",
        say: "If a rule is marked as needing attention, something it relied on has moved. It is worth opening straight away rather than leaving it running on a broken step.",
      },
    ],
  },
  {
    destination: "automatic-emails",
    purpose: "The emails the site sends by itself, which are the ones customers read most.",
    beats: [
      {
        focus: "Automatic emails",
        say: "These are the ones your site sends on its own — receipts, password resets, welcome notes. Every customer sees several of them, and they are easy to forget about.",
      },
      {
        focus: "Edit the wording",
        say: "You can rewrite any of them in your own voice. Leave a box blank and it goes back to the wording we ship with, so there is no way to break one permanently.",
      },
    ],
  },
  {
    destination: "quizzes",
    purpose: "Quizzes as a way of sorting people, not just entertaining them.",
    beats: [
      {
        focus: "Add a quiz",
        say: "Ask a few questions, add up the answers, and send each person the result that fits. That is how your practice quiz decides which programme to recommend.",
      },
      {
        focus: "Create and start writing",
        say: "Once it exists you write the questions and then the result each score should land on. Everyone who takes it shows up in the same place.",
      },
    ],
  },
  {
    destination: "events",
    purpose:
      "Webinars and workshops people register for from the public site — the other kind of event.",
    beats: [
      {
        focus: "Add an event",
        say: "These are the events strangers sign up for from your website — a webinar, a workshop, a live class. Different from community events, which are for members you already have.",
      },
      {
        focus: "Webinars, workshops and recordings",
        say: "Each event keeps its sign-ups and who actually turned up. The gap between those two numbers is usually the most useful thing you learn from running one.",
      },
    ],
  },
  {
    destination: "forms",
    purpose: "Asking people questions, and what happens to their answers.",
    beats: [
      {
        focus: "Add a form",
        say: "Ask whatever you need to know — an application, a waitlist, a few questions before a call — and every reply lands here ready to download.",
      },
      {
        focus: "Create and add questions",
        say: "Building one gives you the questions, the thank-you step, and the link people land on to fill it in.",
      },
      {
        focus: "Forms",
        say: "A form can also label the person and start their emails the moment they submit, which saves you doing it by hand later.",
      },
    ],
  },
  {
    destination: "contacts",
    purpose:
      "The single list underneath everything: every person the business has ever heard from.",
    beats: [
      {
        focus: "People",
        say: "Everyone you know, on one card each — whoever enquired, joined your list, signed up or bought something. Everything else in this section is a view of this list.",
      },
      {
        focus: "Happy to hear from you",
        say: "These chips narrow the list by whether somebody still wants your emails. Opening any person's card gives you their purchases, their labels and their whole story in one place.",
      },
      {
        focus: "Import a list",
        say: "You can bring people in from a spreadsheet here. And once you tick a few rows, a bar appears offering to label them, start their emails or grant them an offer — that is how you do something to twenty people at once.",
      },
    ],
  },
  {
    destination: "contacts-insights",
    purpose: "The health of the list, which decides whether her emails arrive at all.",
    beats: [
      {
        focus: "Subscribed",
        say: "How many contacts you have, how many are happy to hear from you, and how many have bought something. Every figure here is a link into the people behind it.",
      },
      {
        focus: "People no longer receiving marketing",
        say: "This section matters more than it looks. Bounced addresses and spam complaints are what make email providers stop trusting you, so a growing number here is worth acting on.",
      },
      {
        focus: "Subscriber engagement",
        say: "And this groups people by how recently they opened or clicked. Sending to people who have ignored you for a year is what drags the rest of your delivery down.",
      },
    ],
  },
  {
    destination: "segments",
    purpose: "Saved questions about people, and how they differ from labels.",
    beats: [
      {
        focus: "Create a group",
        say: "A group is a question you keep asking — everyone who bought a course but has not been back since. It answers itself again every time you look.",
      },
      {
        focus: "See who's in it",
        say: "The badge on each card is how many people match right now, and this opens the list of them. Nobody is added by hand — that is the difference from a tag.",
      },
    ],
  },
  {
    destination: "tags",
    purpose: "Labels she puts on people herself.",
    beats: [
      {
        focus: "Add a tag",
        say: "A tag is a label you put on somebody — a quiz answer, a waitlist, anyone who has been to a retreat. You choose who has it, unlike a group.",
      },
      {
        focus: "See who has it",
        say: "Each one shows how many people carry it, and this opens them. Tags are what your automations and sequences usually look for.",
      },
    ],
  },
  {
    destination: "leads",
    purpose: "The enquiries inbox — the highest-value page in the admin on most days.",
    beats: [
      {
        focus: "New enquiry",
        say: "Everyone who has reached out through your website. These chips file them by what you have done next, and New enquiry is the pile that costs you money to ignore.",
      },
      {
        focus: "What they wrote",
        say: "Opening one shows the whole message plus anything else the form collected, so you can answer properly instead of guessing what they asked.",
      },
      {
        focus: "Reply by email",
        say: "And this opens a reply to them. Changing the state afterwards is what keeps the piles honest for tomorrow.",
      },
    ],
  },
  {
    destination: "conversations",
    purpose: "What visitors have been asking the website assistant, in their own words.",
    beats: [
      {
        focus: "Recent chats",
        say: "Every chat somebody has had with the assistant on your website, typed or spoken, word for word.",
      },
      {
        focus: "Voice",
        say: "It is worth reading occasionally. The questions strangers ask an assistant are the questions your sales pages have not answered yet.",
      },
    ],
  },
  {
    destination: "voice-sessions",
    purpose: "Every call taken with the assistant, including this one.",
    beats: [
      {
        focus: "Voice conversations",
        say: "Every call anybody has taken with me — visitors on your website, members in their portal, and you in here — with what was said and the recording where there is one.",
      },
      {
        focus: "Voice",
        say: "This is also where you check what I actually did on your behalf, which you should be able to do without taking my word for it.",
      },
    ],
  },
  {
    destination: "members",
    purpose: "The people with accounts, and what each of them can get into.",
    beats: [
      {
        focus: "Members",
        say: "Everyone with an account: what they are enrolled in, whether their access is live, invited, paused or ended, and when you last saw them.",
      },
      {
        focus: "Add a member",
        say: "This page fills itself as people buy, but you can also add somebody yourself — for a client who paid you directly, or somebody you want to give access to.",
      },
      {
        focus: "Download everyone",
        say: "There is also a filter for one particular course, which is how you answer who is actually in the programme right now — and this gives you the whole list as a spreadsheet.",
      },
    ],
  },
  {
    destination: "subscribers",
    purpose: "The email list, and where each person came from.",
    beats: [
      {
        focus: "Subscribers",
        say: "Everyone on your email list, with the sign-up box they came through — your footer, a resource page, the free masterclass — and when they joined.",
      },
      {
        focus: "Download as spreadsheet",
        say: "Knowing which box brings people in tells you which page is doing the work. And this gives you the whole list as a spreadsheet whenever you want it.",
      },
    ],
  },
  {
    destination: "analytics",
    purpose: "The four numbers and four charts that describe the business.",
    beats: [
      {
        focus: "Money coming in",
        say: "The four figures across the top are all time — everything ever paid to you, what the memberships add up to monthly, your enquiries, and the size of your email list.",
      },
      {
        focus: "Audience growth",
        say: "The charts underneath cover the last thirty days: revenue, audience growth, where your enquiries are up to, and your most popular courses.",
      },
      {
        focus: "Most popular courses",
        say: "This last one is the one to act on. The course people actually enrol in is usually not the one you expected, and it tells you what to make next.",
      },
    ],
  },
  {
    destination: "reports",
    purpose: "Everything the platform tracks, findable by asking for it in plain words.",
    beats: [
      {
        focus: "Your numbers",
        say: "Everything the platform keeps track of, grouped the way you would ask for it. There is a box at the top: type what you want to know rather than hunting through a menu.",
      },
      {
        focus: "Your saved views",
        say: "When you set a report up the way you like it, it stays here so you are not rebuilding it every month.",
      },
      {
        focus: "Update these figures",
        say: "The figures are worked out overnight. If you want them as of this minute, this redoes them now.",
      },
    ],
  },
  {
    destination: "settings",
    purpose:
      "The front door to everything about how the business runs — and the page to point at rather than navigate blindly.",
    beats: [
      {
        focus: "Your business",
        say: "Nine cards for how your business runs: the basics, payments and checkout, email, customers, course delivery, coaching, forms, your website and connected services.",
      },
      {
        focus: "Payments & checkout",
        say: "This is the one you will open most — how your checkout looks, what it collects, and what happens after somebody pays.",
      },
      {
        focus: "Email",
        say: "And this one has a red marker on it if there is anything outstanding before you can send email at all, which is the kind of problem you want to find here rather than after a launch.",
      },
    ],
  },
  {
    destination: "settings-team",
    purpose: "Sharing the load safely.",
    beats: [
      {
        focus: "Invite someone",
        say: "Invite somebody when you are ready to share the load, and choose what they are allowed to do. They get an emailed link to set their own password.",
      },
      {
        focus: "Waiting to accept",
        say: "An invitation can be withdrawn before it is accepted. Afterwards you suspend their access instead, which keeps their account and their history intact.",
      },
      {
        focus: "Your sign-in",
        say: "And this card is about your own account. Turning on the extra code at sign-in is the single most useful thing you can do here.",
      },
    ],
  },
  {
    destination: "settings-connections",
    purpose: "Plugging other software in, in the owner's language.",
    beats: [
      {
        focus: "Tell another tool when something happens",
        say: "If you use something else alongside this — Zapier, a spreadsheet, another system — we can tell it the moment somebody buys, signs up or fills in a form.",
      },
      {
        focus: "Recent messages",
        say: "This shows what we have sent lately and whether it arrived, so when the other tool says it heard nothing, you can check rather than guess.",
      },
      {
        focus: "Let a tool read your information",
        say: "And the other direction: you can give a tool a key so it can look up your contacts, orders and offers. You only need one if something asks you for it.",
      },
    ],
  },
  {
    destination: "settings-availability",
    purpose: "When clients may book her, which is the setting that protects her week.",
    beats: [
      {
        focus: "Weekly hours",
        say: "The hours clients may book, day by day. You can add more than one window to a day when you take a break between sessions.",
      },
      {
        focus: "Date exceptions",
        say: "Exceptions override the weekly pattern — block a holiday, or open extra hours on one particular date.",
      },
      {
        focus: "Client preview",
        say: "And this is the part to trust. It shows the exact times a client would actually be offered, after your notice rules and everything already in your diary.",
      },
    ],
  },
  {
    destination: "settings-website",
    purpose: "The menu, footer and contact details her public site shows.",
    beats: [
      {
        focus: "Main menu",
        say: "The links across the top of your site, in the order they appear. Adding one here changes your website's own menu.",
      },
      {
        focus: "Contact details",
        say: "And the footer wording, the small-print links and how people reach you — kept here once so your contact page and your footer cannot disagree.",
      },
      {
        focus: "Save changes",
        say: "Nothing on this page saves by itself. If you see the unsaved marker, press this before you leave.",
      },
    ],
  },
  {
    destination: "settings-activity",
    purpose: "The unchangeable record of who changed what.",
    beats: [
      {
        focus: "Activity log",
        say: "Everything that has been changed in this admin — who did it, when, and what the record looked like before and after. Nothing here can be edited or removed.",
      },
      {
        focus: "Who",
        say: "This is the page for when something is not as you left it. Filter by person or by date range and you will usually find it in a minute.",
      },
    ],
  },
  {
    destination: "email-log",
    purpose: "Whether an email actually arrived — the answer to the most common support question.",
    beats: [
      {
        focus: "Delivery log",
        say: "Every message this site sent, and whether it actually arrived. Open this when somebody tells you they never got their receipt.",
      },
    ],
  },
];

export const ADMIN_POLICY: VoiceSurfacePolicy = {
  surface: "admin",
  audience: "admin",
  agentName: "Boss Clinician AI",
  voice: "marin",
  // The shared persona first and verbatim — see the note in public.ts. On this
  // surface the ordering matters twice over: the persona is what stops the
  // agent from answering as Yvette on the one screen where speaking for her
  // could actually move money.
  instructions: [
    BOSS_CLINICIAN_PERSONA,
    [
      "You are inside Yvette's own admin, and you work for her. Be candid: she is running a business off these screens and does not need cheering up. If a number is down, say it is down. If a page is showing a warning, say what the warning is.",
      "Every word you say here is heard by a non-technical business owner. Say \"the link people land on\", never \"the slug\". Say \"plug another tool in\" rather than naming the mechanism. If you cannot explain something without the language of the software, explain what it achieves instead.",
      "You may run real actions here, and only after she approves them. Propose the action first with a plain-English summary of exactly what will change, wait for her yes — spoken, typed, or by pressing the button on the card — and only then run it. If she amends it, propose the amended version afresh rather than running something she did not agree to.",
      "Anything that deletes, refunds, cancels, or emails a group of people is destructive. A spoken yes is not enough for those; she must press the button. Say so plainly rather than pressing her for one.",
      "Two pairs of pages are easy to confuse, so name them carefully. Community events sit inside a community for members she already has, while Events and webinars are what strangers register for from the website. And the catalogue holds the thing itself while Offers holds its price — something in the catalogue with no offer against it cannot be bought at all.",
      "When she asks where something is, take her there and point at the control, rather than reciting directions she then has to follow herself.",
      "If she accepts the walkthrough, walk the menu in the order she already reads it down, and say what each screen is FOR before saying what is on it.",
    ].join(" "),
  ].join(" "),
  greeting:
    "Hi, welcome! I'm Boss Clinician AI. I can take you to pages in your dashboard and explain what’s on them in simple language, one detail at a time. What would you like help with?",
  firstVisitGreeting:
    "Hi, welcome! I'm Boss Clinician AI. I can take you around the dashboard and explain what’s on each page in simple language, one detail at a time. Would you like me to show you around? You can ask questions or say next or stop anytime.",
  tour: TOUR,
  tools: [
    "admin_operation_catalog",
    "navigate_to",
    "go_back",
    "read_current_page",
    "point_at",
    "stop_pointing",
    "search_site",
    "propose_admin_action",
    "run_approved_action",
    "start_guided_tour",
    "next_tour_stop",
    "end_guided_tour",
  ],
  destinations: DESTINATIONS,
  // Mirrors SURFACE_LIMITS.admin on the server. Half an hour, because a working
  // session in here is a working session — she is walking through the week's
  // numbers, not asking one question.
  maxSessionSeconds: 1800,
  recordAudio: true,
};
