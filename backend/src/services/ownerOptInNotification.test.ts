import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../email/mailer", () => ({ sendMail: vi.fn() }));
vi.mock("./notificationRecipients", () => ({ notificationRecipients: vi.fn() }));

import { sendMail } from "../email/mailer";
import { notificationRecipients } from "./notificationRecipients";
import { notifyOwnerOfOptIn } from "./ownerOptInNotification";

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("notifyOwnerOfOptIn", () => {
  beforeEach(() => {
    vi.mocked(sendMail).mockReset();
    vi.mocked(notificationRecipients).mockReset();
    vi.mocked(notificationRecipients).mockResolvedValue("owner@example.test");
  });

  it("says who opted in to what, in the subject and the body", async () => {
    notifyOwnerOfOptIn({ what: "Webinar", name: "Jane", email: "jane@example.test", details: [{ label: "Result", value: "Ready" }] });
    await flush();

    const mail = vi.mocked(sendMail).mock.calls[0][0];
    expect(mail.to).toBe("owner@example.test");
    expect(mail.subject).toBe("New opt-in: Webinar - Jane");
    expect(mail.text).toContain("Email: jane@example.test");
    expect(mail.text).toContain("Result: Ready");
    expect(mail.replyTo).toBe("jane@example.test");
  });

  it("uses the address when there is no name, and keeps the subject on one line", async () => {
    notifyOwnerOfOptIn({ what: "Mailing\r\nBcc: x@evil.test", email: "jane@example.test" });
    await flush();
    expect(vi.mocked(sendMail).mock.calls[0][0].subject).toBe("New opt-in: Mailing Bcc: x@evil.test - jane@example.test");
  });

  it("sends nothing when the owner's switch is off", async () => {
    vi.mocked(notificationRecipients).mockResolvedValue("");
    notifyOwnerOfOptIn({ what: "Webinar", email: "jane@example.test" });
    await flush();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("never throws or rejects when the mail cannot go", async () => {
    vi.mocked(sendMail).mockRejectedValue(new Error("smtp down"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => notifyOwnerOfOptIn({ what: "Webinar", email: "jane@example.test" })).not.toThrow();
    await flush();
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});
