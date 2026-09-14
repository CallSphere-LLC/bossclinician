import { describe, expect, it, vi, beforeEach } from "vitest";
import { sendEmail } from "./provider";
import { SendingIdentityError } from "../services/sendingIdentity";

/**
 * The regression this file exists for.
 *
 * On the live site, "Name in the inbox", "Sent from" and "Your postal address"
 * were all blank and the app sent anyway: `fromHeader()` fell back to SMTP_FROM,
 * the CAN-SPAM footer was built out of nothing, the send reported success and the
 * delivery log recorded it as handed over. Nobody could have known.
 *
 * Two properties are pinned here, and they pull in opposite directions on
 * purpose:
 *
 *   a marketing send with an incomplete identity is REFUSED, written down as
 *   failed with the missing field named, and never handed to the transport;
 *
 *   a transactional send is not, because email confirmation gates posting,
 *   commenting and every point a member can earn — so refusing a confirmation
 *   link over a blank marketing footer would lock every member out to enforce a
 *   rule that does not apply to it.
 */

const query = vi.fn();
vi.mock("../db/pool", () => ({ pool: { query: (...args: unknown[]) => query(...args) } }));

const transportSend = vi.fn();
vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({ sendMail: (...args: unknown[]) => transportSend(...args) }),
  },
}));

// config/env reads process.env at import time and would demand a JWT secret and
// a database URL that have nothing to do with these rules.
vi.mock("../config/env", () => ({
  env: {
    jwtSecret: "test-secret-for-preference-links",
    publicSiteUrl: "https://bossclinician.example",
    smtp: {
      host: "email-smtp.us-east-1.amazonaws.com",
      port: 587,
      user: "u",
      pass: "p",
      from: "Yvette <yvette@bossclinician.callsphere.site>",
    },
    ses: {
      transactionalConfigSet: "bc-transactional",
      marketingConfigSet: "bc-marketing",
      snsTopicArn: "",
    },
  },
}));

function sql(text: unknown): string {
  return String(text).replace(/\s+/g, " ").trim();
}

/** Every read `sendEmail` makes, answered by what the statement is asking for. */
function stubDatabase(marketing: Record<string, unknown>): void {
  query.mockImplementation(async (text: unknown, _params?: unknown[]) => {
    const statement = sql(text);

    if (statement.startsWith("INSERT INTO email_messages")) return { rows: [{ id: "77" }] };
    if (statement.includes("FROM settings WHERE key = $1")) {
      // Both settings reads land here; the provider row is answered with the
      // default the live site actually had.
      return { rows: [{ value: _params?.[0] === "marketing_email" ? marketing : { provider: "smtp" } }] };
    }
    if (statement.includes("FROM email_suppressions")) return { rows: [], rowCount: 0 };
    if (statement.includes("FROM contacts WHERE id")) {
      return { rows: [{ email_marketing_status: "subscribed" }], rowCount: 1 };
    }
    if (statement.includes("FROM contact_email_preferences")) return { rows: [], rowCount: 0 };
    if (statement.includes("member_email_preferences")) return { rows: [], rowCount: 0 };
    return { rows: [], rowCount: 0 };
  });
}

const BLANK = { fromName: "", fromEmail: "", replyTo: "", address: "", footer: "" };
const COMPLETE = {
  fromName: "Yvette at Boss Clinician",
  fromEmail: "yvette@bossclinician.callsphere.site",
  replyTo: "",
  address: "Boss Clinician, 100 Main St, Austin TX 78701",
  footer: "",
};

beforeEach(() => {
  query.mockReset();
  transportSend.mockReset();
  transportSend.mockResolvedValue({ messageId: "<local@id>", response: "250 Ok 0100019a1b2c3d4e" });
});

