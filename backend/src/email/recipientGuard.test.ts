import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FIXED_TEST_RECIPIENTS,
  RecipientGuardError,
  assertRecipientAllowed,
  isAllowListedRecipient,
  recipientGuardState,
  refusedRecipients,
} from "./recipientGuard";
import { sendMail, sendMailStrict } from "./mailer";
import { makeResendProvider, sendEmail } from "./provider";

/**
 * The staging send guard: nothing but the SES mailbox simulator and the owner's
 * own test inboxes may be mailed outside production, so a seed script or a ZZ
 * probe cannot hard-bounce the account. Nine `@example.com` sends reached SES
 * before this existed.
 */

const query = vi.fn();
vi.mock("../db/pool", () => ({ pool: { query: (...args: unknown[]) => query(...args) } }));

const transportSend = vi.fn();
vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({ sendMail: (...args: unknown[]) => transportSend(...args) }),
  },
}));

vi.mock("../config/env", () => ({
  env: {
    jwtSecret: "test-secret",
    publicSiteUrl: "https://bossclinician.callsphere.site",
    smtp: {
      host: "email-smtp.us-east-1.amazonaws.com",
      port: 587,
      user: "u",
      pass: "p",
      from: "Yvette <yvette@bossclinician.callsphere.site>",
    },
    ses: { transactionalConfigSet: "bc-transactional", marketingConfigSet: "", snsTopicArn: "" },
  },
}));

const STAGING = { APP_ENV: "staging" };

function sql(text: unknown): string {
  return String(text).replace(/\s+/g, " ").trim();
}

describe("recipientGuardState", () => {
  it("is off only for an explicit APP_ENV=production", () => {
    expect(recipientGuardState({ APP_ENV: "production" })).toEqual({ active: false, environment: "production" });
    expect(recipientGuardState({ APP_ENV: " Production " }).active).toBe(false);
  });

  it("is on for staging, development, test and a misspelling", () => {
    for (const APP_ENV of ["staging", "development", "test", "prod", "production-like"]) {
      expect(recipientGuardState({ APP_ENV }).active).toBe(true);
    }
  });

  it("fails safe: no configuration at all is guarded", () => {
    expect(recipientGuardState({})).toEqual({ active: true, environment: "non-production" });
  });

  it("does not take NODE_ENV=production as production (the staging container runs it)", () => {
    expect(recipientGuardState({ NODE_ENV: "production" } as Record<string, string>).active).toBe(true);
  });

  it("can be forced on in production, and has no off switch", () => {
    expect(recipientGuardState({ APP_ENV: "production", EMAIL_RECIPIENT_GUARD: "on" }).active).toBe(true);
    expect(recipientGuardState({ APP_ENV: "staging", EMAIL_RECIPIENT_GUARD: "off" }).active).toBe(true);
  });
});

