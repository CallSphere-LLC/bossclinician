import dns from "dns/promises";
import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest } from "../../utils/httpError";
import { requirePermission } from "../../services/permissions";
import { marketingSettings } from "../../email/provider";

/**
 * `/api/admin/sending-domain` — the guided custom sending domain check (3.9).
 *
 * This exists because of something read off real delivered mail: the app sends
 * as `yvette@bossclinician.callsphere.site`, the staging subdomain, while the
 * product it replaces sends from the customer's own domain. Moving that is a
 * DNS task rather than a provider one — SES is already wired and
 * authenticating — so what was missing was a way to SEE whether the DNS is
 * right, from the app, without asking someone to run `dig`.
 *
 * The checks are performed live against public DNS every time. Caching the
 * verdict would mean showing "verified" for a record somebody deleted an hour
 * ago, which is exactly the state that quietly destroys a sending reputation.
 *
 * Read-only. It changes nothing and publishes nothing; it reports what the
 * resolver says and what the record ought to look like.
 */
export const adminSendingDomainRouter = Router();

interface CheckResult {
  name: string;
  /** What this record is for, in a sentence somebody can act on. */
  purpose: string;
  status: "pass" | "warn" | "fail";
  detail: string;
  /** What was found, so a near-miss is visible rather than just "fail". */
  found: string[];
  /** What it should say, for copying into a DNS panel. */
  expected: string;
}

const SES_REGION = "us-east-1";

async function txt(host: string): Promise<string[]> {
  try {
    const records = await dns.resolveTxt(host);
    // Long TXT values arrive split into 255-character chunks; joining is what
    // makes a DKIM or DMARC value comparable to what was published.
    return records.map((chunks) => chunks.join(""));
  } catch {
    return [];
  }
}

async function cname(host: string): Promise<string[]> {
  try {
    return await dns.resolveCname(host);
  } catch {
    return [];
  }
}

/** SPF: does the domain authorise Amazon SES to send for it? */
async function checkSpf(domain: string): Promise<CheckResult> {
  const found = (await txt(domain)).filter((value) => value.toLowerCase().startsWith("v=spf1"));
  const expected = `v=spf1 include:amazonses.com ~all`;

  if (found.length === 0) {
    return {
      name: "SPF",
      purpose: "Tells the world that Amazon SES is allowed to send email as you.",
      status: "fail",
      detail: "No SPF record found on this domain.",
      found,
      expected,
    };
  }
  if (found.length > 1) {
    // More than one SPF record is a hard failure at the receiver, not a
    // warning: the spec says a domain has exactly one, and most receivers
    // treat two as permerror and fall back to failing the check.
    return {
      name: "SPF",
      purpose: "Tells the world that Amazon SES is allowed to send email as you.",
      status: "fail",
      detail:
        "There is more than one SPF record. Receivers treat that as an error — merge them into one.",
      found,
      expected,
    };
  }
  const value = found[0];
  if (!/include:amazonses\.com/i.test(value)) {
    return {
      name: "SPF",
      purpose: "Tells the world that Amazon SES is allowed to send email as you.",
      status: "fail",
      detail: "An SPF record exists but does not include amazonses.com.",
      found,
      expected,
    };
  }
  return {
    name: "SPF",
    purpose: "Tells the world that Amazon SES is allowed to send email as you.",
    status: "pass",
    detail: "SES is authorised to send for this domain.",
    found,
    expected,
  };
}

/**
 * DKIM: are the three SES signing keys published?
 *
 * The selectors are account-specific, so this cannot guess them — what it can
 * do is tell whether ANY `_domainkey` delegation exists, and say plainly that
 * the three CNAMEs from the SES console are what belong there. A check that
 * invented selector names would report a false failure on a correctly
 * configured domain, which is worse than saying "we cannot see this from here".
 */
async function checkDkim(domain: string): Promise<CheckResult> {
  const expected = "Three CNAMEs of the form <token>._domainkey." + domain;
  const wildcard = await cname(`_domainkey.${domain}`);
  const anySigning = await txt(`_domainkey.${domain}`);

  if (wildcard.length > 0 || anySigning.length > 0) {
    return {
      name: "DKIM",
      purpose: "Signs each email so receivers can prove it really came from you.",
      status: "pass",
      detail: "A signing record is published under _domainkey.",
      found: [...wildcard, ...anySigning],
      expected,
    };
  }
  return {
    name: "DKIM",
    purpose: "Signs each email so receivers can prove it really came from you.",
    status: "warn",
    detail:
      "We cannot confirm DKIM from here — SES gives each account its own three selector names, " +
      "so copy those three CNAMEs from the SES console and check them there.",
    found: [],
    expected,
  };
}

