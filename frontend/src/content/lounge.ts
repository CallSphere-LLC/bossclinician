import { lounge as legacyLounge } from "./loungeLegacy";
import { LOUNGE_BILLING_LIVE } from "./loungeRelease";

export const loungeMembershipV2Enabled = LOUNGE_BILLING_LIVE;

/** Lounge copy updated from Bugs rows 194–196, 26 October 2026. */
export const LOUNGE_MEMBER_ROUTE = "/checkout/the-lounge";
export const LOUNGE_VIP_ROUTE = "/checkout/the-lounge-vip";

const replacementLounge = {
  seo: {
    title: "The Lounge | Sustainable Private Practice for Therapists",
    description:
      "Ongoing business support, resources, training, and community for established clinicians making their practices more sustainable. Choose monthly or annual membership.",
  },

  hero: {
    banner:
      "Founding Member Pricing · Limited Availability · Keep Your Founding Rate While Your Membership Remains Active",
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
    leadIn: "Not because you're not working hard enough.",
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
        body: "Live 90-minute coaching + Q&A calls for personalized support. Work through income decisions, caseload capacity, systems bottlenecks, time-off planning, boundaries, and the business decisions keeping your practice too dependent on you. Teaching, hot seats, and Q&A are included. Recordings and resources are available in the Replay Vault during active membership.",
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
        body: "Your practice's numbers, all in one place. Track your income by source, your real effective hourly rate, your salary, and your time off, month over month. Plus the built-in Practice Health Assessment: score your practice across five domains when you join, re-score each quarter, and review changes in your practice over time.",
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
        body: "A guided business-planning document you build as you move through the curriculum, so your goals, numbers, operations, and next steps are all in one place. Use it to review your priorities and guide your next steps as your practice evolves.",
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
    title: "Four phases to help you strengthen your practice.",
    body: "The published Practice Elevation curriculum is available when your membership access is granted; it is not released on a drip schedule. Work through the four phases at your own pace. We recommend starting with the practice assessment, reviewing your numbers, identifying your priority, and attending your first Strategy Session.",
    items: [
      {
        letter: "B",
        title: "BUILD: Rebuild the Foundation",
        body: "Get financial clarity. Calculate your real numbers. Step into the CEO seat. Design a practice model built around your income goal and your actual life.",
      },
      {
        letter: "O",
        title: "OPTIMIZE: Make the Model Work Better",
        body: "Strengthen your income model, client mix, rates, payer relationships, and workload so your practice isn't relying on maximum clinical volume to work.",
      },
      {
        letter: "S",
        title: "SYSTEMATIZE: Reduce How Much Depends on You",
        body: "Create the systems, SOPs, automations, and support that keep billing, admin, intake, and day-to-day operations moving without you holding every piece, in the right order.",
      },
      {
        letter: "S",
        title: "SUSTAIN: Build a Practice That Pays You",
        body: "Work toward consistent owner pay, real time off, and a sustainable caseload. Develop a plan that supports your time, health, income goals, and long-term capacity.",
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
      "You are starting or rebuilding your practice foundation. The Club is the better starting point.",
      "Your main problem is getting enough clients. The Lounge is for clinicians who already have the caseload and need to make the practice itself work better.",
      "You are looking for someone to run your marketing, create your content, or manage your social media for you.",
      "You are not willing to look honestly at your numbers, workload, systems, and business decisions.",
      "You want a quick fix without making changes to the way your practice is structured.",
    ],
    clubLink: { label: "See The Club", to: "/club" },
  },

  pricing: {
    "title": "Choose Your Lounge Membership",
    "intro": "Choose monthly membership with a six-month minimum commitment or save with annual membership paid upfront. Both payment options include the benefits of your selected membership tier and our 7-Day Money-Back Guarantee on your initial purchase.",
    "tiers": [
        {
            "id": "member",
            "name": "Lounge Member",
            "tagline": "The curriculum, tools, community, and monthly strategy support to help you build a more sustainable practice.",
            "monthlyPrice": "$197/month",
            "annualPrice": "$1,997 for 12 months",
            "monthlyTerms": "Six-month minimum commitment. Your initial six-month commitment totals $1,182. After six months, membership continues month-to-month unless canceled.",
            "annualTerms": "One upfront payment for 12 months of membership. Save $367 compared with paying $197 monthly for 12 months.",
            "scarcity": "Limited founding-member availability. The monthly rate for new members increases to $247 after founding enrollment closes.",
            "features": [
                "The Practice Elevation signature curriculum: all four modules, video lessons, worksheets, and implementation resources.",
                "Practice assessment and financial audit tools to help identify your priorities.",
                "The Practice Elevation Dashboard to track income, effective hourly rate, and practice health.",
                "A guided Private Practice Business Plan you develop throughout the curriculum.",
                "One monthly 90-minute live Strategy Session with Yvette, including teaching, hot seats, and Q&A.",
                "The Boss Clinician Toolkit with templates, trackers, swipe files, and workbooks.",
                "Private Lounge community access.",
                "The Replay Vault with recordings and resources available during your active membership.",
                "Access to live Lounge challenges throughout the year.",
                "An annual community business-plan review."
            ],
            "cta": "JOIN THE LOUNGE"
        },
        {
            "id": "vip",
            "name": "Lounge VIP",
            "tagline": "Everything in Lounge Member, plus personalized feedback and private strategy support for your practice.",
            "monthlyPrice": "$347/month",
            "annualPrice": "$3,497 for 12 months",
            "monthlyTerms": "Six-month minimum commitment. Your initial six-month commitment totals $2,082. After six months, membership continues month-to-month unless canceled.",
            "annualTerms": "One upfront payment for 12 months of VIP membership. Save $667 compared with paying $347 monthly for 12 months.",
            "scarcity": "Four founding VIP seats are available at this rate.",
            "features": [
                "Everything in Lounge Member, plus personalized feedback and private strategy support.",
                "Private Strategy Calls: three private 30-minute calls with Yvette during your first six months.",
                "Kickoff Call: review your practice snapshot, clarify priorities, and identify your first steps.",
                "90-Day Momentum Review: evaluate progress, work through barriers, and adjust your plan.",
                "6-Month Elevation Review: review results and map your next six months.",
                "After your first six months, receive one additional private 30-minute Strategic Review every six months while your VIP membership remains continuously active: around month twelve, then months eighteen, twenty-four, and so on.",
                "The same call schedule applies to monthly and annual VIP memberships. Calls are scheduled within their designated milestone windows and do not accumulate or roll over. The initial three-call series does not restart with renewal.",
                "Monthly Personalized Voice-Note Support: submit one practice-related question each month and receive a personalized voice-note response from Yvette.",
                "Monthly Recorded Materials Review: submit one item each month, such as a professional profile, pricing document, or website copy, and receive recorded feedback with practical recommendations.",
                "Quarterly Priority Hot Seat: one guaranteed hot seat per quarter during a monthly group Strategy Session.",
                "Additional VIP Access: early access to new modules and resources before general release, plus a private VIP submission portal."
            ],
            "cta": "JOIN AS A VIP"
        }
    ],
    "commitment": "Meaningful practice changes take time to implement, evaluate, and refine. Choose monthly membership with a six-month minimum commitment or annual membership with 12 months paid upfront.",
    "foundingRate": "Your founding rate stays the same while you maintain continuous membership on your selected plan. If you cancel and later rejoin, the pricing available at that time will apply.",
    "annualRenewal": "Your annual membership does not automatically renew. Access ends after twelve months unless you renew. 7-Day Money-Back Guarantee: email support@bossclinician.com within seven calendar days of your initial payment, by 11:59 p.m. Pacific Time, for a full refund; an approved refund ends your enrollment and future payments."
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
      { q: "What is the 7-day money-back guarantee?", a: "Your initial paid purchase carries a full refund if you email support@bossclinician.com within seven calendar days of your first payment, by 11:59 p.m. Pacific Time, whether or not you have viewed or downloaded resources. It is a paid purchase, not a free trial, and it does not restart on renewals. An approved refund ends your enrollment and any future payments." },
      {
        "q": "What is the membership commitment?",
        "a": "Monthly membership begins with a six-month minimum commitment. After those six months, your membership continues month-to-month unless canceled. Annual membership includes 12 months of access paid upfront and does not automatically renew."
},
      {
        "q": "How do I cancel my monthly membership?",
        "a": "After the 7-day guarantee period, your 6-month minimum commitment remains in effect. Cancelling during the initial commitment does not cancel the remaining required payments, subject to applicable law. After the initial 6 months, your membership continues month-to-month and may be canceled before your next billing date. Charges already processed are non-refundable. To request cancellation, email support@bossclinician.com before your next billing date, or use Account > Billing. Access continues through your cancellation date."
},
      {
        "q": "Does annual membership include the same benefits?",
        "a": "Yes. Annual membership includes the same benefits as monthly membership for your selected tier, with a discount for paying for 12 months upfront. Annual VIP members follow the same private-call schedule as monthly VIP members."
},
      {
        "q": "What happens after I complete the four modules?",
        "a": "Your support continues throughout your active membership. Use the monthly Strategy Sessions, community, tools, and resources to keep implementing and refining your practice. As your goals, income needs, and capacity change, revisit the curriculum, update your dashboard, and adjust your business plan."
},
      {
        "q": "Do I keep access after my membership ends?",
        "a": "Access to the curriculum, community, Replay Vault, live sessions, and ongoing membership benefits is available while your membership is active. Membership does not include lifetime access."
},
      {
        "q": "Do the VIP private calls repeat?",
        "a": "Your first six months include three private 30-minute calls: a Kickoff Call, a 90-Day Momentum Review, and a 6-Month Elevation Review. After that, you receive one additional private 30-minute Strategic Review every six months while your VIP membership remains continuously active. The initial three-call series does not restart with renewal."
},
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
        q: "Do I have to stop taking insurance?",
        a: "No. The Lounge is not built around one specific payer model. You'll evaluate your rates, insurance panels, private-pay options, platforms, and client mix based on what actually supports your practice.",
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
    vipNote: "Four founding VIP seats are available at this rate.",
    contact: "Got questions? Unsure? Reach out:",
    email: "support@bossclinician.com",
  },
};

// Keep the incumbent sales page intact until billing, policy, and sandbox QA
// are approved together. The build flag is deliberately off by default.
export const lounge = loungeMembershipV2Enabled
  ? { ...replacementLounge, pricing: { ...replacementLounge.pricing, tiers: replacementLounge.pricing.tiers.map((tier, index) => ({ ...legacyLounge.pricing.tiers[index], ...tier })) } }
  : { ...legacyLounge, pricing: { ...replacementLounge.pricing, ...legacyLounge.pricing, tiers: legacyLounge.pricing.tiers.map((tier, index) => ({ ...replacementLounge.pricing.tiers[index], ...tier })) } };
