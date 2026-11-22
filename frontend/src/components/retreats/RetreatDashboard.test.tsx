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

import { RetreatDashboard } from "./RetreatDashboard";
import type { GuestQuestionnaire, RetreatDashboardData } from "@/lib/retreatsApi";

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

beforeEach(() => {
  mock.memberRequest.mockReset();
  mock.sessionFetch.mockReset();
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
});
