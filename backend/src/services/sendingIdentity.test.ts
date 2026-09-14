import { describe, expect, it } from "vitest";
import {
  SendingIdentityError,
  describeTransport,
  domainOf,
  identityFailureReason,
  isOnSendingDomain,
  marketingIdentityProblems,
  reviewSendingIdentity,
  sendingAddressProblem,
  sendingDomainsFrom,
  transportKeyForHost,
} from "./sendingIdentity";

/**
 * The state these cases pin is one a tester found on the live site: every field
 * of the sending identity blank, and the app saving it, reporting "Sent." and
 * logging the send as ARRIVED.
 *
 * Two of the three blanks are not cosmetic. A blank sending address falls
 * through to SMTP_FROM, so the owner's whole audience hears from an identity she
 * never chose and cannot see; a blank postal address produces a commercial email
 * with no postal address in it, which is illegal under CAN-SPAM. Both used to be
 * silent.
 */

const COMPLETE = {
  fromName: "Yvette at Boss Clinician",
  fromEmail: "yvette@bossclinician.callsphere.site",
  replyTo: "",
  address: "Boss Clinician, 100 Main St, Austin TX 78701",
  footer: "",
};

const SES_ENV = {
  smtpFrom: "Yvette <yvette@bossclinician.callsphere.site>",
  smtpHost: "email-smtp.us-east-1.amazonaws.com",
  transactionalConfigSet: "bossclinician-transactional",
  marketingConfigSet: "bossclinician-marketing",
  smtpConfigured: true,
  hasResendKey: false,
  verifiedDomains: ["bossclinician.callsphere.site"],
};

describe("marketingIdentityProblems", () => {
  it("names all three missing fields on the live site's blank identity", () => {
    const problems = marketingIdentityProblems({ fromName: "", fromEmail: "", address: "" });

    expect(problems.map((p) => p.label)).toEqual([
      "Sent from",
      "Name in the inbox",
      "Your postal address",
    ]);
  });

  it("refuses a from-address that is not an address", () => {
    const problems = marketingIdentityProblems({
      fromName: "Yvette",
      fromEmail: "yvette at bossclinician.com",
      address: "100 Main St",
    });

    expect(problems).toHaveLength(1);
    expect(problems[0].field).toBe("fromEmail");
  });

  it("treats the postal address as required in its own right", () => {
    // The one that matters legally, and the one nothing used to check: the
    // compliance footer in email/provider.ts is built from this field alone.
    const problems = marketingIdentityProblems({
      fromName: "Yvette",
      fromEmail: "hello@bossclinician.com",
      address: "   ",
    });

    expect(problems.map((p) => p.field)).toEqual(["address"]);
    expect(problems[0].message).toContain("CAN-SPAM");
  });

  it("passes a complete identity", () => {
    expect(marketingIdentityProblems(COMPLETE)).toEqual([]);
  });
});

