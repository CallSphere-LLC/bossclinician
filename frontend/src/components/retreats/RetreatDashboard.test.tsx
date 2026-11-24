import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Static render (the frontend suite runs in a node environment, see
 * vitest.config.ts): effects never run, so anything that reaches the network
 * would have to happen during render — which is exactly what the preview test
 * guards against.
 */

const mock = vi.hoisted(() => ({
  memberRequest: vi.fn(),
  sessionFetch: vi.fn(),
}));

vi.mock("@/lib/memberApi", () => ({
  memberRequest: mock.memberRequest,
  memberFetch: mock.memberRequest,
  getAccessToken: () => null,
  MemberApiError: class MemberApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));
vi.mock("@/lib/adminTransport", () => ({ sessionFetch: mock.sessionFetch }));
vi.mock("@/lib/api", () => ({ API_BASE: "/api" }));
// The balance plan's card form: Stripe is never loaded or called from a test.
vi.mock("@/components/checkout/stripeClient", () => ({
  getStripe: () => null,
  stripeConfigured: () => true,
  appearanceForTheme: () => ({}),
}));
vi.mock("@stripe/react-stripe-js", () => ({
  Elements: ({ children }: { children: unknown }) => children,
  PaymentElement: () => null,
  useStripe: () => null,
  useElements: () => null,
}));

import { RetreatDashboard } from "./RetreatDashboard";
import type { BalancePlanView, GuestQuestionnaire, RetreatDashboardData } from "@/lib/retreatsApi";

const PROFILE: GuestQuestionnaire = {
  id: 1,
  key: "retreat-profile",
  title: "Retreat Profile",
  dueDate: null,
  version: 1,
  status: "in_progress",
  reviewNote: null,
  definition: {
    intro: "We are so excited to have you join us in Ubud, Bali, June 15–20, 2027!",
    sections: [
      {
        id: "basics",
        title: "THE BASICS",
        description: "",
        questions: [
          { id: "preferred_name", type: "short_text", label: "Preferred Name (Nickname)", help: "", required: true, options: [], showTo: "all", showIf: null },
          { id: "instagram", type: "short_text", label: "Instagram Handle", help: "", required: false, options: [], showTo: "all", showIf: null },
          { id: "diet", type: "multiple_choice", label: "How would you identify your current diet?", help: "Select all that apply.", required: true, options: ["Vegan", "Gluten free"], showTo: "all", showIf: null },
          { id: "shared_room_friend", type: "short_text", label: "If you arranged a shared room with a friend, please enter her full name.", help: "", required: false, options: [], showTo: "shared_room", showIf: null },
          { id: "photo", type: "file", label: "A Photo of You", help: "", required: false, options: [], showTo: "all", showIf: null },
          { id: "photo_share_permission", type: "checkbox", label: "I give permission for my photo to be shared with the other attendees of this retreat.", help: "", required: false, options: [], showTo: "all", showIf: { questionId: "photo", anyOf: [] } },
        ],
      },
    ],
  },
  response: { state: "draft", answers: { preferred_name: "Zz", diet: ["Vegan"] }, revision: 2, updatedAt: "2026-11-20T18:00:00.000Z", submittedAt: null },
  files: [],
};

function fixture(overrides: Partial<RetreatDashboardData> = {}): RetreatDashboardData {
  return {
    preview: false,
    retreat: {
      slug: "bali-2027",
      title: "FlourisHealer Retreats — Bali 2027",
      location: "Ubud, Bali",
      startDate: "2027-06-15",
      endDate: "2027-06-20",
      timezone: "America/Los_Angeles",
      airport: "Ngurah Rai International Airport, Denpasar (DPS)",
      phase: "upcoming",
      daysUntilStart: 205,
    },
    guest: { firstName: "Zz" },
    dashboardTitle: "YOUR RETREAT DASHBOARD",
    welcomeMessage: "Your time to be poured into starts now.",
    supportEmail: "retreats@bossclinician.com",
    checklist: [
      { key: "agreement", label: "Agreement", status: "verified", detail: "", reviewNote: null, updatedAt: null, section: "agreement" },
      { key: "questionnaire:retreat-profile", label: "Retreat Profile", status: "submitted", detail: "", reviewNote: null, updatedAt: null, section: "questionnaire-retreat-profile" },
      { key: "questionnaire:flight-preferences", label: "Flight Preferences", status: "in_progress", detail: "", reviewNote: null, updatedAt: null, section: "questionnaire-flight-preferences" },
      { key: "questionnaire:flight-details", label: "Flight Details", status: "needs_attention", detail: "", reviewNote: "Please add your arrival time.", updatedAt: null, section: "questionnaire-flight-details" },
      { key: "passport", label: "Passport", status: "not_started", detail: "", reviewNote: null, updatedAt: null, section: "passport-preparation" },
    ],
    progress: { completed: 2, total: 6 },
    importantDates: [{ label: "Arrival", date: "2027-06-15", note: "" }],
    agreement: { status: "verified", signedAt: "2026-11-03T18:00:00.000Z", awaitingSignature: false },
    audience: "unknown",
    questionnaires: [PROFILE],
    flightGuidance: { status: "researching", note: "" },
    insurance: { show: true },
    passport: { enabled: true, status: "not_started" },
    details: {
      inclusions: ["Five nights at an Ubud private villa"],
      activities: [],
      transportNote: "",
      shuttle: { confirmed: false, details: "" },
      itineraryMd: "",
    },
    preparationMd: "",
    payments: {
      status: "complete",
      currency: "usd",
      agreedCents: 550000,
      paidCents: 50000,
      balanceCents: 500000,
      arrangement: "",
      nextPayment: { amountCents: 100000, dueDate: "2027-01-05" },
      finalPaymentDue: "2027-06-08",
      installments: [],
      roomLabel: null,
    },
    balancePlan: null,
    groupCall: { enabled: true, confirmed: false, startsAt: null, timezone: null, joinUrl: null, notes: "", rsvp: null },
    announcements: [],
    memories: { available: false, uploadsOpen: false },
    feedback: {
      available: false,
      labels: {
        rating: "Overall retreat experience",
        favoriteMoment: "Favorite moment",
        appreciated: "Appreciated",
        expectations: "Expectations",
        improve: "Improve",
        attendAgain: "Attend again?",
        recommend: "Recommend?",
        testimonialText: "Testimonial",
        testimonialConsent: "May we use it?",
      },
      current: { state: "none", answers: {}, testimonialText: "", testimonialConsent: "no", testimonialRole: "", updatedAt: null, submittedAt: null },
    },
    interest: { available: false, current: { interest: null, destinations: "", marketingOptIn: false, updatedAt: null } },
    joinUsAgain: { available: false, intro: "", cards: [] },
    ...overrides,
  };
}

function render(data: RetreatDashboardData, preview = false) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <RetreatDashboard
        data={data}
        slug="bali-2027"
        preview={preview ? { memories: async () => ({ available: false, uploadsOpen: false, requireReview: true, maxPhotoMb: 20, maxVideoMb: 200, items: [] }) } : undefined}
      />
    </MemoryRouter>,
  );
}