describe("isAllowListedRecipient", () => {
  it("carries the fixed entries, including the owner-approved Gmail address", () => {
    expect(FIXED_TEST_RECIPIENTS).toEqual([
      "*@simulator.amazonses.com",
      "sagar+*@callsphere.ai",
      "sagarshankaranm@gmail.com",
      "sagarshankaranusa@gmail.com",
    ]);
  });

  it.each([
    "success@simulator.amazonses.com",
    "bounce@simulator.amazonses.com",
    "complaint@simulator.amazonses.com",
    "suppressionlist@simulator.amazonses.com",
    "success+zz-final@simulator.amazonses.com",
    "sagar+zz21@callsphere.ai",
    "sagar+zze1.x-y@callsphere.ai",
    "sagarshankaranm@gmail.com",
    "sagarshankaranusa@gmail.com",
  ])("allows %s", (address) => {
    expect(isAllowListedRecipient(address, {})).toBe(true);
  });

  it("is case-insensitive and ignores surrounding space", () => {
    expect(isAllowListedRecipient("Success@Simulator.AmazonSES.com", {})).toBe(true);
    expect(isAllowListedRecipient("SAGAR+ZZ2@CALLSPHERE.AI", {})).toBe(true);
    expect(isAllowListedRecipient("  SagarShankaranUSA@Gmail.com ", {})).toBe(true);
  });

  it.each([
    "zz-final@example.com",
    "zz-turn@example.com",
    "someone@example.test",
    "yvette@bossclinician.com",
    // The plus-tag is part of the pattern: the bare mailbox is not a test address.
    "sagar@callsphere.ai",
    "sagarx+1@callsphere.ai",
    "xsagar+1@callsphere.ai",
    // Exact entries are exact: no plus-tag widening on the Gmail addresses.
    "sagarshankaranm+x@gmail.com",
    "sagarshankaranusa+signup@gmail.com",
  ])("refuses %s", (address) => {
    expect(isAllowListedRecipient(address, {})).toBe(false);
  });

  it.each([
    "sagar+x@callsphere.ai.evil.com",
    "success@simulator.amazonses.com.evil",
    "success@simulator.amazonses.com.",
    "success@evilsimulator.amazonses.com",
    "success@sub.simulator.amazonses.com",
    "success@simulator-amazonses.com",
    "sagar+x@callsphere-ai.com",
    "sagar+x@callsphere.ai@evil.com",
    "sagarshankaranm@gmail.com.evil.com",
    "sagarshankaranm@gmail.co",
    // Cyrillic "а" in place of the Latin one.
    "sagar+x@cаllsphere.ai",
  ])("refuses the lookalike %s", (address) => {
    expect(isAllowListedRecipient(address, {})).toBe(false);
  });

  it("adds EMAIL_TEST_RECIPIENTS entries, exact or with a local-part wildcard", () => {
    const source = { EMAIL_TEST_RECIPIENTS: "qa@callsphere.tech, ops+*@callsphere.tech;  Madhav@Example.org" };
    expect(isAllowListedRecipient("qa@callsphere.tech", source)).toBe(true);
    expect(isAllowListedRecipient("ops+7@callsphere.tech", source)).toBe(true);
    expect(isAllowListedRecipient("madhav@example.org", source)).toBe(true);
    expect(isAllowListedRecipient("qa2@callsphere.tech", source)).toBe(false);
    expect(isAllowListedRecipient("ops@callsphere.tech", source)).toBe(false);
    // The fixed entries still apply alongside the configured ones.
    expect(isAllowListedRecipient("success@simulator.amazonses.com", source)).toBe(true);
  });

  it("ignores an entry with a wildcard domain rather than widening to it", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const source = { EMAIL_TEST_RECIPIENTS: "*@*.callsphere.ai,*,*@*" };
    expect(isAllowListedRecipient("anyone@evil.callsphere.ai", source)).toBe(false);
    expect(isAllowListedRecipient("anyone@anywhere.com", source)).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("ignoring EMAIL_TEST_RECIPIENTS entry"));
    warn.mockRestore();
  });
});

describe("refusedRecipients", () => {
  it("judges the mailbox inside a display name, not the display name", () => {
    expect(refusedRecipients('"sagar+x@callsphere.ai" <someone@else.com>', {})).toEqual(["someone@else.com"]);
    expect(refusedRecipients("Sagar <sagar+x@callsphere.ai>", {})).toEqual([]);
  });

  it("refuses a list when any member of it is not allow-listed", () => {
    expect(refusedRecipients("success@simulator.amazonses.com, zz@example.com", {})).toEqual(["zz@example.com"]);
  });

  it("refuses something that is not an address at all", () => {
    expect(refusedRecipients("not an address", {})).toHaveLength(1);
    expect(refusedRecipients("", {})).toHaveLength(1);
  });
});

describe("assertRecipientAllowed", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it("throws and logs one clear line for a refused recipient", () => {
    expect(() => assertRecipientAllowed("zz-final@example.com", STAGING)).toThrow(RecipientGuardError);
    expect(warn).toHaveBeenCalledWith(
      "email guard: refused send to zz-final@example.com (not allow-listed in staging)",
    );
  });

  it("lets allow-listed recipients through silently", () => {
    expect(() => assertRecipientAllowed("bounce@simulator.amazonses.com", STAGING)).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });

  it("passes everything through in production", () => {
    expect(() => assertRecipientAllowed("customer@gmail.com", { APP_ENV: "production" })).not.toThrow();
  });

  it("names the environment as non-production when APP_ENV is unset", () => {
    expect(() => assertRecipientAllowed("x@y.com", {})).toThrow(
      "email guard: refused send to x@y.com (not allow-listed in non-production)",
    );
  });
});

