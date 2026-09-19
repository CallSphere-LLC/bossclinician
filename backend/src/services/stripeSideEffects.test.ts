import { beforeEach, describe, expect, it, vi } from "vitest";
import { stripeTestMode } from "../config/env";
import { sendMail } from "../email/mailer";
import { sendStripeMail } from "./stripeSideEffects";

vi.mock("../config/env", () => ({ stripeTestMode: vi.fn() }));
vi.mock("../email/mailer", () => ({ sendMail: vi.fn() }));

describe("Stripe billing side effects", () => {
  beforeEach(() => vi.resetAllMocks());
  it("never sends mail from sandbox billing", async () => {
    vi.mocked(stripeTestMode).mockReturnValue(true);
    expect((await sendStripeMail({ to: "buyer@example.test", subject: "Plan complete", text: "Paid" })).sent).toBe(false);
    expect(sendMail).not.toHaveBeenCalled();
  });
  it("preserves real billing delivery", async () => {
    vi.mocked(stripeTestMode).mockReturnValue(false);
    const mail = { to: "buyer@example.test", subject: "Plan complete", text: "Paid" };
    vi.mocked(sendMail).mockResolvedValue({ messageId: 1, sent: true, providerMessageId: "provider", error: "" });
    expect((await sendStripeMail(mail)).sent).toBe(true);
    expect(sendMail).toHaveBeenCalledWith(mail);
  });
});