const AUTHORIZATION = "I authorize Boss Clinician to charge my card $1,000.00 each month for 4 payments, starting December 1, 2026.";

/** A guest who paid $1,500.00 through Kajabi and owes $4,000.00 in four monthly payments. */
function balancePlan(overrides: Partial<BalancePlanView> = {}): BalancePlanView {
  return {
    state: "open",
    currency: "usd",
    agreedTotalCents: 550000,
    discountCents: 50000,
    discountNote: "Early booking thank you",
    priorPaidCents: 150000,
    paidHereCents: 0,
    remainingCents: 400000,
    installmentCents: 100000,
    installmentCount: 4,
    schedule: [
      { sequence: 1, amountCents: 100000, dueDate: "2026-12-01", status: "scheduled" },
      { sequence: 2, amountCents: 100000, dueDate: "2027-01-01", status: "scheduled" },
      { sequence: 3, amountCents: 100000, dueDate: "2027-02-01", status: "scheduled" },
      { sequence: 4, amountCents: 100000, dueDate: "2027-03-01", status: "scheduled" },
    ],
    firstChargeDate: "2026-12-01",
    finalDueDate: "2027-05-01",
    chargesToday: false,
    card: null,
    authorizationText: AUTHORIZATION,
    problem: "",
    ...overrides,
  };
}

