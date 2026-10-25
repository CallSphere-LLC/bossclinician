import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.fn();
vi.mock("@aws-sdk/client-sesv2", () => ({
  GetEmailAddressInsightsCommand: class { constructor(readonly input: { EmailAddress: string }) {} },
  SESv2Client: class { send = send; },
}));

beforeEach(() => {
  vi.resetModules();
  send.mockReset();
  process.env.SES_VALIDATION_ENABLED = "true";
  process.env.AWS_ACCESS_KEY_ID = "test-id";
  process.env.AWS_SECRET_ACCESS_KEY = "test-secret";
});
afterEach(() => {
  delete process.env.SES_VALIDATION_ENABLED;
  delete process.env.AWS_ACCESS_KEY_ID;
  delete process.env.AWS_SECRET_ACCESS_KEY;
});

describe("SES address validation", () => {
  it("rejects malformed input before any paid lookup", async () => {
    const { validateCollectedEmail } = await import("./sesValidation");
    expect((await validateCollectedEmail("bad@@example.com")).accepted).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
  it("rejects low-confidence and invalid DNS, including on a fresh submission", async () => {
    send.mockResolvedValueOnce({ MailboxValidation: { IsValid: { ConfidenceVerdict: "LOW" } } });
    const { validateCollectedEmail } = await import("./sesValidation");
    expect((await validateCollectedEmail("typo@example.com")).accepted).toBe(false);
    send.mockResolvedValueOnce({ MailboxValidation: { IsValid: { ConfidenceVerdict: "MEDIUM" }, Evaluations: { HasValidDnsRecords: { ConfidenceVerdict: "LOW" } } } });
    expect((await validateCollectedEmail("x@invalid.example")).accepted).toBe(false);
  });
  it("accepts medium confidence and caches the result", async () => {
    send.mockResolvedValue({ MailboxValidation: { IsValid: { ConfidenceVerdict: "MEDIUM" } } });
    const { validateCollectedEmail } = await import("./sesValidation");
    expect((await validateCollectedEmail("User@Example.com")).accepted).toBe(true);
    expect((await validateCollectedEmail("user@example.com")).checked).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("does not reject a real visitor if SES is unavailable", async () => {
    send.mockRejectedValue(new Error("unavailable"));
    const { validateCollectedEmail } = await import("./sesValidation");
    expect(await validateCollectedEmail("person@example.com")).toMatchObject({ accepted: true, checked: false });
  });
});