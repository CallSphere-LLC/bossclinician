import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("../db/pool", () => ({ pool: { query: (...args: unknown[]) => query(...args) } }));

import { suppress } from "./provider";

describe("suppress", () => {
  beforeEach(() => {
    query.mockReset();
    query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it("records the suppression reason as the contact's consent source", async () => {
    await suppress({ email: " Someone@Example.com ", reason: "unsubscribe", detail: "one-click" });

    const update = query.mock.calls.find(([sql]) => String(sql).includes("UPDATE contacts"));
    expect(update).toBeDefined();
    const [sql, params] = update as [string, unknown[]];
    // Without this, a contact whose consent_source was 'admin' kept it after
    // unsubscribing themselves and was counted as "Unsubscribed by you".
    expect(sql).toMatch(/consent_source\s*=\s*CASE/);
    expect(sql).toContain("THEN $3");
    expect(params).toEqual(["someone@example.com", "opted_out", "unsubscribe"]);
  });

  it("passes a bounce through with its own status and source", async () => {
    await suppress({ email: "b@example.com", reason: "bounce", contactStatus: "bounced" });

    const update = query.mock.calls.find(([sql]) => String(sql).includes("UPDATE contacts"));
    expect((update as [string, unknown[]])[1]).toEqual(["b@example.com", "bounced", "bounce"]);
  });
});