const STEPPED_AUTHORIZATION =
  "I authorize Boss Clinician to charge the card I am adding for 6 monthly payments toward my balance for FlourisHealer Bali 2027: " +
  "4 payments of $400.00, then 2 payments of $600.00, $2,800.00 in total.";

/**
 * A guest who paid $1,500.00 through Kajabi and owes $2,800.00 as four payments
 * of $400.00 and then two of $600.00, with the first `paid` payments already made.
 */
function steppedBalancePlan(paid = 0, overrides: Partial<BalancePlanView> = {}): BalancePlanView {
  const due = ["2026-12-12", "2027-01-12", "2027-02-12", "2027-03-12", "2027-04-12", "2027-05-12"];
  const paidCents = Math.min(paid, 4) * 40000 + Math.max(0, paid - 4) * 60000;
  return balancePlan({
    agreedTotalCents: 430000,
    discountCents: 0,
    discountNote: "",
    priorPaidCents: 150000,
    paidHereCents: paidCents,
    remainingCents: 280000 - paidCents,
    installmentCents: 40000,
    installmentCount: 6,
    stepUpCents: 60000,
    stepUpCount: 2,
    schedule: due.map((dueDate, index) => ({
      sequence: index + 1,
      amountCents: index < 4 ? 40000 : 60000,
      dueDate,
      status: index < paid ? ("paid" as const) : ("scheduled" as const),
    })),
    firstChargeDate: "2026-12-12",
    finalDueDate: "2027-06-08",
    authorizationText: STEPPED_AUTHORIZATION,
    ...overrides,
  });
}

const VISA = { brand: "visa", last4: "4242" };

/** The words a guest reads: tags removed, the few entities React writes turned back. */
function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Only the Payments section, so nothing from another section can satisfy an assertion. */
function paymentsSection(html: string): string {
  const start = html.indexOf('<section id="payments"');
  const end = html.indexOf("</section>", start);
  expect(start).toBeGreaterThan(-1);
  return html.slice(start, end);
}

/** Kajabi-billed guests have no order on this site, so the old summary would say "contact us". */
function kajabiGuest(plan: BalancePlanView | null, overrides: Partial<RetreatDashboardData> = {}): RetreatDashboardData {
  const data = fixture({ balancePlan: plan, ...overrides });
  data.payments = { ...data.payments, status: "incomplete", agreedCents: null, paidCents: null, balanceCents: null, nextPayment: null };
  return data;
}

beforeEach(() => {
  mock.memberRequest.mockReset();
  mock.sessionFetch.mockReset();
});