describe("the guard on every transport", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    query.mockReset();
    transportSend.mockReset();
    transportSend.mockResolvedValue({ response: "250 Ok 010001a0feedfacecafe", messageId: "<local@id>" });
    query.mockImplementation(async (text: unknown) => {
      const statement = sql(text);
      if (statement.startsWith("INSERT INTO email_messages")) return { rows: [{ id: "77" }] };
      if (statement.includes("FROM settings WHERE key = $1")) return { rows: [{ value: { provider: "smtp" } }] };
      return { rows: [], rowCount: 0 };
    });
    vi.stubEnv("APP_ENV", "staging");
    vi.stubEnv("EMAIL_TEST_RECIPIENTS", "");
    vi.stubEnv("EMAIL_RECIPIENT_GUARD", "");
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("sendMail: refuses, never touches SMTP, and records the send as failed with the reason", async () => {
    const outcome = await sendMail({ to: "zz-final@example.com", subject: "Confirm", text: "Link" });

    expect(outcome.sent).toBe(false);
    expect(outcome.error).toBe("email guard: refused send to zz-final@example.com (not allow-listed in staging)");
    expect(transportSend).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      "email guard: refused send to zz-final@example.com (not allow-listed in staging)",
    );

    const failed = query.mock.calls.find((call) => sql(call[0]).includes("SET status = 'failed'"));
    expect(String(failed?.[1]?.[1])).toContain("email guard: refused send to zz-final@example.com");
    expect(query.mock.calls.some((call) => sql(call[0]).includes("SET status = 'sent'"))).toBe(false);
  });

  it("sendMail: an allow-listed simulator address is handed to SMTP as before", async () => {
    const outcome = await sendMail({ to: "success@simulator.amazonses.com", subject: "Hi", text: "Hi" });

    expect(outcome.sent).toBe(true);
    expect(transportSend).toHaveBeenCalledOnce();
  });

  it("sendMailStrict (the settings test button) throws the refusal", async () => {
    await expect(
      sendMailStrict({ to: "yvette@bossclinician.com", subject: "Test", text: "Test" }),
    ).rejects.toBeInstanceOf(RecipientGuardError);
    expect(transportSend).not.toHaveBeenCalled();
  });

  it("sendEmail: refuses a transactional send and never marks it sent", async () => {
    await expect(
      sendEmail({ to: "zz-turn@example.com", subject: "Confirm", text: "Link", sourceType: "transactional" }),
    ).rejects.toBeInstanceOf(RecipientGuardError);
    expect(transportSend).not.toHaveBeenCalled();

    const failed = query.mock.calls.find((call) => sql(call[0]).startsWith("UPDATE email_messages SET status = 'failed'"));
    expect(String(failed?.[1]?.[1])).toBe(
      "email guard: refused send to zz-turn@example.com (not allow-listed in staging)",
    );
    expect(query.mock.calls.some((call) => sql(call[0]).includes("SET status = 'sent'"))).toBe(false);
  });

  it("Resend: refuses before any request is made", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      makeResendProvider("re_test").send({
        to: "reader@example.com",
        from: "Yvette <yvette@bossclinician.callsphere.site>",
        replyTo: "",
        subject: "Hi",
        text: "Hi",
        html: "<p>Hi</p>",
        headers: {},
      }),
    ).rejects.toBeInstanceOf(RecipientGuardError);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("production passes a real customer address straight to the transport", async () => {
    vi.stubEnv("APP_ENV", "production");

    const outcome = await sendMail({ to: "customer@gmail.com", subject: "Your receipt", text: "Thanks" });

    expect(outcome.sent).toBe(true);
    expect(transportSend).toHaveBeenCalledOnce();
  });
});
