import { beforeEach, describe, expect, it, vi } from "vitest";

const { query, sendEmail, upsertContact } = vi.hoisted(() => ({
  query: vi.fn(),
  sendEmail: vi.fn(),
  upsertContact: vi.fn(),
}));

vi.mock("../db/pool", () => ({ pool: { query } }));
vi.mock("../email/provider", () => ({
  sendEmail,
  renderMarkdown: (body: string) => `<p>${body}</p>`,
}));
vi.mock("./audience", () => ({ MAILABLE_CONTACT_SQL: "c.mailable" }));
vi.mock("./contacts", () => ({ upsertContact }));

import { sendIssueNow, sendScheduledIssues } from "./newsletters";

function issue(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    status: "scheduled",
    subject: "ZZ Issue",
    body_md: "Hello",
    access: "free",
    plan_id: null,
    ...overrides,
  };
}

/** What the fake database holds; each test arranges it and the mock reads it. */
let state: {
  due: number[];
  issues: Record<number, ReturnType<typeof issue>>;
  list: string[];
  claimable: boolean;
  audienceFails: boolean;
};

beforeEach(() => {
  state = { due: [], issues: {}, list: [], claimable: true, audienceFails: false };
  query.mockReset();
  query.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("FOR UPDATE SKIP LOCKED")) return { rows: state.due.map((id) => ({ id })) };
    if (sql.includes("JOIN newsletters n")) {
      const found = state.issues[Number(params[0])];
      return { rows: found ? [found] : [] };
    }
    if (sql.includes("FROM contacts c") || sql.includes("FROM subscriptions s")) {
      if (state.audienceFails) throw new Error("connection lost");
      return { rows: state.list.map((email) => ({ email })) };
    }
    if (sql.includes("AND status <> 'sent'")) return { rows: [], rowCount: state.claimable ? 1 : 0 };
    return { rows: [], rowCount: 1 };
  });
  sendEmail.mockReset();
  sendEmail.mockResolvedValue({ outcome: "sent" });
  upsertContact.mockReset();
  upsertContact.mockResolvedValue(7);
});

const statements = () => query.mock.calls.map(([sql]) => String(sql));

describe("sendScheduledIssues", () => {
  it("does nothing when no issue is due", async () => {
    await expect(sendScheduledIssues()).resolves.toEqual({ issues: 0, sent: 0 });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("only claims issues that are scheduled and due, skipping rows another worker holds", async () => {
    await sendScheduledIssues();
    const claim = statements()[0];
    expect(claim).toContain("i.status = 'scheduled'");
    expect(claim).toContain("i.scheduled_at <= now()");
    expect(claim).toContain("FOR UPDATE SKIP LOCKED");
    expect(claim).toContain("SET status = 'sent'");
  });

  it("mails a claimed issue to the list and records how many it went to", async () => {
    state.due = [4];
    state.issues[4] = issue(4);
    state.list = ["zz-one@example.test", "zz-two@example.test"];

    await expect(sendScheduledIssues()).resolves.toEqual({ issues: 1, sent: 2 });
    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(sendEmail.mock.calls[0][0]).toMatchObject({
      to: "zz-one@example.test",
      subject: "ZZ Issue",
      sourceType: "broadcast",
      sourceId: null,
      topic: "marketing",
      contactId: 7,
    });
    const counted = query.mock.calls.find(([sql]) => String(sql).includes("SET recipient_count"));
    expect(counted?.[1]).toEqual([4, 2]);
  });

  it("does not count a suppressed address as sent, or let one failure stop the rest", async () => {
    state.due = [4];
    state.issues[4] = issue(4);
    state.list = ["zz-bad@example.test", "zz-quiet@example.test", "zz-fine@example.test"];
    sendEmail
      .mockRejectedValueOnce(new Error("mailbox unavailable"))
      .mockResolvedValueOnce({ outcome: "suppressed" })
      .mockResolvedValueOnce({ outcome: "sent" });

    await expect(sendScheduledIssues()).resolves.toEqual({ issues: 1, sent: 1 });
    expect(statements().some((sql) => sql.includes("SET status = 'scheduled'"))).toBe(false);
  });

  it("puts the claim back when the audience cannot be read, before anybody is mailed", async () => {
    state.due = [4];
    state.issues[4] = issue(4);
    state.audienceFails = true;

    await expect(sendScheduledIssues()).resolves.toEqual({ issues: 0, sent: 0 });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(statements().some((sql) => sql.includes("SET status = 'scheduled'"))).toBe(true);
  });
});

describe("sendIssueNow", () => {
  it("reports an issue that does not exist", async () => {
    await expect(sendIssueNow(99)).resolves.toEqual({ outcome: "not_found" });
  });

  it("refuses an issue that has already gone out", async () => {
    state.issues[4] = issue(4, { status: "sent" });
    await expect(sendIssueNow(4)).resolves.toEqual({ outcome: "already_sent" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("refuses when something else marked it sent first", async () => {
    state.issues[4] = issue(4);
    state.list = ["zz-one@example.test"];
    state.claimable = false;
    await expect(sendIssueNow(4)).resolves.toEqual({ outcome: "already_sent" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("sends a paid issue to the plan's subscribers only", async () => {
    state.issues[4] = issue(4, { status: "draft", access: "paid", plan_id: 3 });
    state.list = ["zz-member@example.test"];

    const result = await sendIssueNow(4);
    expect(result.outcome).toBe("sending");
    if (result.outcome !== "sending") return;
    expect(result.recipients).toBe(1);
    await expect(result.delivery).resolves.toBe(1);
    expect(statements().some((sql) => sql.includes("FROM subscriptions s"))).toBe(true);
    expect(statements().some((sql) => sql.includes("FROM contacts c"))).toBe(false);
  });
});
