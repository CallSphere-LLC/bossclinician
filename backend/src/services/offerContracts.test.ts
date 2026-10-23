import { describe, expect, it, vi } from "vitest";

vi.mock("../db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock("../email/mailer", () => ({ sendMail: vi.fn() }));

import {
  assignOfferContractsSafely,
  CONTRACT_ASSIGNED_KIND,
  contractAssignedEmail,
  contractNotice,
} from "./offerContracts";

/**
 * A stand-in transaction client: answers by statement, remembers what ran.
 * `existing` holds the (contract, member) pairs already assigned, which is what
 * UNIQUE(contract_id, member_id) enforces in the real table.
 */
function fakeClient(opts: { links: Array<{ contract_id: number; offer_id: number }>; existing?: string[]; failOn?: RegExp }) {
  const existing = new Set(opts.existing ?? []);
  const statements: string[] = [];
  let nextId = 100;
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    statements.push(sql.trim().split(/\s+/).slice(0, 3).join(" "));
    if (opts.failOn?.test(sql)) throw new Error("boom");
    if (/FROM offer_contracts/.test(sql)) return { rows: opts.links };
    if (/INSERT INTO participant_contract_assignments/.test(sql)) {
      const key = `${params[0]}:${params[1]}`;
      if (existing.has(key)) return { rows: [] };
      existing.add(key);
      return { rows: [{ id: String(nextId++) }] };
    }
    if (/SELECT event_hash/.test(sql)) return { rows: [] };
    if (/SELECT title FROM participant_contracts/.test(sql)) return { rows: [{ title: `Contract ${params[0]}` }] };
    return { rows: [] };
  });
  return { client: { query } as never, query, statements };
}

describe("assignOfferContractsSafely", () => {
  it("assigns every linked contract once, records the audit event and notice, under a savepoint", async () => {
    const { client, query } = fakeClient({ links: [{ contract_id: 1, offer_id: 7 }, { contract_id: 2, offer_id: 7 }] });
    const assigned = await assignOfferContractsSafely({ client, memberId: 5, offerIds: [7, 7], orderId: 44 });
    expect(assigned).toEqual([
      { assignmentId: 100, contractId: 1, title: "Contract 1" },
      { assignmentId: 101, contractId: 2, title: "Contract 2" },
    ]);
    const sql = query.mock.calls.map(([text]) => String(text));
    expect(sql[0]).toBe("SAVEPOINT offer_contracts");
    expect(sql.at(-1)).toBe("RELEASE SAVEPOINT offer_contracts");
    // The offer list is de-duplicated before it reaches the database.
    expect(query.mock.calls[1][1]).toEqual([[7]]);
    const events = query.mock.calls.filter(([text]) => /INSERT INTO participant_contract_events/.test(String(text)));
    expect(events).toHaveLength(2);
    expect(JSON.parse(String((events[0][1] as unknown[])[7]))).toMatchObject({ source: "purchase", orderId: 44, offerId: 7, contractId: 1, memberId: 5 });
    const notices = query.mock.calls.filter(([text]) => /INSERT INTO member_notifications/.test(String(text)));
    expect(notices).toHaveLength(2);
    expect((notices[0][1] as unknown[])[1]).toBe(CONTRACT_ASSIGNED_KIND);
    // The purchase is recorded on the assignment.
    const inserts = query.mock.calls.filter(([text]) => /INSERT INTO participant_contract_assignments/.test(String(text)));
    expect(inserts[0][1]).toEqual([1, 5, 44, 7]);
  });

  it("leaves an existing assignment alone (repeat purchase or replayed webhook)", async () => {
    const { client, query } = fakeClient({ links: [{ contract_id: 1, offer_id: 7 }], existing: ["1:5"] });
    expect(await assignOfferContractsSafely({ client, memberId: 5, offerIds: [7], orderId: 45 })).toEqual([]);
    expect(query.mock.calls.some(([text]) => /participant_contract_events|member_notifications/.test(String(text)))).toBe(false);
  });

  it("does nothing at all for an order with no offers", async () => {
    const { client, query } = fakeClient({ links: [] });
    expect(await assignOfferContractsSafely({ client, memberId: 5, offerIds: [], orderId: 46 })).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it("never throws: a failure rolls back to the savepoint so the payment still commits", async () => {
    const { client, query } = fakeClient({ links: [{ contract_id: 1, offer_id: 7 }], failOn: /INSERT INTO participant_contract_events/ });
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(assignOfferContractsSafely({ client, memberId: 5, offerIds: [7], orderId: 47 })).resolves.toEqual([]);
    expect(query.mock.calls.map(([text]) => String(text))).toContain("ROLLBACK TO SAVEPOINT offer_contracts");
    errors.mockRestore();
  });

  it("keeps the assignment when only the in-app notice fails", async () => {
    const { client, query } = fakeClient({ links: [{ contract_id: 1, offer_id: 7 }], failOn: /INSERT INTO member_notifications/ });
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const assigned = await assignOfferContractsSafely({ client, memberId: 5, offerIds: [7], orderId: 48 });
    expect(assigned).toHaveLength(1);
    const sql = query.mock.calls.map(([text]) => String(text));
    expect(sql).toContain("ROLLBACK TO SAVEPOINT contract_notice");
    expect(sql.at(-1)).toBe("RELEASE SAVEPOINT offer_contracts");
    errors.mockRestore();
  });
});

describe("contract notices", () => {
  it("links the in-app notice to the member Contracts page", () => {
    expect(contractNotice("Coaching agreement")).toEqual({
      title: "Please review and sign: Coaching agreement",
      body: expect.stringContaining("sign online"),
      link: "/contracts",
    });
  });

  it("writes one email for one or several contracts, escaping titles", () => {
    const one = contractAssignedEmail({ firstName: "Dr. Jane", titles: ["Coaching <agreement>"], siteUrl: "https://example.test" });
    expect(one.subject).toBe("Please sign: Coaching <agreement>");
    expect(one.text).toContain("Hi Jane,");
    expect(one.text).toContain("https://example.test/contracts");
    expect(one.html).toContain("Coaching &lt;agreement&gt;");
    const many = contractAssignedEmail({ firstName: "", titles: ["A", "B"], siteUrl: "https://example.test" });
    expect(many.subject).toBe("You have contracts to sign");
    expect(many.text).toContain("Hi there,");
  });
});