describe("sendEmail with a blank sending identity", () => {
  it("refuses a broadcast, names every missing field, and sends nothing", async () => {
    stubDatabase(BLANK);

    const attempt = sendEmail({
      to: "success+reader@simulator.amazonses.com",
      subject: "March newsletter",
      text: "Hello",
      contactId: 21,
      sourceType: "broadcast",
      sourceId: 4,
      topic: "marketing",
    });

    await expect(attempt).rejects.toBeInstanceOf(SendingIdentityError);
    await expect(attempt).rejects.toThrow(/Sent from, Name in the inbox, Your postal address/);

    // Nothing was handed over — the refusal happens before the transport, not
    // after it.
    expect(transportSend).not.toHaveBeenCalled();

    // And it is written down as failed with the reason, so the delivery log says
    // which field rather than showing the message as arrived.
    const failure = query.mock.calls.find(
      (call) => sql(call[0]).startsWith("UPDATE email_messages SET status = 'failed'"),
    );
    expect(failure).toBeDefined();
    expect(String(failure?.[1]?.[1])).toBe(
      "sending identity incomplete: Sent from, Name in the inbox, Your postal address",
    );
  });

  it("refuses when only the postal address is missing", async () => {
    stubDatabase({ ...COMPLETE, address: "" });

    await expect(
      sendEmail({
        to: "success+reader@simulator.amazonses.com",
        subject: "March newsletter",
        text: "Hello",
        contactId: 21,
        sourceType: "sequence",
        topic: "marketing",
      }),
    ).rejects.toThrow(/Your postal address/);
    expect(transportSend).not.toHaveBeenCalled();
  });

  it("still sends a transactional message, under the server's own identity", async () => {
    stubDatabase(BLANK);

    const result = await sendEmail({
      to: "success+member@simulator.amazonses.com",
      subject: "Confirm your email address",
      text: "Here is your link",
      memberId: 40,
      sourceType: "transactional",
    });

    expect(result.outcome).toBe("sent");
    expect(transportSend).toHaveBeenCalledTimes(1);
    expect(transportSend.mock.calls[0][0].from).toBe(
      "Yvette <yvette@bossclinician.callsphere.site>",
    );
  });

  it("sends the broadcast once the identity is complete, with the address in the footer", async () => {
    stubDatabase(COMPLETE);

    const result = await sendEmail({
      to: "success+reader@simulator.amazonses.com",
      subject: "March newsletter",
      text: "Hello",
      contactId: 21,
      sourceType: "broadcast",
      topic: "marketing",
    });

    expect(result.outcome).toBe("sent");
    const message = transportSend.mock.calls[0][0];
    expect(message.from).toBe("Yvette at Boss Clinician <yvette@bossclinician.callsphere.site>");
    expect(message.text).toContain("Boss Clinician, 100 Main St, Austin TX 78701");
    expect(message.headers["List-Unsubscribe"]).toMatch(/^<https:\/\/bossclinician\.example/);
  });

  it("accepts a campaign that carries its own from-identity, if the address is saved", async () => {
    // A campaign may override the sender, so the gate judges the EFFECTIVE
    // identity rather than the settings row alone — otherwise a correctly
    // configured campaign would be refused for a blank default.
    stubDatabase({ ...BLANK, address: "Boss Clinician, 100 Main St, Austin TX 78701" });

    const result = await sendEmail({
      to: "success+reader@simulator.amazonses.com",
      subject: "March newsletter",
      text: "Hello",
      contactId: 21,
      sourceType: "broadcast",
      topic: "marketing",
      fromName: "Boss Clinician Lounge",
      // A subdomain of the verified sending domain is itself sendable, as it is in SES.
      fromEmail: "lounge@news.bossclinician.callsphere.site",
    });

    expect(result.outcome).toBe("sent");
    expect(transportSend.mock.calls[0][0].from).toBe(
      "Boss Clinician Lounge <lounge@news.bossclinician.callsphere.site>",
    );
  });
});

describe("sendEmail with a from-address off the verified sending domain", () => {
  it("refuses a campaign sent as a display-only address, and never hands it over", async () => {
    // `yvette@bossclinician.com` is on the legal pages and is not a sending
    // identity here. The settings screen refuses it at save; a campaign can carry
    // its own from-address, so the door itself has to refuse it too.
    stubDatabase(COMPLETE);

    const attempt = sendEmail({
      to: "success+reader@simulator.amazonses.com",
      subject: "March newsletter",
      text: "Hello",
      contactId: 21,
      sourceType: "broadcast",
      sourceId: 4,
      topic: "marketing",
      fromName: "Yvette",
      fromEmail: "yvette@bossclinician.com",
    });

    await expect(attempt).rejects.toBeInstanceOf(SendingIdentityError);
    await expect(attempt).rejects.toThrow(/bossclinician\.com, which this site isn't verified to send from/);
    expect(transportSend).not.toHaveBeenCalled();

    const failure = query.mock.calls.find(
      (call) => sql(call[0]).startsWith("UPDATE email_messages SET status = 'failed'"),
    );
    expect(String(failure?.[1]?.[1])).toBe(
      "sending address not on a verified sending domain: yvette@bossclinician.com",
    );
    // And it is never marked as sent.
    expect(
      query.mock.calls.some((call) => sql(call[0]).includes("SET status = 'sent'")),
    ).toBe(false);
  });

  it("records the delivery-log provider as the service, not the protocol (E5)", async () => {
    stubDatabase(COMPLETE);

    await sendEmail({
      to: "success+reader@simulator.amazonses.com",
      subject: "March newsletter",
      text: "Hello",
      contactId: 21,
      sourceType: "broadcast",
      topic: "marketing",
    });

    const insert = query.mock.calls.find((call) => sql(call[0]).startsWith("INSERT INTO email_messages"));
    // Parameter 8 is `provider`: SMTP_HOST is Amazon's SMTP interface, so "ses".
    expect(insert?.[1]?.[7]).toBe("ses");
  });
});