describe("reviewSendingIdentity", () => {
  it("blocks marketing but not transactional while the identity is blank", () => {
    const report = reviewSendingIdentity({
      marketing: { fromName: "", fromEmail: "", replyTo: "", address: "", footer: "" },
      provider: { provider: "smtp", hasWebhookSecret: false },
      env: SES_ENV,
    });

    expect(report.ready).toBe(false);
    // Transactional mail keeps working deliberately: email confirmation gates
    // posting, commenting and points, so refusing a confirmation link because
    // the marketing footer is empty would lock every member out for good.
    expect(report.transactionalReady).toBe(true);
    expect(report.transactionalFrom).toBe(SES_ENV.smtpFrom);
    expect(report.marketingFrom).toBe("");
    expect(report.summary).toContain("can't be sent yet");
  });

  it("reports the transport actually in use, whatever the stored row says (E5)", () => {
    // The live site: the row said "Your own mail server" while SMTP_HOST pointed
    // at Amazon SES and the delivery log was full of SES message ids.
    const report = reviewSendingIdentity({
      marketing: COMPLETE,
      provider: { provider: "smtp", hasWebhookSecret: false },
      env: SES_ENV,
    });

    expect(report.ready).toBe(true);
    expect(report.transport).toMatchObject({
      key: "ses",
      label: "Amazon SES",
      source: "server",
      locked: true,
    });
    expect(report.transport.detail).toContain("email-smtp.us-east-1.amazonaws.com");
    expect(report.transport.choices.map((c) => c.value)).toEqual(["ses"]);
    // Nothing tells her to go and change a dropdown that changes nothing.
    expect(report.warnings.map((w) => w.field)).not.toContain("provider");
  });

  it("does not warn about a signing secret SES never uses, but does for Resend", () => {
    // SES reports arrive through SNS and are proved against Amazon's certificate.
    const ses = reviewSendingIdentity({
      marketing: COMPLETE,
      provider: { provider: "ses", hasWebhookSecret: false },
      env: SES_ENV,
    });
    const resend = reviewSendingIdentity({
      marketing: COMPLETE,
      provider: { provider: "resend", hasWebhookSecret: false },
      env: { ...SES_ENV, hasResendKey: true },
    });

    expect(ses.warnings).toEqual([]);
    expect(ses.summary).toBe("Ready to send.");
    expect(resend.transport.key).toBe("resend");
    expect(resend.warnings.map((w) => w.field)).toEqual(["webhookSecret"]);
  });

  it("refuses marketing from an address off the verified sending domain (E4)", () => {
    const report = reviewSendingIdentity({
      marketing: { ...COMPLETE, fromEmail: "yvette@bossclinician.com" },
      provider: { provider: "ses", hasWebhookSecret: false },
      env: SES_ENV,
    });

    expect(report.ready).toBe(false);
    expect(report.problems).toHaveLength(1);
    expect(report.problems[0]).toMatchObject({ field: "fromEmail", code: "unverified_domain" });
    expect(report.problems[0].message).toContain("@bossclinician.callsphere.site");
    expect(report.verifiedDomains).toEqual(["bossclinician.callsphere.site"]);
  });

  it("says which address transactional mail is going out as while marketing is refused", () => {
    const report = reviewSendingIdentity({
      marketing: { fromName: "", fromEmail: "", replyTo: "", address: "", footer: "" },
      provider: { provider: "ses", hasWebhookSecret: true },
      env: SES_ENV,
    });

    const fallback = report.warnings.find((w) => w.message.includes("Receipts"));
    expect(fallback?.message).toContain("yvette@bossclinician.callsphere.site");
  });

  it("reports a build with no mail server at all as delivering nothing", () => {
    const report = reviewSendingIdentity({
      marketing: COMPLETE,
      provider: { provider: "smtp", hasWebhookSecret: true },
      env: { smtpFrom: "Boss <no-reply@example.com>", smtpHost: "", transactionalConfigSet: "", marketingConfigSet: "" },
    });

    expect(report.warnings.map((w) => w.field)).toContain("smtpHost");
    expect(report.ready).toBe(true);
  });
});

describe("SendingIdentityError", () => {
  it("is a 400 that names the fields, for the screen and for the log", () => {
    const problems = marketingIdentityProblems({ fromName: "", fromEmail: "", address: "" });
    const error = new SendingIdentityError(problems);

    expect(error.status).toBe(400);
    expect(error.message).toContain("Sent from, Name in the inbox, Your postal address");
    expect(error.message).toContain("Settings → Email");
    expect(error.details).toMatchObject({
      fields: ["Sent from", "Name in the inbox", "Your postal address"],
    });
    expect(identityFailureReason(problems)).toBe(
      "sending identity incomplete: Sent from, Name in the inbox, Your postal address"
    );
  });

  it("names the address, not a missing field, when the domain is the problem", () => {
    const problems = marketingIdentityProblems(
      { fromName: "Yvette", fromEmail: "yvette@bossclinician.com", address: "100 Main St" },
      { verifiedDomains: ["bossclinician.callsphere.site"] }
    );
    const error = new SendingIdentityError(problems);

    expect(error.message).not.toContain("isn't finished");
    expect(error.message).toContain("yvette@bossclinician.com");
    expect(identityFailureReason(problems)).toBe(
      "sending address not on a verified sending domain: yvette@bossclinician.com"
    );
  });
});

