import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  CONTACT_UNCONFIRMED_SQL,
  confirmMemberEmailAsAdmin,
  summariseConfirmation,
} from "./emailConfirmation";

/**
 * The two confirmation stores, and the two bugs they caused.
 *
 * `members.email_verified_at` is the ACCOUNT's confirmation and gates posting,
 * commenting and points. `contacts.email_marketing_status = 'unconfirmed'` is
 * the MAILING LIST's double opt-in state. Neither reflected the other, and a
 * tester found both halves of that on the live site: the People screen's
 * "Hasn't confirmed yet" filter said "0 people" while a member sat blocked from
 * posting, and that member's own contact card read "Happy to hear from you".
 *
 * Same class of bug as the two email-preference stores fixed in ebfbb0a, and the
 * same treatment: both stores kept, every surface reads both, and a real
 * confirmation writes both.
 */

const query = vi.fn();
const connect = vi.fn();
vi.mock("../db/pool", () => ({
  pool: {
    query: (...args: unknown[]) => query(...args),
    connect: () => connect(),
  },
}));

vi.mock("../email/mailer", () => ({ sendMail: vi.fn() }));

function sql(text: unknown): string {
  return String(text).replace(/\s+/g, " ").trim();
}

describe("summariseConfirmation", () => {
  it("reports an unconfirmed ACCOUNT even when the consent row says subscribed", () => {
    // Exactly the live state: contact 'subscribed', member never confirmed. The
    // card used to read "Happy to hear from you" about somebody who could not
    // post a word.
    const summary = summariseConfirmation({
      contactStatus: "subscribed",
      memberId: 40,
      accountConfirmedAt: null,
    });

    expect(summary.state).toBe("unconfirmed");
    expect(summary.confirmed).toBe(false);
    expect(summary.canPost).toBe(false);
    expect(summary.label).toBe("Hasn't confirmed their email");
    expect(summary.detail).toContain("can't post");
  });

  it("reports a confirmed account as able to post", () => {
    const summary = summariseConfirmation({
      contactStatus: "subscribed",
      memberId: 40,
      accountConfirmedAt: "2026-09-01T10:00:00.000Z",
    });

    expect(summary.state).toBe("confirmed");
    expect(summary.canPost).toBe(true);
  });

  it("keeps the mailing list's own pending confirmation distinct", () => {
    const summary = summariseConfirmation({
      contactStatus: "unconfirmed",
      memberId: null,
      accountConfirmedAt: null,
    });

    expect(summary.state).toBe("list_unconfirmed");
    expect(summary.confirmed).toBe(false);
    // No account, so there is nothing to unblock — saying they cannot post would
    // imply an account they do not have.
    expect(summary.canPost).toBe(false);
  });

  it("does not call somebody unconfirmed just because they have no account", () => {
    const summary = summariseConfirmation({
      contactStatus: "subscribed",
      memberId: null,
      accountConfirmedAt: null,
    });

    expect(summary.state).toBe("no_account");
    expect(summary.confirmed).toBe(true);
  });
});

describe("CONTACT_UNCONFIRMED_SQL", () => {
  it("reads both stores, so the filter and the tile cannot disagree", () => {
    const clause = sql(CONTACT_UNCONFIRMED_SQL);

    expect(clause).toContain("c.email_marketing_status = 'unconfirmed'");
    expect(clause).toContain("m.email_verified_at IS NULL");
    // An erased account keeps a null `email_verified_at` for ever and nobody can
    // confirm it, so it must not sit in the list as work to do.
    expect(clause).toContain("m.status <> 'deleted'");
  });
});

describe("confirmMemberEmailAsAdmin", () => {
  const client = {
    query: vi.fn(),
    release: vi.fn(),
  };

  beforeEach(() => {
    query.mockReset();
    client.query.mockReset();
    client.release.mockReset();
    client.query.mockResolvedValue({ rows: [], rowCount: 1 });
    connect.mockReset();
    connect.mockResolvedValue(client);
  });

  it("writes BOTH stores in one transaction and retires the outstanding links", async () => {
    let confirmed = false;
    query.mockImplementation(async (text: unknown) => {
      if (sql(text).startsWith("SELECT m.id, m.email_verified_at")) {
        return {
          rows: [
            {
              id: 40,
              email_verified_at: confirmed ? new Date("2026-09-04T12:00:00Z") : null,
              contact_status: confirmed ? "subscribed" : "unconfirmed",
            },
          ],
        };
      }
      return { rows: [], rowCount: 0 };
    });
    // The second read of the member happens after the write, so it has to see
    // the new state.
    client.query.mockImplementation(async (text: unknown) => {
      if (sql(text).startsWith("UPDATE members")) confirmed = true;
      return { rows: [], rowCount: 1 };
    });

    const result = await confirmMemberEmailAsAdmin(40);

    const statements = client.query.mock.calls.map((call) => sql(call[0]));
    expect(statements[0]).toBe("BEGIN");
    expect(statements.some((s) => s.startsWith("UPDATE members"))).toBe(true);
    expect(
      statements.some((s) => s.includes("UPDATE member_email_verifications SET used_at = now()")),
    ).toBe(true);
    // The consent row is the other store, and this is the write that used to be
    // missing entirely.
    expect(statements.some((s) => s.startsWith("UPDATE contacts"))).toBe(true);
    expect(statements[statements.length - 1]).toBe("COMMIT");
    expect(client.release).toHaveBeenCalled();

    expect(result.changed).toBe(true);
    expect(result.before.state).toBe("unconfirmed");
    expect(result.after.state).toBe("confirmed");
  });

  it("only ever lifts a contact out of 'unconfirmed'", async () => {
    query.mockImplementation(async (text: unknown) => {
      if (sql(text).startsWith("SELECT m.id, m.email_verified_at")) {
        return { rows: [{ id: 41, email_verified_at: null, contact_status: "opted_out" }] };
      }
      return { rows: [], rowCount: 0 };
    });

    await confirmMemberEmailAsAdmin(41);

    // Proving the address is not the same as asking to be marketed to again, so
    // an opt-out, a bounce or a complaint has to survive this button.
    const contactWrite = client.query.mock.calls
      .map((call) => sql(call[0]))
      .find((s) => s.startsWith("UPDATE contacts"));
    expect(contactWrite).toContain("c.email_marketing_status = 'unconfirmed'");
  });

  it("is idempotent for an address that is already confirmed", async () => {
    query.mockImplementation(async (text: unknown) => {
      if (sql(text).startsWith("SELECT m.id, m.email_verified_at")) {
        return {
          rows: [
            {
              id: 42,
              email_verified_at: new Date("2026-08-01T09:00:00Z"),
              contact_status: "subscribed",
            },
          ],
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const result = await confirmMemberEmailAsAdmin(42);

    expect(result.changed).toBe(false);
    expect(result.after.state).toBe("confirmed");
    // No transaction: nothing needed writing, and re-stamping the date would
    // rewrite when they confirmed.
    expect(connect).not.toHaveBeenCalled();
  });

  it("refuses a member id that names no live account", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(confirmMemberEmailAsAdmin(999)).rejects.toThrow(/No live member account/);
  });
});
