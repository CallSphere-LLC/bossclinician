/**
 * The Boss Clinician Lounge — sales page copy.
 *
 * Transcribed from bossclinician.com/lounge (18 September 2026), section by
 * section and in the page's own order. Prices, founding-seat terms, the
 * commitment note and the CEU wording are the published text — nothing here is
 * paraphrased, rounded or invented. The source page's image-only blocks (module
 * mock-ups with no text) have no counterpart here.
 */

/**
 * Where the two "Join" buttons go.
 *
 * On the source they open Kajabi checkouts (/resource_redirect/offers/5RwMdHLj
 * for Member, /resource_redirect/offers/awvKo5oi for VIP). Neither offer exists
 * in this app yet, so both go to the application form. When the offers are
 * published in the admin, point each constant at `/checkout/<offer-slug>`;
 * migration 064 already redirects both Kajabi paths to this page.
 */
export const LOUNGE_MEMBER_ROUTE = "/apply";
export const LOUNGE_VIP_ROUTE = "/apply";

export const lounge = {
  seo: {
    title: "The Lounge | Sustainable Private Practice for Therapists",
    description:
      "A private-practice membership for established therapists ready to reduce caseload pressure, strengthen income, improve systems, and build a practice that supports their life and future.",
  },

  hero: {
    banner:
      "Founding Member pricing · Limited seats, then rates rise · Lock in your rate for life",
    title: "Your practice is working.",
    titleAccent: "But can you keep working like this?",
    lede: [
      "Build a private practice that supports your income, energy, and future — without seeing 25–30+ clients forever.",
      "Take real time off. Reduce the pressure to stay clinically maxed out. Build systems that don’t depend on you for everything. And make sure your income can support the life you actually want.",
    ],
    cta: "JOIN THE LOUNGE",
  },

  fact: {
    title:
      "FACT: You can have a full caseload and still feel financially stretched, exhausted, and too dependent on your own clinical hours to keep the practice running.",
    leadIn: "Not because you're not working hard enough....",
    lead: "Because no one taught you how to run the business underneath the clinical work.",
    paragraphs: [
      "Right now, you've been thinking you need to create an ebook, launch a course, invest in another certification or become a coach in order to have sustainable income in your private practice.",
      "The answer may not be another business.",
      "It may be redesigning the one you already built.",
      "Rates matter. Systems matter. Client mix matters. Time off matters. Owner behavior matters. And all of those pieces have to work together if this practice is going to support you long-term.",
    ],
    closing: "BEFORE YOU ADD SOMETHING NEW, FIX THE MODEL FIRST.",
  },

  goodNews: {
    eyebrow: "The good news?",
    title: "Getting booked was one challenge. Building a practice you can actually sustain is another.",
    paragraphs: [
      "You already proved you can build demand. Now the work is making sure the business underneath that demand supports your income, your capacity, and the life you want long-term.",
      "What you may be missing is a closer look at the model underneath the caseload: your rates, insurance relationships, systems, income sources, and how much of the business still depends on your own clinical output.",
      "Whether that means negotiating higher reimbursement from the panels you keep, reducing the ones that underpay you, building more private-pay business, improving systems, reducing your caseload, or delegating more, the goal is to help you identify the move that makes the most sense for your practice.",
    ],
    closing:
      "This is not a get-off-insurance program. It’s a build-a-practice-that-works-for-you program.",
  },

  possible: {
    title: "Here's what becomes possible",
    paragraphs: [
      "Right now, your practice may be full — but still require too much of you to keep working. You may be making decisions from fear instead of data, staying clinically maxed out because your income depends on it, and carrying systems that stop the moment you step away.",
      "The goal is to build a practice that supports your income, your energy, and the life you want long-term.",
    ],
    items: [
      "Know what your practice is actually producing across every income source — so you can make decisions based on real numbers, not fear.",
      "Create income that doesn’t require you to stay at your maximum caseload just to feel financially secure.",
      "Make confident decisions about your rates, insurance panels, platforms, and client mix based on what actually supports your practice.",
      "Build systems that keep the administrative side of your practice moving — even when you step away.",
      "Build a practice that pays you consistently and gives you room to take real time off without everything falling apart.",
      "Create a business model and plan that can evolve as your life, capacity, and career change.",
    ],
    cta: "I’M READY TO BUILD DIFFERENTLY",
  },

  looksLike: {
    title: "Maybe This Is What It Actually Looks Like",
    body: "Taking client calls and doing billing from your vacation. Being underpaid by 20 different insurance companies, each with its own portal, its own rules, and its own way of paying you less. Scrolling job listings on Indeed at 11pm wondering if going back to a W2 would honestly be easier. Doing the math on how many more sessions you'd have to add to feel a difference, and realizing there are no more hours to give.",
    closing:
      "You are not imagining it. The model you're running may have been built to keep you booked — not to support your life long-term.",
  },

  stepInto: {
    eyebrow: "step into...",
    title: "The Lounge",
    lead: "A structured membership for established clinicians who have built the caseload — and are ready to make the practice itself more sustainable.",
    body: "For the therapist or psychiatric nurse practitioner who wants stronger income, a lighter clinical load, better systems, and more options for the future.",
    cta: "LET'S ELEVATE MY PRACTICE",
    curriculumEyebrow: "The Practice Elevation",
    curriculumTitle:
      "The step-by-step curriculum for making the practice you already built more sustainable.",
    curriculumBody:
      "Diagnose what is creating the most pressure in your current model, make smarter decisions about income and capacity, build better systems, and create a practice that can evolve with your life and career.",
  },

  inside: {
    title: "What You Get Inside The Lounge",
    items: [
      {
        title: "Monthly Lounge Strategy Sessions with Yvette",
        body: "Live 90-minute coaching + Q&A calls for personalized support. Work through income decisions, caseload capacity, systems bottlenecks, time-off planning, boundaries, and the business decisions keeping your practice too dependent on you. Hot seats included, replays always posted.",
      },
      {
        title: "The Practice Elevation Signature Curriculum",
        body: "Your complete four-module course built on the B.O.S.S Blueprint. Audit how your current practice is actually working, strengthen your income model, reduce unnecessary dependence on your clinical hours, build systems that support you, and create a plan for the next season of your practice. Start with the Practice Reset Snapshot to find your exact starting point. The goal is not simply to earn more. It is to reduce how much the practice depends on your maximum output.",
      },
      {
        title: "The Boss Clinician Toolkit",
        body: "Over 20+ plug-and-play workbooks, swipe files, and trackers: rate increase email templates, the Insurance Panel Audit Tracker, the Platform Exit Roadmap, SOP templates, the PTO income calculator, and more. Less guesswork, more structure.",
      },
      {
        title: "The Practice Elevation Dashboard",
        body: "Your practice's numbers, all in one place. Track your income by source, your real effective hourly rate, your salary, and your time off, month over month. Plus the built-in Practice Health Assessment: score your practice across five domains when you join, re-score each quarter, and watch your transformation in actual numbers, not vibes.",
      },
      {
        title: "The Lounge Community",
        body: "Surround yourself with clinicians who understand what it means to have a practice that looks successful on paper but still requires too much of you. Ask questions, post your wins, get feedback, and swap referrals in a space built for your growth circle.",
      },
      {
        title: "The Replay Vault",
        body: "A growing library of past kits, recorded coaching calls, and bonus trainings — all saved and ready when you are. No pressure to keep up, just plug in when you need it. The longer you stay, the more value you unlock.",
      },
      {
        title: "The Private Practice Business Plan",
        body: "A guided business-planning document you build as you move through the curriculum, so your goals, numbers, operations, and next steps are all in one place. By the end of Module 04, you hold a complete document you can hand to a bank, a grant committee, or your own annual review..",
      },
      {
        title: "Live Challenge Access",
        body: "Members get free access to live Lounge challenges throughout the year. Focused sprints designed to help you implement faster, together.",
      },
    ],
  },

  different: {
    title: "This is not like what you've tried before.",
    paragraphs: [
      "Most therapist business programs are designed to help you start the practice, choose a niche, market yourself, and fill your caseload.",
      "But what happens after it works?",
      "What happens when you're booked, your income depends on maintaining that pace, taking time off feels expensive, and too much of the business still depends on you?",
    ],
    pivot: "The Lounge starts there",
    after: [
      "This isn't about adding more clients. It's about redesigning the practice you already built so it can support your income, your energy, and your future.",
      "And unlike another course you finish and forget, the Lounge gives you a curriculum, live strategy support, tools, and a community to help you actually implement the changes.",
    ],
  },

  phases: {
    eyebrow: "Go All-In with The Lounge",
    title: "Four phases. One rebuilt practice.",
    body: "The curriculum is sequential because the work builds in order. You cannot optimize a model you haven't measured. You cannot sustain a practice you haven't systematized. Every phase unlocks the next one.",
    items: [
      {
        letter: "B",
        title: "BUILD: Rebuild the Foundation",
        body: "Get financial clarity. Calculate your real numbers. Step into the CEO seat. Design a practice model built around your income goal and your actual life.",
      },
      {
        letter: "O",
        title: "OPTIMIZE: Make the Model Work Better",
        body: "Strengthen your income model, client mix, rates, payer relationships, and workload so your practice isn't relying on maximum clinical volume to work..",
      },
      {
        letter: "S",
        title: "SYSTEMATIZE: Reduce How Much Depends on You",
        body: "Create the systems, SOPs, automations, and support that keep billing, admin, intake, and day-to-day operations moving without you holding every piece, in the right order.",
      },
      {
        letter: "S",
        title: "SUSTAIN: Build a Practice That Pays You",
        body: "Pay yourself consistently. Take real time off. Reduce your caseload without losing income. Build the practice that protects your time, your health, and your long-term capacity.",
      },
    ],
    cta: "I'M READY TO HAVE FREEDOM",
  },

  evolves: {
    title: "Your practice will keep changing. The Lounge changes with you.",
    paragraphs: [
      "The Practice Elevation curriculum gives you the foundation, but sustainability isn't a one-time project. You return.",
      "As your rates, capacity, goals, family, and career change, you'll revisit your numbers, reassess your practice health, update your business plan, and decide what needs to change next.",
      "That's why the Lounge doesn't end when you finish the curriculum. The same framework looks different when your practice does.",
    ],
  },

  fit: {
    title: "Who the Lounge is built for",
    forTitle: "This is for you if...",
    forItems: [
      "You are a licensed therapist or psychiatric nurse practitioner who has been in private practice long enough to know the business is working — but not necessarily working for you.",
      "Your caseload is full or nearly full, and you are seeing more clients than you want to maintain long-term.",
      "Your income still depends heavily on keeping your clinical volume high, making it hard to reduce your schedule or take meaningful time off.",
      "You are still carrying too much of the business yourself — billing, admin, scheduling, decisions, or day-to-day problem solving.",
      "You are questioning whether your current practice model can support the next season of your life, energy, or career.",
      "You may be on insurance panels, platforms, or referral sources that no longer feel aligned with the practice you are trying to build.",
      "You are ready to make structural changes to your practice — not just keep adding more to it.",
    ],
    notTitle: "This is not for you if...",
    notItems: [
      "You are newly licensed or still building your first caseload. The Club is the better starting point.",
      "Your main problem is getting enough clients. The Lounge is for clinicians who already have the caseload and need to make the practice itself work better..",
      "You are looking for someone to run your marketing, create your content, or manage your social media for you.",
      "You are not willing to look honestly at your numbers, workload, systems, and business decisions.",
      "You want a quick fix without making changes to the way your practice is structured.",
    ],
    clubLink: { label: "See The Club", to: "/club" },
  },

  pricing: {
    title: "Choose your path into the Lounge",
    tiers: [
      {
        id: "member",
        name: "Lounge Member",
        tagline: "",
        price: "$197/mo",
        terms: "Founding rate · 6-month commitment · or $1,997/year (save $367)",
        scarcity: "Limited founding seats. When they fill, the monthly rate rises to $247.",
        features: [
          "The Practice Elevation: all four modules, video lessons, worksheets, swipe files, and templates",
          "Current Model Audit Worksheet: your financial foundation for every decision in the Lounge",
          "The Practice Elevation Dashboard: your monthly numbers, effective hourly rate, and quarterly Practice Health Assessment in one tracker",
          "Private Practice Business Plan (fillable) built section by section through the curriculum",
          "Monthly 90-minute live Strategy Session with Yvette: teaching, hot seats, open Q&A",
          "Live challenge access throughout the year",
          "Private Lounge community with phase-organized channels",
          "All linked courses and resources inside the curriculum",
          "Annual business plan review, done together inside the community every year",
        ],
        cta: "JOIN THE LOUNGE",
      },
      {
        id: "vip",
        name: "★ Lounge VIP",
        tagline: "The Lounge teaches you how to fix your practice. VIP puts my eyes on yours.",
        price: "$347/mo",
        terms: "Founding VIP rate · 6-month commitment · or $3,497/year (save $667)",
        scarcity: "Four founding VIP seats at this rate. Then $447.",
        features: [
          "Everything in Lounge Member",
          "The VIP Strategy Call Series: three private 30-minute calls with Yvette. A Kickoff Call when you join, a 90-Day Momentum Call, and a 6-Month Elevation Review. Your dashboard is our shared screen, so every call starts with your real numbers",
          "My personal answer to your question, every month, in a voice note",
          "My eyes on your actual materials every month: your profile, your pricing, your website copy, with recorded feedback on your stuff, not generic examples. One submission, one thorough recorded review, every month.",
          "Priority hot seat: guaranteed one hot seat per quarter on the monthly call",
          "Early access to new modules and resources before general release",
          "Private VIP submission portal",
        ],
        cta: "JOIN AS A VIP",
      },
    ],
    commitment:
      "*Meaningful practice changes take time to implement, evaluate, and refine. That's why the Lounge begins with a 6-month commitment.",
  },

  founder: {
    title: "Hey, I’m Yvette Howard, LCSW",
    paragraphs: [
      "I'm a therapist, group-practice owner, clinical supervisor, and founder of Boss Clinician.",
      "I built the kind of practice I thought would give me freedom — a full caseload, a growing team, and eventually more than $500,000 in annual revenue.",
      "But the year my practice reached its highest revenue was also the year I seriously questioned whether I wanted the business anymore.",
      "The number didn't save me, because the structure underneath it still required too much of me.",
      "I had spent years trying to solve that problem by doing more: more platforms, more programs, more certifications, more ideas.",
      "Eventually I realized I didn't necessarily need another business.",
      "I needed to build the one I already had differently.",
      "That's why I created The Lounge: to help established clinicians redesign the practice they already built so it can support their income, energy, life, and future.",
    ],
    signature: "Yvette",
  },

  faq: {
    eyebrow: "FAQs",
    title: "Frequently asked questions",
    items: [
      {
        q: "How much time does this take each month?",
        a: "Plan for 2 to 3 hours per month minimum: the monthly strategy session plus one module lesson and its worksheet. And here is the part that matters if you're already stretched thin: there is no falling behind in the Lounge. The curriculum is not a cohort racing ahead of you. It's a pathway you move through at your pace, and the monthly call meets you wherever you are. Members who get the most out of the Lounge show up consistently, not intensively. One lesson, applied to your real practice, beats five lessons watched at midnight.",
      },
      {
        q: "Are CEUs included?",
        a: "Select trainings linked inside the curriculum carry NBCC-approved continuing education hours, and they're marked inside the Lounge. Yvette is an NBCC-approved continuing education provider. The full membership is professional development for your practice; the CEU-bearing trainings are a bonus layer on top of it.",
      },
      {
        q: "Is this a business expense / tax deductible?",
        a: "Business education and professional development may be deductible as a business expense depending on your circumstances. Please check with your tax professional.",
      },
      {
        q: "What if I've already taken a course or done 1:1 coaching?",
        a: "The Lounge is designed to support you after that work, with the ongoing structure, curriculum, and community to implement and maintain what you've learned. A course gives you knowledge. The Lounge gives you the accountability, the coaching, and the community to make it stick month after month and year after year.",
      },
      {
        q: "What happens after I complete the four modules?",
        a: "You stay. Business development doesn't end when the curriculum ends. Your practice keeps evolving and the Lounge keeps pace with it. You return to the same modules with a more developed practice and they hit differently every time. Your business plan gets updated every January. Your community relationships deepen. The monthly call keeps a strategist in your corner without 1:1 coaching rates.",
      },
      {
        q: "Do I have to stop taking insurance?",
        a: "No. The Lounge is not built around one specific payer model. You'll evaluate your rates, insurance panels, private-pay options, platforms, and client mix based on what actually supports your practice.",
      },
      {
        q: "Can I cancel?",
        a: "The Lounge runs on a 6-month commitment, monthly or annual. We want you here because you're getting results, not because you're locked in. But the work is sequential and builds over time, and the members who get the most are the ones who stay long enough to do the full cycle. Not sure it's the right fit? Book a consult call before you join and we'll figure it out together.",
      },
    ],
    cta: "STEP INTO THE LOUNGE",
  },

  closing: {
    title: "You built the practice.",
    titleAccent: "Now build one you can actually stay in.",
    paragraphs: [
      "You don’t need more clients. You need the practice you already built to support your income, energy, life, and future — consistently, sustainably, and on your terms.",
      "The Lounge is where that work happens. In sequence. With a strategist, a community, and a structured curriculum that stays relevant as long as your practice keeps growing.",
    ],
    memberNote: "Founding rate. Limited seats, then the monthly rate rises to $247.",
    vipNote: "Four founding seats at this rate. When they fill, VIP opens a waitlist.",
    contact: "Got questions? Unsure? Reach out:",
    email: "support@bossclinician.com",
  },
};