describe("sending domains (E4)", () => {
  it("takes the verified domain from SMTP_FROM, plus SES_VERIFIED_DOMAINS", () => {
    expect(
      sendingDomainsFrom({
        smtpHost: "email-smtp.us-east-1.amazonaws.com",
        smtpFrom: "Yvette at Boss Clinician <yvette@bossclinician.callsphere.site>",
        extra: "",
      })
    ).toEqual(["bossclinician.callsphere.site"]);

    expect(
      sendingDomainsFrom({
        smtpHost: "email-smtp.us-east-1.amazonaws.com",
        smtpFrom: "yvette@bossclinician.callsphere.site",
        extra: " @Mail.Example.COM , not a domain, callsphere.site. ",
      })
    ).toEqual(["bossclinician.callsphere.site", "mail.example.com", "callsphere.site"]);
  });

  it("trusts nothing from SMTP_FROM when no mail server is configured", () => {
    // env.ts defaults SMTP_FROM to a bossclinician.com address when it is unset.
    // That default is a placeholder, not a verified identity.
    expect(
      sendingDomainsFrom({ smtpHost: "", smtpFrom: "Boss <no-reply@bossclinician.com>", extra: "" })
    ).toEqual([]);
  });

  it("accepts the domain and its subdomains, and nothing that merely ends the same way", () => {
    const verified = ["bossclinician.callsphere.site"];
    expect(isOnSendingDomain("yvette@bossclinician.callsphere.site", verified)).toBe(true);
    expect(isOnSendingDomain("Yvette@BossClinician.CallSphere.site", verified)).toBe(true);
    expect(isOnSendingDomain("news@mail.bossclinician.callsphere.site", verified)).toBe(true);
    expect(isOnSendingDomain("yvette@bossclinician.com", verified)).toBe(false);
    expect(isOnSendingDomain("x@evilbossclinician.callsphere.site", verified)).toBe(false);
    expect(isOnSendingDomain("anyone@anywhere.test", [])).toBe(true);
  });

  it("leaves blank and malformed addresses to their own clearer messages", () => {
    const verified = ["bossclinician.callsphere.site"];
    expect(sendingAddressProblem("", verified)).toBeNull();
    expect(sendingAddressProblem("yvette at bossclinician.com", verified)).toBeNull();
    expect(sendingAddressProblem("yvette@bossclinician.callsphere.site", verified)).toBeNull();
    expect(sendingAddressProblem("yvette@bossclinician.com", verified)?.code).toBe("unverified_domain");
  });

  it("reads the domain out of a header or a bare address", () => {
    expect(domainOf("Yvette at Boss Clinician <yvette@bossclinician.callsphere.site>")).toBe(
      "bossclinician.callsphere.site"
    );
    expect(domainOf("hello@Example.com.")).toBe("example.com");
    expect(domainOf("no address here")).toBe("");
  });
});

describe("describeTransport (E5)", () => {
  it("recognises Amazon's SMTP interface as SES", () => {
    // The old check only matched *.amazonses.com, which is not the SMTP host.
    expect(transportKeyForHost("email-smtp.us-east-1.amazonaws.com")).toBe("ses");
    expect(transportKeyForHost("smtp.gmail.com")).toBe("smtp");
    expect(transportKeyForHost("")).toBe("console");
  });

  it("is locked to the server's transport when there is nothing else it could be", () => {
    const transport = describeTransport({
      storedProvider: "smtp",
      smtpHost: "email-smtp.us-east-1.amazonaws.com",
      smtpConfigured: true,
      hasResendKey: false,
    });
    expect(transport).toMatchObject({ key: "ses", source: "server", locked: true });
    expect(transport.detail).toContain("can't be changed from this screen");
  });

  it("follows the stored choice only where resolveProvider would, which is Resend with a key", () => {
    const withKey = describeTransport({
      storedProvider: "resend",
      smtpHost: "email-smtp.us-east-1.amazonaws.com",
      smtpConfigured: true,
      hasResendKey: true,
    });
    const withoutKey = describeTransport({
      storedProvider: "resend",
      smtpHost: "email-smtp.us-east-1.amazonaws.com",
      smtpConfigured: true,
      hasResendKey: false,
    });

    expect(withKey).toMatchObject({ key: "resend", source: "settings", locked: false });
    expect(withKey.choices.map((c) => c.value)).toEqual(["ses", "resend"]);
    // Without a key resolveProvider falls back to SMTP, so the screen must too.
    expect(withoutKey).toMatchObject({ key: "ses", locked: true });
  });

  it("says nothing is delivered when the host is set but the credentials are not", () => {
    const transport = describeTransport({
      storedProvider: "ses",
      smtpHost: "email-smtp.us-east-1.amazonaws.com",
      smtpConfigured: false,
      hasResendKey: false,
    });
    expect(transport.key).toBe("console");
  });
});
