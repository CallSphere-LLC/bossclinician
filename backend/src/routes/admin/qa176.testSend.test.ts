import type { AddressInfo } from "net";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { sendEmail, query } = vi.hoisted(() => ({
  sendEmail: vi.fn(async () => ({ outcome: "sent" })),
  query: vi.fn(async (sql: string) => {
  if (sql.includes("SELECT id FROM email_sequences")) return { rowCount: 1, rows: [{ id: 4 }] };
  if (sql.includes("SELECT e.subject")) return { rowCount: 1, rows: [{ subject: "Saved {{firstname}}", body_md: "Hi {{firstname}}", from_name: "", from_email: "" }] };
  if (sql.includes("FROM contacts")) return { rowCount: 1, rows: [{ id: 9, name: "Yvette Howard", first_name: "Yvette", last_name: "Howard", timezone: "America/Los_Angeles", custom_fields: {} }] };
  return { rowCount: 0, rows: [] };
  }),
}));

vi.mock("../../db/pool", () => ({ pool: { query } }));
vi.mock("../../email/provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../email/provider")>()),
  sendEmail,
  mergeLinks: () => ({ loginUrl: "https://example.test/login", startUrl: "https://example.test/library", unsubscribeUrl: "https://example.test/unsubscribe" }),
}));

import { adminSequencesRouter } from "./sequences";

describe("QA 176 sequence test send API (provider mocked)", () => {
  let server: ReturnType<ReturnType<typeof express>["listen"]>;
  let base: string;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use("/api/admin/sequences", adminSequencesRouter);
    await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", resolve); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());
  beforeEach(() => { sendEmail.mockClear(); query.mockClear(); });

  it("renders a new unsaved email for its test recipient", async () => {
    const res = await fetch(`${base}/api/admin/sequences/4/emails/draft/test`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "yvette@example.test", draft: { subject: "Hello {{firstname}}", bodyMd: "Hi {{firstName}}" } }),
    });
    expect(res.status).toBe(202);
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: "yvette@example.test", subject: "[Test] Hello Yvette", text: "Hi Yvette", sourceType: "transactional",
    }));
  });

  it("renders an existing saved email, with no draft payload", async () => {
    const res = await fetch(`${base}/api/admin/sequences/4/emails/8/test`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "yvette@example.test" }),
    });
    expect(res.status).toBe(202);
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      subject: "[Test] Saved Yvette", text: "Hi Yvette",
    }));
  });
});
