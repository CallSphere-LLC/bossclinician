import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("./notificationRecipients", () => ({ notificationRecipients: vi.fn() }));

import { notificationRecipients } from "./notificationRecipients";
import {
  MAX_NOTIFY_EMAILS,
  normalizeNotifyEmails,
  notifyEmailsProblem,
  parseNotifyEmails,
  replyRecipients,
  wantsReplyEmail,
} from "./formNotifications";

describe("parseNotifyEmails", () => {
  it("splits on commas, semicolons and spaces, lowercases and de-duplicates", () => {
    expect(parseNotifyEmails(" Yvette@Example.com, team@example.com;yvette@example.com  ops@example.com ")).toEqual({
      emails: ["yvette@example.com", "team@example.com", "ops@example.com"],
      invalid: [],
    });
  });

  it("reports what isn't an address", () => {
    expect(parseNotifyEmails("ok@example.com, not-an-address").invalid).toEqual(["not-an-address"]);
  });

  it("treats blank or missing as no addresses", () => {
    expect(parseNotifyEmails("")).toEqual({ emails: [], invalid: [] });
    expect(parseNotifyEmails(undefined)).toEqual({ emails: [], invalid: [] });
  });
});

describe("notifyEmailsProblem / normalizeNotifyEmails", () => {
  it("accepts blank and a short list", () => {
    expect(notifyEmailsProblem("")).toBeNull();
    expect(notifyEmailsProblem("a@example.com b@example.com")).toBeNull();
    expect(normalizeNotifyEmails("a@example.com;  B@example.com")).toBe("a@example.com, b@example.com");
  });

  it("names the first bad entry", () => {
    expect(notifyEmailsProblem("a@example.com, oops")).toContain("oops");
  });

  it("caps the list", () => {
    const many = Array.from({ length: MAX_NOTIFY_EMAILS + 1 }, (_, i) => `p${i}@example.com`).join(",");
    expect(notifyEmailsProblem(many)).toContain(String(MAX_NOTIFY_EMAILS));
  });
});

describe("wantsReplyEmail", () => {
  it("follows the form's own switch", () => {
    expect(wantsReplyEmail({ notify_on_submit: true, create_lead: false })).toBe(true);
    expect(wantsReplyEmail({ notify_on_submit: false, create_lead: true })).toBe(false);
  });

  it("falls back to create_lead for a row from before the switch existed", () => {
    expect(wantsReplyEmail({ create_lead: true })).toBe(true);
    expect(wantsReplyEmail({ create_lead: false })).toBe(false);
  });
});

describe("replyRecipients", () => {
  beforeEach(() => vi.mocked(notificationRecipients).mockReset());

  it("uses the form's own addresses when it has some, without asking Settings", async () => {
    expect(await replyRecipients({ notify_emails: "a@example.com, b@example.com" })).toBe(
      "a@example.com, b@example.com",
    );
    expect(notificationRecipients).not.toHaveBeenCalled();
  });

  it("falls back to the Settings address under the enquiry switch when blank", async () => {
    vi.mocked(notificationRecipients).mockResolvedValue("owner@example.com");
    expect(await replyRecipients({ notify_emails: "" })).toBe("owner@example.com");
    expect(notificationRecipients).toHaveBeenCalledWith("lead");
  });
});
