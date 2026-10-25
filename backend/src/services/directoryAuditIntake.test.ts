import { beforeEach, describe, expect, it, vi } from "vitest";
import { pool } from "../db/pool";
import { sendMail } from "../email/mailer";
import { authorizeDirectoryAuditSubmission, directoryAuditIntakeEmail, issueDirectoryAuditToken, sendDirectoryAuditIntake } from "./directoryAuditIntake";

vi.mock("../db/pool", () => ({ pool: { query: vi.fn() } }));
vi.mock("../email/mailer", () => ({ sendMail: vi.fn() }));
vi.mock("../config/env", () => ({ env: { publicSiteUrl: "https://www.bossclinician.com", jwtSecret: "test-secret" } }));

const order = {
  id: 42, offer_slug: "directory-makeover-audit", email: "buyer@example.test",
  billing_name: "Dr. Jane Doe", member_id: 7, contact_id: 8,
  gift_recipient_email: "",
};

describe("Directory Makeover Audit intake", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(pool.query).mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes("FROM forms")) return { rows: [{ slug: "directory-makeover-audit-intake" }] } as never;
      if (query.includes("INSERT INTO directory_audit")) return { rows: [{ order_id: 42 }] } as never;
      return { rows: [] } as never;
    });
    vi.mocked(sendMail).mockResolvedValue({ sent: true, messageId: 1, providerMessageId: "test", error: "" });
  });

  it("uses the published form route, personalizes copy and records the send", async () => {
    expect(await sendDirectoryAuditIntake(order)).toBe(true);
    const message = vi.mocked(sendMail).mock.calls[0][0];
    expect(message.topic).toBe("directory_audit_intake");
    expect(message.to).toBe(order.email);
    expect(message.text).toContain("Hey Jane,");
    expect(message.text).toContain("https://www.bossclinician.com/f/directory-makeover-audit-intake#audit_order_token=");
    expect(message.text).toContain("3?5 business days");
    expect(message.html).toContain('href="https://www.bossclinician.com/f/directory-makeover-audit-intake#audit_order_token=');
    expect(vi.mocked(pool.query).mock.calls.some(([sql]) => String(sql).includes("SET sent_at"))).toBe(true);
  });

  it("does not send if the form is unpublished or missing", async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as never);
    expect(await sendDirectoryAuditIntake(order)).toBe(false);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("does not resend an already claimed order", async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ slug: "directory-makeover-audit-intake" }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never);
    expect(await sendDirectoryAuditIntake(order)).toBe(false);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("releases a failed claim for a later retry", async () => {
    vi.mocked(sendMail).mockResolvedValueOnce({ sent: false, messageId: 1, providerMessageId: "", error: "offline" });
    expect(await sendDirectoryAuditIntake(order)).toBe(false);
    expect(vi.mocked(pool.query).mock.calls.some(([sql]) => String(sql).startsWith("DELETE FROM directory_audit"))).toBe(true);
  });

  it("ignores unrelated offers and gift purchases", async () => {
    expect(await sendDirectoryAuditIntake({ ...order, offer_slug: "other" })).toBe(false);
    expect(await sendDirectoryAuditIntake({ ...order, gift_recipient_email: "gift@example.test" })).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("rejects missing, tampered and expired purchase tokens before any database read", async () => {
    const issued = issueDirectoryAuditToken(42, 1_000_000);
    expect(await authorizeDirectoryAuditSubmission("", order.email, 1_000_001)).toBe(false);
    expect(await authorizeDirectoryAuditSubmission(issued.replace("42.", "43."), order.email, 1_000_001)).toBe(false);
    expect(await authorizeDirectoryAuditSubmission(issued, order.email, 1_000_000 + 61 * 24 * 60 * 60 * 1000)).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("checks the paid offer, active grant and buyer email without returning a submission", async () => {
    const token = issueDirectoryAuditToken(42);
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ "?column?": 1 }] } as never);
    expect(await authorizeDirectoryAuditSubmission(token, order.email)).toBe(true);
    const [sql, params] = vi.mocked(pool.query).mock.calls[0];
    expect(String(sql)).toContain("o.status = 'paid'");
    expect(String(sql)).toContain("g.status = 'active'");
    expect(String(sql)).toContain("lower(o.email) = lower($3)");
    expect(params).toEqual([42, "directory-makeover-audit", order.email]);
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as never);
    expect(await authorizeDirectoryAuditSubmission(token, "other@example.test")).toBe(false);
  });

  it("escapes the buyer name in HTML", () => {
    const content = directoryAuditIntakeEmail("<Jane>", "https://www.bossclinician.com/f/directory-makeover-audit-intake");
    expect(content.html).toContain("&lt;Jane&gt;");
    expect(content.html).not.toContain("<Jane>");
  });
});
