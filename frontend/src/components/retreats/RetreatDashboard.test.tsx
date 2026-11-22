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
import type { RetreatDashboardData } from "@/lib/retreatsApi";

function fixture(overrides: Partial<RetreatDashboardData> = {}): RetreatDashboardData {
  const empty = { state: "none" as const, data: {}, updatedAt: null, submittedAt: null, revision: 0 };
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
      { key: "guest_profile", label: "Guest Profile", status: "submitted", detail: "", reviewNote: null, updatedAt: null, section: "guest-profile" },
      { key: "flight_preferences", label: "Flight Preferences", status: "in_progress", detail: "", reviewNote: null, updatedAt: null, section: "travel-flights" },
      { key: "travel_insurance", label: "Travel Insurance", status: "needs_attention", detail: "", reviewNote: "Please add your provider.", updatedAt: null, section: "travel-insurance" },
      { key: "flight_details", label: "Flight Details", status: "not_started", detail: "", reviewNote: null, updatedAt: null, section: "travel-flights" },
    ],
    progress: { completed: 1, total: 8 },
    importantDates: [{ label: "Arrival", date: "2027-06-15", note: "" }],
    agreement: { status: "verified", signedAt: "2026-11-03T18:00:00.000Z", awaitingSignature: false },
    guestProfile: { url: "https://form.jotform.com/262158194471057", status: "submitted" },
    flightTracker: { url: "https://form.jotform.com/262157915507057", status: "not_started" },
    flightPreferences: empty,
    flightGuidance: { status: "researching", note: "" },
    travelInsurance: empty,
    passport: { status: "not_started" },
    details: { inclusions: ["Five nights at an Ubud private villa"], transportNote: "", shuttle: { confirmed: false, details: "" }, itineraryMd: "" },
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
    groupCall: { confirmed: false, startsAt: null, timezone: null, joinUrl: null, notes: "", rsvp: null },
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
    expect(html).toContain("From our team: Please add your provider.");
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

  it("says the group call and pickup windows are to be confirmed until confirmed", () => {
    const html = render(fixture());
    expect(html).toContain("Pre-trip group call: to be confirmed");
    expect(html).toContain("Pickup windows: to be confirmed");
    expect(html).not.toContain("Join the call");
  });

  it("never presents travel insurance as required", () => {
    const html = render(fixture());
    expect(html).toContain("Airfare and travel insurance are not included.");
    expect(html.toLowerCase()).not.toMatch(/insurance (is )?required|required to attend|condition of attend/);
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
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Save &amp; Finish Later/);
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