describe("RetreatDashboard balance plan", () => {
  it("keeps the old payments summary when there is no balance plan", () => {
    const complete = paymentsSection(render(fixture({ balancePlan: null })));
    expect(complete).toContain("Amount paid");
    expect(complete).toContain("Balance due");
    expect(complete).toContain("$5,500.00");
    expect(complete).not.toContain("Add your card");

    const withoutField = fixture();
    delete withoutField.balancePlan;
    expect(paymentsSection(render(withoutField))).toContain("Balance due");

    const incomplete = paymentsSection(render(kajabiGuest(null)));
    expect(incomplete).toContain("Contact us about your payment schedule");
    expect(incomplete).not.toContain("Add your card");
  });

  it("open: shows the figures, the schedule and an 'Add your card' button instead of 'contact us'", () => {
    const html = paymentsSection(render(kajabiGuest(balancePlan())));
    const text = textOf(html);
    expect(text).not.toContain("Contact us about your payment schedule");
    expect(text).not.toContain("Balance due");

    expect(html).toMatch(/Agreed retreat price<\/dt><dd class="[^"]*font-body font-bold tabular-nums[^"]*">\$5,500\.00</);
    expect(html).toMatch(/Discount \(already included\)<\/dt><dd[^>]*>\$500\.00<\/dd><dd[^>]*>Early booking thank you</);
    expect(html).toMatch(/Paid so far<\/dt><dd[^>]*>\$1,500\.00</);
    expect(html).toMatch(/Balance remaining<\/dt><dd[^>]*>\$4,000\.00</);
    expect(html).toMatch(/Monthly payments<\/dt><dd[^>]*>\$1,000\.00 × 4 payments</);
    expect(html).toMatch(/Final payment deadline<\/dt><dd[^>]*>May 1, 2027</);

    expect(html).toContain("Payment schedule</caption>");
    for (const due of ["December 1, 2026", "January 1, 2027", "February 1, 2027", "March 1, 2027"]) expect(text).toContain(due);
    expect(html.match(/>Scheduled</g)).toHaveLength(4);

    expect(text).toContain("Your first payment of $1,000.00 will be charged on December 1, 2026");
    expect(html).toMatch(/<button[^>]*>Add your card<\/button>/);
    // The card form and its agreement appear only after she asks for them.
    expect(html).not.toContain(AUTHORIZATION);
    expect(html).not.toContain('role="alert"');
    expect(mock.memberRequest).not.toHaveBeenCalled();
  });

  it("open: leaves out the discount line when there is no discount, and says when the first payment is taken today", () => {
    const html = paymentsSection(render(kajabiGuest(balancePlan({ discountCents: 0, discountNote: "", chargesToday: true }))));
    expect(html).not.toContain("Discount");
    expect(textOf(html)).toContain("Your first payment of $1,000.00 is charged today, as soon as you save your card.");
  });

  it("open: shows the last card problem as an alert above the form", () => {
    const html = paymentsSection(render(kajabiGuest(balancePlan({ problem: "Your card was declined. Please add a card again." }))));
    expect(html).toMatch(/role="alert"[^>]*>Your card was declined\. Please add a card again\.</);
    expect(html.indexOf("Your card was declined.")).toBeLessThan(html.indexOf(">Add your card</button>"));
  });

  it("card on file: names the card and the first payment, with no form", () => {
    const html = paymentsSection(render(kajabiGuest(balancePlan({ state: "card_on_file", card: VISA }))));
    const text = textOf(html);
    expect(text).toContain("Card on file: Visa ending 4242. Your first payment of $1,000.00 will be charged on December 1, 2026.");
    expect(html).toContain("Payment schedule</caption>");
    expect(html).toMatch(/Balance remaining<\/dt><dd[^>]*>\$4,000\.00</);
    expect(html).not.toContain("<button");
  });

  it("billing: shows the card, the next payment, paid and scheduled marks, and a link to update the card", () => {
    const plan = balancePlan({ state: "billing", card: VISA, paidHereCents: 100000, remainingCents: 300000 });
    plan.schedule[0] = { ...plan.schedule[0], status: "paid" };
    const html = paymentsSection(render(kajabiGuest(plan)));
    const text = textOf(html);
    expect(text).toContain("Card on file: Visa ending 4242.");
    expect(text).toContain("Your next payment of $1,000.00 will be charged on January 1, 2027.");
    expect(html).toMatch(/Paid so far<\/dt><dd[^>]*>\$2,500\.00</);
    expect(html).toMatch(/Balance remaining<\/dt><dd[^>]*>\$3,000\.00</);
    expect(html.match(/>Paid</g)).toHaveLength(1);
    expect(html.match(/>Scheduled</g)).toHaveLength(3);
    expect(html).toMatch(/<a[^>]*href="\/account\/billing"[^>]*>Update your card<\/a>/);
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain("<button");
  });

  it("past due: alerts that the last payment did not go through, with a button-styled link to update the card", () => {
    const plan = balancePlan({ state: "past_due", card: VISA, paidHereCents: 100000, remainingCents: 300000 });
    plan.schedule[0] = { ...plan.schedule[0], status: "paid" };
    plan.schedule[1] = { ...plan.schedule[1], status: "failed" };
    const html = paymentsSection(render(kajabiGuest(plan)));
    expect(html).toMatch(/role="alert"[^>]*><p>Your last payment did not go through\./);
    expect(html).toMatch(/<a[^>]*href="\/account\/billing"[^>]*>Update your card<\/a>/);
    expect(html).toMatch(/<a(?=[^>]*class="[^"]*bg-gold)(?=[^>]*href="\/account\/billing")[^>]*>Update your card<\/a>/);
    expect(html).toContain(">Did not go through<");
    expect(textOf(html)).toContain("Card on file: Visa ending 4242.");
    expect(textOf(html)).not.toContain("Your next payment of");
  });

  it("completed: thanks her and shows nothing left to pay", () => {
    const plan = balancePlan({ state: "completed", card: VISA, paidHereCents: 400000, remainingCents: 0 });
    plan.schedule = plan.schedule.map((row) => ({ ...row, status: "paid" as const }));
    const html = paymentsSection(render(kajabiGuest(plan)));
    expect(textOf(html)).toContain("Paid in full. Thank you.");
    expect(html).toMatch(/Balance remaining<\/dt><dd[^>]*>\$0\.00</);
    expect(html).toMatch(/Paid so far<\/dt><dd[^>]*>\$5,500\.00</);
    expect(html).not.toContain("Monthly payments");
    expect(html.match(/>Paid</g)).toHaveLength(4);
    expect(html).not.toContain("<button");
  });

  it("open, larger last payments: lists both amounts and names the first row's amount as the first payment", () => {
    const html = paymentsSection(render(kajabiGuest(steppedBalancePlan())));
    const text = textOf(html);
    expect(html).toMatch(/Monthly payments<\/dt><dd[^>]*>4 payments of \$400\.00, then 2 payments of \$600\.00</);
    expect(html).not.toContain("$400.00 ×");
    expect(html).toMatch(/Balance remaining<\/dt><dd[^>]*>\$2,800\.00</);
    expect(html).toMatch(/Final payment deadline<\/dt><dd[^>]*>June 8, 2027</);
    expect(text).toContain("Your first payment of $400.00 will be charged on December 12, 2026");
    expect(text).not.toContain("Your first payment of $600.00");
    // Each row of the schedule carries its own amount.
    expect(html.match(/>\$400\.00<\/td>/g)).toHaveLength(4);
    expect(html.match(/>\$600\.00<\/td>/g)).toHaveLength(2);
    expect(html).toMatch(/<button[^>]*>Add your card<\/button>/);

    const today = textOf(paymentsSection(render(kajabiGuest(steppedBalancePlan(0, { chargesToday: true })))));
    expect(today).toContain("Your first payment of $400.00 is charged today, as soon as you save your card.");
  });

  it("card on file, larger last payments: names the first row's amount", () => {
    const text = textOf(paymentsSection(render(kajabiGuest(steppedBalancePlan(0, { state: "card_on_file", card: VISA })))));
    expect(text).toContain("Card on file: Visa ending 4242. Your first payment of $400.00 will be charged on December 12, 2026.");
    expect(text).toContain("4 payments of $400.00, then 2 payments of $600.00");
  });

  it("billing, larger last payments, 4 of 6 paid: the next payment and the figure show the larger amount", () => {
    const html = paymentsSection(render(kajabiGuest(steppedBalancePlan(4, { state: "billing", card: VISA }))));
    const text = textOf(html);
    expect(text).toContain("Your next payment of $600.00 will be charged on April 12, 2027.");
    expect(text).not.toContain("Your next payment of $400.00");
    expect(html).toMatch(/Monthly payments<\/dt><dd[^>]*>2 payments of \$600\.00</);
    expect(html).not.toContain("$400.00 ×");
    expect(html).toMatch(/Paid so far<\/dt><dd[^>]*>\$3,100\.00</);
    expect(html).toMatch(/Balance remaining<\/dt><dd[^>]*>\$1,200\.00</);
    expect(html.match(/>Paid</g)).toHaveLength(4);
    expect(html.match(/>Scheduled</g)).toHaveLength(2);
  });

  it("billing, larger last payments, 1 of 6 paid: the next payment is still the regular amount", () => {
    const html = paymentsSection(render(kajabiGuest(steppedBalancePlan(1, { state: "billing", card: VISA }))));
    expect(textOf(html)).toContain("Your next payment of $400.00 will be charged on January 12, 2027.");
    expect(html).toMatch(/Monthly payments<\/dt><dd[^>]*>3 payments of \$400\.00, then 2 payments of \$600\.00</);
  });

  it("reads larger last payments from the schedule when an older server sends no step-up fields", () => {
    const plan = steppedBalancePlan();
    delete plan.stepUpCents;
    delete plan.stepUpCount;
    const html = paymentsSection(render(kajabiGuest(plan)));
    expect(html).toMatch(/Monthly payments<\/dt><dd[^>]*>4 payments of \$400\.00, then 2 payments of \$600\.00</);
  });

  it("keeps the figure as it was for a plan whose payments are all the same, step-up fields or not", () => {
    for (const plan of [balancePlan(), balancePlan({ stepUpCents: 0, stepUpCount: 0 })]) {
      const html = paymentsSection(render(kajabiGuest(plan)));
      expect(html).toMatch(/Monthly payments<\/dt><dd[^>]*>\$1,000\.00 × 4 payments</);
      expect(html).not.toContain("payments of");
    }
  });

  it("in the owner's preview shows the plan read-only: no button, no card form, no request", () => {
    const html = paymentsSection(render(kajabiGuest(balancePlan(), { preview: true }), true));
    const text = textOf(html);
    expect(html).toMatch(/Balance remaining<\/dt><dd[^>]*>\$4,000\.00</);
    expect(html).toContain("Payment schedule</caption>");
    expect(text).toContain("Preview only.");
    expect(text).toContain(AUTHORIZATION);
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<form");
    expect(html).not.toContain('type="checkbox"');
    expect(mock.memberRequest).not.toHaveBeenCalled();
    expect(mock.sessionFetch).not.toHaveBeenCalled();
  });

  it("never sets a figure in the display serif or uses an em dash in the plan's own wording", () => {
    for (const state of ["open", "card_on_file", "billing", "past_due", "completed"] as const) {
      const section = paymentsSection(render(kajabiGuest(balancePlan({ state, card: state === "open" ? null : VISA }))));
      // Everything after the section's own (serif) heading.
      const html = section.slice(section.indexOf("</h2>"));
      expect(html).toContain("tabular-nums");
      expect(html).not.toContain("font-display");
      expect(textOf(html)).not.toContain("—");
    }
  });
});

