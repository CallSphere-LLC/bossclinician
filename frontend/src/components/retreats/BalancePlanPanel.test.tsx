import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Stripe, StripeElements } from "@stripe/stripe-js";

/*
 * Node environment, static render (see RetreatDashboard.test.tsx): no clicks
 * can be fired, so the "save my card" step is tested through the function the
 * form calls, with a stand-in for Stripe and the member API mocked. Nothing
 * here reaches the network.
 */

const mock = vi.hoisted(() => ({
  memberRequest: vi.fn(),
  confirmSetup: vi.fn(),
}));

vi.mock("@/lib/memberApi", () => ({
  memberRequest: mock.memberRequest,
  memberFetch: mock.memberRequest,
  getAccessToken: () => null,
  MemberApiError: class MemberApiError extends Error {
    status: number;
    details?: unknown;
    constructor(message: string, status: number, details?: unknown) {
      super(message);
      this.status = status;
      this.details = details;
    }
  },
}));
vi.mock("@/lib/adminTransport", () => ({ sessionFetch: vi.fn() }));
vi.mock("@/lib/api", () => ({ API_BASE: "/api" }));
vi.mock("@/components/checkout/stripeClient", () => ({
  getStripe: () => null,
  stripeConfigured: () => true,
  appearanceForTheme: () => ({}),
}));
vi.mock("@stripe/react-stripe-js", () => ({
  Elements: ({ children }: { children: unknown }) => children,
  PaymentElement: () => null,
  useStripe: () => ({ confirmSetup: mock.confirmSetup }),
  useElements: () => ({}),
}));

import {
  BalancePlanCardFields,
  balancePlanReturnUrl,
  cardBrandLabel,
  confirmBalancePlanCard,
  setupIntentIdFromSecret,
  submitBalancePlanCard,
} from "./BalancePlanPanel";
import { MemberApiError } from "@/lib/memberApi";
import { memberRetreatsApi, type BalancePlanView } from "@/lib/retreatsApi";

const AUTHORIZATION = "I authorize Boss Clinician to charge my card $1,000.00 each month for 4 payments, starting December 1, 2026.";

