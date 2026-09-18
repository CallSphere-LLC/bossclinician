import { beforeEach, describe, expect, it, vi } from "vitest";
import { SendingIdentityError, marketingIdentityProblems } from "./sendingIdentity";

/**
 * E3: a send that did not leave must never be reported as one that did.
 *
 * email/sendingGate.test.ts pins the door itself — a refused marketing send is
 * written to `email_messages` as failed and never reaches the transport. This
 * file pins the layer above it, which is where the old lie lived: the broadcast
 * worker records each recipient in `email_sends` and counts the campaign's
 * `delivered_count`, and those are what the campaign screen reads "Sent." from.
 * A refusal has to land there as `failed`, bump `failed_count`, and be rethrown
 * so the queue cannot mark the job done.
 */

const query = vi.fn();
vi.mock("../db/pool", () => ({ pool: { query: (...args: unknown[]) => query(...args) } }));

const sendEmail = vi.fn();
vi.mock("../email/provider", () => ({
  sendEmail: (...args: unknown[]) => sendEmail(...args),
  renderMarkdown: (text: string) => `<p>${text}</p>`,
  renderTokens: (text: string) => text,
  mergeLinks: () => ({ unsubscribeUrl: "", loginUrl: "", startUrl: "" }),
}));
vi.mock("../jobs/queue", () => ({ PRIORITY: {}, enqueueMany: vi.fn() }));
vi.mock("./audience", () => ({ MAILABLE_CONTACT_SQL: "true" }));
vi.mock("./segments", () => ({ listSegmentContactIds: vi.fn(async () => []) }));

function sql(text: unknown): string {
  return String(text).replace(/\s+/g, " ").trim();
}

beforeEach(() => {
  query.mockReset();
  sendEmail.mockReset();
  query.mockImplementation(async (text: unknown) => {
    const statement = sql(text);
    if (statement.includes("FROM email_sends WHERE id")) {
      return { rows: [{ id: 5, email: "success+reader@simulator.amazonses.com", contact_id: 21, variant: "a", status: "queued" }] };
    }
    if (statement.includes("FROM email_campaigns WHERE id")) {
      return {
        rows: [
          {
            id: 9,
            name: "ZZ",
            subject: "March newsletter",
            subject_b: "",
            ab_split_percent: 0,
            body_md: "Hello",
            plain_text: "",
            audience: "all_subscribers",
            segment_id: null,
            include_tag_ids: [],
            exclude_segment_ids: [],
            exclude_tag_ids: [],
            status: "sending",
            topic: "marketing",
            from_name: "",
            from_email: "",
            scheduled_at: null,
          },
        ],
      };
    }
    if (statement.includes("FROM contacts WHERE id")) return { rows: [{ name: "Reader", first_name: "Reader" }] };
    return { rows: [], rowCount: 1 };
  });
});

describe("sendBroadcastOne when the sending identity refuses the send", () => {
  it("records the recipient as failed with the reason, and never as sent", async () => {
    const { sendBroadcastOne } = await import("./broadcasts");
    const refusal = new SendingIdentityError(
      marketingIdentityProblems({ fromName: "", fromEmail: "", address: "" }),
    );
    sendEmail.mockRejectedValue(refusal);

    await expect(sendBroadcastOne({ campaignId: 9, sendId: 5 })).rejects.toBe(refusal);

    const statements = query.mock.calls.map((call) => ({ text: sql(call[0]), params: call[1] }));

    const failed = statements.find((s) => s.text.startsWith("UPDATE email_sends SET status = 'failed'"));
    expect(failed).toBeDefined();
    expect(String(failed?.params?.[1])).toContain("Sent from, Name in the inbox, Your postal address");

    expect(statements.some((s) => s.text.includes("failed_count = failed_count + 1"))).toBe(true);

    // The two statements that make a campaign read as delivered must not run.
    expect(statements.some((s) => s.text.includes("SET status = 'sent'"))).toBe(false);
    expect(statements.some((s) => s.text.includes("delivered_count = delivered_count + 1"))).toBe(false);
  });

  it("still counts a real send as sent, so the test above is not passing by accident", async () => {
    const { sendBroadcastOne } = await import("./broadcasts");
    sendEmail.mockResolvedValue({ messageId: 26, outcome: "sent", providerMessageId: "0100abc", suppressedReason: "" });

    await expect(sendBroadcastOne({ campaignId: 9, sendId: 5 })).resolves.toEqual({ outcome: "sent" });

    const statements = query.mock.calls.map((call) => sql(call[0]));
    expect(statements.some((s) => s.includes("SET status = 'sent'"))).toBe(true);
    expect(statements.some((s) => s.includes("delivered_count = delivered_count + 1"))).toBe(true);
  });
});