describe("RetreatDashboard", () => {
  it("shows the title, welcome and every checklist status with its label", () => {
    const html = render(fixture());
    expect(html).toContain("YOUR RETREAT DASHBOARD");
    expect(html).toContain("Your time to be poured into starts now.");
    for (const label of ["Verified", "Submitted", "In progress", "Needs attention", "Not started"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("From our team: Please add your arrival time.");
    expect(html).toContain("mailto:retreats@bossclinician.com");
  });

  it("shows the email mismatch FAQ for guests who have retreat dashboard access", () => {
    const html = render(fixture());
    expect(html).toContain("Account Access FAQ");
    expect(html).toContain("I booked with a different email than I use to sign in. What should I do?");
    expect(html).toContain("help verifying your booking and restoring access to your retreat dashboard.");
    expect(html).toContain("mailto:retreats@bossclinician.com");
  });

  it("shows figures from complete payment records in the body font", () => {
    const html = render(fixture());
    expect(html).toContain("$5,500.00");
    expect(html).toContain("June 8, 2027");
  });

  it("shows no money figures when payment records are incomplete", () => {
    const data = fixture();
    data.payments = { ...data.payments, status: "incomplete" };
    const html = render(data);
    expect(html).toContain("Contact us about your payment schedule");
    expect(html).not.toContain("$5,500.00");
    expect(html).not.toContain("Balance due");
    expect(html).not.toContain("Amount paid");
  });

  it("says 'Details coming soon' for the group call and shuttle windows until confirmed", () => {
    const html = render(fixture());
    expect(html).toContain("Pre-trip group call:</span> Details coming soon");
    expect(html).toContain("Shuttle windows:</span> Details coming soon");
    expect(html).not.toContain("to be confirmed");
    expect(html).not.toContain("Join the call");
  });

  it("presents travel insurance as strongly recommended, never required, with no proof fields", () => {
    const html = render(fixture());
    expect(html).toContain("Travel insurance is strongly recommended, but it is not required.");
    expect(html.toLowerCase()).not.toMatch(/insurance (is )?required|required to attend|condition of attend/);
    expect(html).not.toMatch(/Confirmation number|Coverage status|Provider<|Purchase date/);
  });

  it("renders a questionnaire from its definition with her saved answers, save progress and optional fields", () => {
    const html = render(fixture());
    expect(html).toContain("We are so excited to have you join us in Ubud, Bali, June 15–20, 2027!");
    expect(html).toContain('value="Zz"');
    expect(html).toContain("Instagram Handle<span class=\"font-normal text-orchid-dim\"> (optional)</span>");
    expect(html).toMatch(/type="checkbox"[^>]*checked=""[^>]*\/>Vegan/);
    expect(html).toContain("Save progress");
    // The photo-sharing permission appears only once she has a photo.
    expect(html).not.toContain("I give permission for my photo");
    expect(html).not.toContain("Bali mornings");
  });

  it("marks room-specific questions only in the owner's all-questions preview", () => {
    expect(render(fixture())).not.toContain("Shown only to shared-room guests");
    const html = render(fixture({ preview: true, audience: "all" }), true);
    expect(html).toContain("Shown only to shared-room guests");
  });

  it("hides the passport task and group call when the retreat doesn't use them", () => {
    const data = fixture({ passport: { enabled: false, status: "not_started" } });
    data.groupCall = { ...data.groupCall, enabled: false };
    const html = render(data);
    expect(html).not.toContain("I've checked my passport");
    expect(html).not.toContain("Guest Connection &amp; Group Call");
  });

  it("never shows a contract title, month-labelled or otherwise", () => {
    const html = render(fixture({ agreement: { status: "not_started", signedAt: null, awaitingSignature: true } }));
    expect(html).toContain("Review and sign");
    expect(html).not.toMatch(/August 2026|September 2026|Bali Retreat Agreement/);
  });

  it("in preview disables saving and reaches no member endpoint", () => {
    const html = render(fixture({ preview: true, memories: { available: false, uploadsOpen: false } }), true);
    expect(html).toContain("Preview — saving is turned off");
    expect(html).toContain("Hidden from guests until it opens");
    // Every save button is rendered disabled.
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Save progress/);
    expect(mock.memberRequest).not.toHaveBeenCalled();
    expect(mock.sessionFetch).not.toHaveBeenCalled();
  });

  it("hides the post-retreat area from guests until it opens", () => {
    const html = render(fixture());
    expect(html).not.toContain("Retreat Memories");
    expect(html).not.toContain("Your Reflection");
    expect(html).not.toContain("Join Us Again");
  });

  it("preserves the future-retreat signup section when it is enabled", () => {
    const html = render(fixture({ joinUsAgain: { available: true, intro: "Keep in touch", cards: [] } }));
    expect(html).toContain("Join Us Again");
    expect(html).toContain("Keep in touch");
    expect(html).toContain("Keep me posted on future retreats");
  });
});