function plan(overrides: Partial<BalancePlanView> = {}): BalancePlanView {
  return {
    state: "open",
    currency: "usd",
    agreedTotalCents: 550000,
    discountCents: 0,
    discountNote: "",
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

const RETURN_URL = "https://bossclinician.com/retreats/dashboard/bali-2027/payments";
const CONFIRM_PATH = "/member/retreats/bali-2027/balance-plan/confirm";
const elements = {} as StripeElements;
const stripe = { confirmSetup: mock.confirmSetup } as unknown as Pick<Stripe, "confirmSetup">;

function submit(agreed: boolean, authorizationText: string = AUTHORIZATION) {
  return submitBalancePlanCard({
    agreed,
    stripe,
    elements,
    slug: "bali-2027",
    clientSecret: "seti_123_secret_abc",
    authorizationText,
    returnUrl: RETURN_URL,
  });
}

beforeEach(() => {
  mock.memberRequest.mockReset();
  mock.confirmSetup.mockReset();
});

describe("saving a card for a balance plan", () => {
  it("contacts neither Stripe nor the server until the agreement is ticked", async () => {
    const outcome = await submit(false);
    expect(outcome.kind).toBe("needs_agreement");
    expect(mock.confirmSetup).not.toHaveBeenCalled();
    expect(mock.memberRequest).not.toHaveBeenCalled();
  });

  it("confirms the card with Stripe, then tells the server which SetupIntent succeeded, that she agreed, and the sentence she was shown", async () => {
    mock.confirmSetup.mockResolvedValue({ setupIntent: { id: "seti_123", status: "succeeded" } });
    const saved = plan({ state: "card_on_file", card: { brand: "visa", last4: "4242" } });
    mock.memberRequest.mockResolvedValue({ balancePlan: saved, charged: false });

    const outcome = await submit(true);

    expect(mock.confirmSetup).toHaveBeenCalledTimes(1);
    expect(mock.confirmSetup).toHaveBeenCalledWith({
      elements,
      redirect: "if_required",
      confirmParams: { return_url: RETURN_URL },
    });
    expect(mock.memberRequest).toHaveBeenCalledTimes(1);
    expect(mock.memberRequest).toHaveBeenCalledWith(CONFIRM_PATH, {
      method: "POST",
      body: JSON.stringify({ setupIntentId: "seti_123", agreed: true, authorizationText: AUTHORIZATION }),
    });
    expect(outcome).toEqual({ kind: "confirmed", balancePlan: saved, charged: false });
  });

  it("sends the sentence it was given, word for word, not one from anywhere else", async () => {
    mock.confirmSetup.mockResolvedValue({ setupIntent: { id: "seti_123", status: "succeeded" } });
    mock.memberRequest.mockResolvedValue({ balancePlan: plan({ state: "card_on_file" }), charged: false });
    const shown = "I authorize Boss Clinician to charge the card I am adding for one payment of $4,000.00.";
    await submit(true, shown);
    const sent = JSON.parse((mock.memberRequest.mock.calls[0]?.[1] as { body: string }).body) as { authorizationText: string };
    expect(sent.authorizationText).toBe(shown);
  });

  it("keeps the form for another try when Stripe refuses the card details, without telling the server", async () => {
    mock.confirmSetup.mockResolvedValue({ error: { message: "Your card number is incomplete." } });
    expect(await submit(true)).toEqual({ kind: "card_error", message: "Your card number is incomplete." });
    expect(mock.memberRequest).not.toHaveBeenCalled();
  });

  it("does not tell the server about a SetupIntent that has not succeeded", async () => {
    mock.confirmSetup.mockResolvedValue({ setupIntent: { id: "seti_123", status: "requires_action" } });
    expect((await submit(true)).kind).toBe("card_error");
    expect(mock.memberRequest).not.toHaveBeenCalled();
  });

  it("shows the server's sentence for a declined card (402) and asks for a fresh start", async () => {
    mock.confirmSetup.mockResolvedValue({ setupIntent: { id: "seti_123", status: "succeeded" } });
    mock.memberRequest.mockRejectedValue(new MemberApiError("Your card was declined. Please try another card.", 402));
    expect(await submit(true)).toEqual({ kind: "declined", message: "Your card was declined. Please try another card." });
  });

  it("offers the same SetupIntent again when the server could not be reached", async () => {
    mock.memberRequest.mockRejectedValue(new TypeError("Failed to fetch"));
    const outcome = await confirmBalancePlanCard("bali-2027", "seti_123", AUTHORIZATION);
    expect(outcome.kind).toBe("unfinished");
    expect(outcome).toMatchObject({ setupIntentId: "seti_123", authorizationText: AUTHORIZATION });
    // The browser's own wording never reaches the guest.
    expect(JSON.stringify(outcome)).not.toContain("Failed to fetch");
  });

  it("keeps the same SetupIntent for another try while the bank is still confirming the card (409 setup_pending)", async () => {
    const sentence = "Your bank hasn't finished confirming the card yet. Please try again in a minute.";
    mock.memberRequest.mockRejectedValue(new MemberApiError(sentence, 409, { code: "setup_pending" }));
    expect(await confirmBalancePlanCard("bali-2027", "seti_123", AUTHORIZATION)).toEqual({
      kind: "unfinished",
      message: sentence,
      setupIntentId: "seti_123",
      authorizationText: AUTHORIZATION,
    });
  });

  it("starts again from the new schedule when the one she was shown has changed (409 schedule_changed)", async () => {
    const sentence = "The payment schedule changed while you were adding your card. Please review it and add your card again.";
    mock.memberRequest.mockRejectedValue(new MemberApiError(sentence, 409, { code: "schedule_changed" }));
    expect(await confirmBalancePlanCard("bali-2027", "seti_123", AUTHORIZATION)).toEqual({ kind: "declined", message: sentence });
    // A 409 that names no reason is never taken for "the bank is still checking".
    mock.memberRequest.mockRejectedValue(new MemberApiError("This payment plan has changed. Please refresh the page.", 409));
    expect((await confirmBalancePlanCard("bali-2027", "seti_123", AUTHORIZATION)).kind).toBe("declined");
  });
});

describe("the card fields", () => {
  const noop = () => undefined;
  const render = (view: BalancePlanView) =>
    renderToStaticMarkup(<BalancePlanCardFields plan={view} slug="bali-2027" clientSecret="seti_123_secret_abc" onSettled={noop} onCancel={noop} />);

  it("has a required, unticked checkbox labelled with the server's authorization sentence word for word", () => {
    const html = render(plan());
    expect(html).toMatch(/<input(?=[^>]*type="checkbox")(?=[^>]*required="")[^>]*>/);
    expect(html).not.toMatch(/<input(?=[^>]*type="checkbox")(?=[^>]*checked="")[^>]*>/);
    expect(html).toContain(`<span>${AUTHORIZATION}</span>`);
    expect(html).toMatch(/<label for="([^"]+)"[^>]*><input[^>]*id="\1"/);
  });

  it("says 'Save card' when nothing is charged today", () => {
    const html = render(plan());
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Save card<\/button>/);
    expect(html).not.toContain("Save card and pay");
  });

  it("names the first payment on the button when it is charged today", () => {
    const html = render(plan({ chargesToday: true }));
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Save card and pay \$1,000\.00 now<\/button>/);
  });
});

describe("balance plan helpers and API calls", () => {
  it("reads the SetupIntent id out of a client secret", () => {
    expect(setupIntentIdFromSecret("seti_123_secret_abc")).toBe("seti_123");
    expect(setupIntentIdFromSecret("pi_123_secret_abc")).toBe("");
  });

  it("returns a bank check to the dashboard's payments address", () => {
    expect(balancePlanReturnUrl("https://bossclinician.com", "bali-2027")).toBe(RETURN_URL);
  });

  it("writes card brands as names", () => {
    expect(cardBrandLabel("visa")).toBe("Visa");
    expect(cardBrandLabel("amex")).toBe("American Express");
    expect(cardBrandLabel("")).toBe("Card");
  });

  it("asks the member API for a SetupIntent on the retreat's balance plan", async () => {
    // The answer carries the plan as it stands now; the card form is shown from it.
    const session = { clientSecret: "seti_123_secret_abc", balancePlan: plan() };
    mock.memberRequest.mockResolvedValue(session);
    await expect(memberRetreatsApi.balancePlanSetupIntent("bali-2027")).resolves.toEqual(session);
    expect(mock.memberRequest).toHaveBeenCalledWith("/member/retreats/bali-2027/balance-plan/setup-intent", { method: "POST", body: "{}" });
  });
});