/** DMARC: is there a policy, and is it doing anything? */
async function checkDmarc(domain: string): Promise<CheckResult> {
  const found = (await txt(`_dmarc.${domain}`)).filter((v) =>
    v.toLowerCase().startsWith("v=dmarc1")
  );
  const expected = `v=DMARC1; p=quarantine; rua=mailto:dmarc@${domain}`;

  if (found.length === 0) {
    return {
      name: "DMARC",
      purpose: "Tells receivers what to do with mail that fails the checks above.",
      status: "fail",
      detail: "No DMARC record found.",
      found,
      expected,
    };
  }
  const policy = /p=([a-z]+)/i.exec(found[0])?.[1]?.toLowerCase() ?? "";
  if (policy === "none") {
    // Not a failure: p=none is the correct first step and it collects reports.
    // But it enforces nothing, so calling it "verified" would overstate it.
    return {
      name: "DMARC",
      purpose: "Tells receivers what to do with mail that fails the checks above.",
      status: "warn",
      detail:
        "DMARC is published but set to p=none, which only watches. Move to quarantine or reject " +
        "once the reports look clean.",
      found,
      expected,
    };
  }
  return {
    name: "DMARC",
    purpose: "Tells receivers what to do with mail that fails the checks above.",
    status: "pass",
    detail: `DMARC is enforcing (p=${policy}).`,
    found,
    expected,
  };
}

/** MAIL FROM: the custom bounce domain SES asks for, which aligns SPF. */
async function checkMailFrom(domain: string): Promise<CheckResult> {
  const host = `mail.${domain}`;
  const mx = await dns
    .resolveMx(host)
    .then((records) => records.map((r) => `${r.priority} ${r.exchange}`))
    .catch(() => [] as string[]);
  const expected = `MX 10 feedback-smtp.${SES_REGION}.amazonses.com, plus TXT "v=spf1 include:amazonses.com ~all"`;

  if (mx.length === 0) {
    return {
      name: "Custom MAIL FROM",
      purpose:
        "Optional, but it puts your own domain in the bounce address instead of Amazon's.",
      status: "warn",
      detail: `No MX record on ${host}. Email still authenticates without this.`,
      found: [],
      expected,
    };
  }
  return {
    name: "Custom MAIL FROM",
    purpose: "Puts your own domain in the bounce address instead of Amazon's.",
    status: mx.some((r) => /amazonses\.com$/i.test(r)) ? "pass" : "warn",
    detail: mx.some((r) => /amazonses\.com$/i.test(r))
      ? "Bounces are handled on your own domain."
      : `${host} has an MX record, but not the SES one.`,
    found: mx,
    expected,
  };
}

const querySchema = z.object({
  /** Omitted, the domain is taken from the configured sending address. */
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .max(253)
    .regex(/^[a-z0-9.-]+$/, "That doesn't look like a domain name.")
    .optional(),
});

/**
 * GET /api/admin/sending-domain
 *
 * Checks the domain the site actually sends from, or one passed in so a move
 * can be checked BEFORE the from-address is switched over — which is the order
 * anybody sane does it in.
 */
adminSendingDomainRouter.get(
  "/",
  requirePermission("settings.view"),
  asyncHandler(async (req, res) => {
    const parsed = querySchema.safeParse(req.query ?? {});
    if (!parsed.success) throw badRequest("That doesn't look like a domain name.");

    const marketing = await marketingSettings();
    const configured = marketing.fromEmail.split("@")[1] ?? "";
    const domain = parsed.data.domain || configured;

    if (!domain) {
      throw badRequest(
        "Set the address your email comes from first, or pass a domain to check."
      );
    }

    const checks = await Promise.all([
      checkSpf(domain),
      checkDkim(domain),
      checkDmarc(domain),
      checkMailFrom(domain),
    ]);

    // "Ready" means nothing is failing. A warn is a thing worth doing, not a
    // thing that stops mail authenticating, and conflating the two would leave
    // this screen permanently red over an optional bounce domain.
    const failing = checks.filter((c) => c.status === "fail");
    const warning = checks.filter((c) => c.status === "warn");

    res.json({
      domain,
      configuredDomain: configured,
      /** True when this is the domain the site is actually sending from. */
      isCurrent: configured !== "" && configured === domain,
      ready: failing.length === 0,
      summary:
        failing.length > 0
          ? `${failing.length} record${failing.length === 1 ? "" : "s"} still to fix.`
          : warning.length > 0
            ? "Authenticating. A couple of optional records are worth adding."
            : "Fully authenticated.",
      checks,
    });
  })
);
