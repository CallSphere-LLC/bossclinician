import { HttpError } from "../utils/httpError";

/**
 * Who this site's email says it is from, and whether that is enough to send.
 *
 * This exists because of a state a tester found on the live site and the app
 * was perfectly happy with: "Name in the inbox" blank, "Sent from" blank, "Your
 * postal address" blank, no signing secret, and the sending service still set to
 * "Your own mail server" while the delivery log was full of real SES message
 * ids. Broadcasts reported "Sent." and were logged as ARRIVED.
 *
 * Two separate things were wrong with that, and only one of them is cosmetic.
 *
 * The first is that a marketing email with no physical postal address in it is
 * illegal in the United States (CAN-SPAM §7704(a)(5)), and the compliance block
 * in email/provider.ts builds that footer out of exactly these two settings —
 * so a blank `address` does not produce a warning, it produces a commercial
 * email that breaks the law, sent under a from-address nobody chose.
 *
 * The second is that a blank `fromEmail` does not stop a send: `fromHeader()`
 * silently falls back to SMTP_FROM. That fallback is right for a password reset
 * and wrong for a campaign — it means the owner's whole audience gets mail from
 * an identity she never configured and cannot see, which is why the settings
 * screen looked untouched while mail went out anyway.
 *
 * So the rule this module encodes: transactional mail may fall back to the
 * environment's identity, because a receipt or a confirmation link is worth
 * sending imperfectly and a member locked out of a confirmation email is worth
 * nothing at all. Marketing mail may not. It is refused, by name, until the
 * three fields that print in the reader's inbox are filled in.
 *
 * Everything here is a pure function over values that are passed in, so the
 * rules can be tested without a database or an SMTP server.
 */

/** One thing that is wrong, in the words the settings screen uses for it. */
export interface IdentityProblem {
  /** The `marketing_email` / `email_provider` field name, for highlighting. */
  field: string;
  /** The label on the settings screen, so the message names what she can see. */
  label: string;
  /** What is wrong and why it matters, in one sentence. */
  message: string;
  /**
   * Why it is wrong: blank, not an address, or an address on a domain this site
   * can't send from. Omitted means blank, which is what every older caller built.
   */
  code?: "missing" | "invalid" | "unverified_domain";
}

export interface SendingIdentityInput {
  /** The `marketing_email` setting. */
  marketing: { fromName: string; fromEmail: string; replyTo: string; address: string; footer: string };
  /** The `email_provider` setting, with the secret reduced to whether there is one. */
  provider: { provider: string; hasWebhookSecret: boolean };
  /** What the deployment itself provides, which is what transactional mail uses. */
  env: {
    smtpFrom: string;
    smtpHost: string;
    transactionalConfigSet: string;
    marketingConfigSet: string;
    /**
     * Whether nodemailer has a real server to talk to — host, user and password
     * all set, which is mailer.ts's own test. Omitted, "a host is set" stands in.
     */
    smtpConfigured?: boolean;
    /** Whether a Resend key exists: the one transport this screen can genuinely switch to. */
    hasResendKey?: boolean;
    /** The domains a from-address may be on. Empty means unknown here, and nothing is checked. */
    verifiedDomains?: string[];
  };
}

export interface SendingIdentityReport {
  /** True when a marketing email may go out. */
  ready: boolean;
  /** The transport that will actually carry the next message, and where that choice lives. */
  transport: TransportReport;
  /** The domains a marketing from-address has to be on — empty when this server can't know. */
  verifiedDomains: string[];
  /** True when a receipt or a confirmation link may go out. */
  transactionalReady: boolean;
  /** What a marketing email would say it came from right now, or "" if nothing. */
  marketingFrom: string;
  /** What a receipt says it came from — the settings value, or the environment's. */
  transactionalFrom: string;
  /** Blocking: a marketing send is refused while any of these stand. */
  problems: IdentityProblem[];
  /** Not blocking, but wrong or unsafe and invisible until somebody says so. */
  warnings: IdentityProblem[];
  /** One sentence for the top of the settings screen. */
  summary: string;
}

/**
 * Deliberately loose, and not the RFC.
 *
 * This is here to catch "Yvette", "yvette@" and "yvette at bossclinician.com" —
 * the shapes somebody actually types into a from-address box. A stricter grammar
 * would start rejecting real addresses, and the address is proved for real by
 * SES verifying the domain, not by a regex.
 */
const EMAIL_SHAPE = /^[^\s@,<>]+@[^\s@,<>.]+(\.[^\s@,<>.]+)+$/;

export function looksLikeEmail(value: string): boolean {
  return EMAIL_SHAPE.test(value.trim());
}

/** The from-header a message would carry: `Name <address>`, or just the address. */
export function fromHeaderFor(name: string, address: string): string {
  const trimmedAddress = address.trim();
  const trimmedName = name.trim();
  if (!trimmedAddress) return "";
  return trimmedName ? `${trimmedName} <${trimmedAddress}>` : trimmedAddress;
}

/**
 * The fields a marketing email cannot go out without.
 *
 * Three, and each for its own reason rather than for tidiness:
 *
 *   `fromEmail` — without it the send falls back to SMTP_FROM, so the audience
 *     hears from an address the owner never chose and cannot see. It is also
 *     what the sending-domain checker reads to know which domain to check, and
 *     what SES's verified-identity check is made against.
 *   `fromName` — the only thing most readers see before deciding this is spam.
 *     Blank means the inbox shows a bare address, which is what a phishing run
 *     looks like.
 *   `address` — a physical postal address is required by law in every
 *     commercial email, and the footer is built from this field alone.
 *
 * `replyTo` and `footer` are deliberately not here. A blank reply-to means
 * replies go to the sending address, which is a sane default rather than a
 * fault, and the footer sentence is a preference.
 */
export function marketingIdentityProblems(
  marketing: {
    fromName: string;
    fromEmail: string;
    address: string;
  },
  /**
   * The domains a from-address may be on (see `sendingDomainsFrom`). Omitted or
   * empty, the domain is not judged — which is the local build with no mail
   * server, where nothing is delivered anyway.
   */
  options: { verifiedDomains?: string[] } = {}
): IdentityProblem[] {
  const problems: IdentityProblem[] = [];
  const fromEmail = marketing.fromEmail.trim();
  const fromName = marketing.fromName.trim();
  const address = marketing.address.trim();

  if (!fromEmail) {
    problems.push({
      field: "fromEmail",
      label: "Sent from",
      code: "missing",
      message:
        "No sending address is set, so there is nothing to put in the From line of a marketing email.",
    });
  } else if (!looksLikeEmail(fromEmail)) {
    problems.push({
      field: "fromEmail",
      label: "Sent from",
      code: "invalid",
      message: `“${fromEmail}” isn't an email address, so nothing can be sent from it.`,
    });
  } else {
    // Well-formed is not the same as allowed. `yvette@bossclinician.com` is a
    // perfectly good address and is not a sending identity here.
    const offDomain = sendingAddressProblem(fromEmail, options.verifiedDomains ?? []);
    if (offDomain) problems.push(offDomain);
  }

  if (!fromName) {
    problems.push({
      field: "fromName",
      label: "Name in the inbox",
      message:
        "No sender name is set, so your emails arrive showing only a bare address — which is what people delete unread.",
    });
  }

  if (!address) {
    problems.push({
      field: "address",
      label: "Your postal address",
      message:
        "Marketing email must carry a real postal address at the bottom (CAN-SPAM). Until one is saved, sending is refused.",
    });
  }

  return problems;
}

/* --------------------------------------------------------- sending domains */

/** The domain of an address or a `Name <address>` header, lowercased; "" when there is none. */
export function domainOf(value: string): string {
  const inner = /<([^>]*)>/.exec(value)?.[1] ?? value;
  const at = inner.lastIndexOf("@");
  if (at < 0) return "";
  return inner
    .slice(at + 1)
    .trim()
    .replace(/\.$/, "")
    .toLowerCase();
}

/**
 * The domains this deployment may send marketing mail from.
 *
 * There are no AWS credentials on this server — it reaches SES over SMTP only —
 * so SES cannot be asked which identities are verified. What IS proven is the
 * domain transactional mail already goes out from: SMTP_FROM, which SES accepts
 * and receivers authenticate every day. That, plus anything the deployment names
 * in SES_VERIFIED_DOMAINS (comma-separated), is the list. A domain carries its
 * subdomains with it, which is how SES treats a verified domain identity.
 *
 * SMTP_FROM counts only when a mail server is configured. With no SMTP host
 * nothing is delivered anywhere, and env.ts's fallback SMTP_FROM is a
 * placeholder rather than a fact about any verified identity.
 */
export function sendingDomainsFrom(input: {
  smtpHost: string;
  smtpFrom: string;
  extra: string;
}): string[] {
  const domains = new Set<string>();
  if (input.smtpHost.trim()) {
    const fromDomain = domainOf(input.smtpFrom);
    if (fromDomain) domains.add(fromDomain);
  }
  for (const item of input.extra.split(",")) {
    const domain = item.trim().replace(/^@/, "").replace(/\.$/, "").toLowerCase();
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) domains.add(domain);
  }
  return [...domains];
}

/** Whether an address is on one of the domains, or on a subdomain of one. An empty list allows anything. */
export function isOnSendingDomain(address: string, verifiedDomains: string[]): boolean {
  if (verifiedDomains.length === 0) return true;
  const domain = domainOf(address);
  if (!domain) return false;
  return verifiedDomains.some((d) => domain === d || domain.endsWith(`.${d}`));
}

/**
 * The refusal for a from-address on a domain this site can't send from, or null.
 *
 * A check of its own, because a from-address can be perfectly well-formed and
 * still be a send that must not happen. `yvette@bossclinician.com` is the address
 * on the legal pages; it is not a sending identity here, and mail "from" it is
 * either refused by SES or arrives failing SPF and DKIM for a domain whose
 * reputation belongs to the real business.
 *
 * Blank and malformed addresses are not this function's business — they have
 * their own, clearer, messages in `marketingIdentityProblems`.
 */
export function sendingAddressProblem(
  address: string,
  verifiedDomains: string[]
): IdentityProblem | null {
  const trimmed = address.trim();
  if (!trimmed || !looksLikeEmail(trimmed) || isOnSendingDomain(trimmed, verifiedDomains)) {
    return null;
  }
  const allowed = verifiedDomains.map((d) => `@${d}`).join(" or ");
  return {
    field: "fromEmail",
    label: "Sent from",
    code: "unverified_domain",
    message:
      `“${trimmed}” is on ${domainOf(trimmed)}, which this site isn't verified to send from — ` +
      "the mail would be refused, or arrive failing the checks that prove it's really you. " +
      `Use an address ending in ${allowed}.`,
  };
}

/* ----------------------------------------------------------------- transport */

/** Whether an SMTP host is Amazon SES — its SMTP interface is `email-smtp.<region>.amazonaws.com`. */
export function isSesSmtpHost(host: string): boolean {
  const h = host.trim();
  return (
    /^email-smtp(-fips)?\.[a-z0-9-]+\.amazonaws\.com$/i.test(h) || /(^|\.)amazonses\.com$/i.test(h)
  );
}

/** The delivery-log name for the server's own transport. */
export function transportKeyForHost(host: string): "ses" | "smtp" | "console" {
  if (!host.trim()) return "console";
  return isSesSmtpHost(host) ? "ses" : "smtp";
}

export type TransportKey = "ses" | "smtp" | "resend" | "console";

export interface TransportReport {
  /** The service carrying mail right now — the same word the delivery log records. */
  key: TransportKey;
  label: string;
  /** "server" when the environment decides it; "settings" when this screen did. */
  source: "server" | "settings";
  /** True when nothing on the settings screen can change it. */
  locked: boolean;
  /** One sentence for under the field: where the choice lives and what would change it. */
  detail: string;
  /** Only the transports that can genuinely be chosen on this server. */
  choices: { value: TransportKey; label: string }[];
}

const TRANSPORT_LABEL: Record<TransportKey, string> = {
  ses: "Amazon SES",
  smtp: "Your own mail server",
  resend: "Resend",
  console: "Nothing — messages are only written to the server log",
};

/**
 * The transport that will actually carry the next message.
 *
 * Mirrors `resolveProvider()` in email/provider.ts rule for rule: Resend when it
 * is chosen AND a key exists, otherwise nodemailer, pointed wherever SMTP_HOST
 * says. The stored "Sending service" value used to be shown instead, and read
 * "Your own mail server" on a site whose delivery log was full of SES message
 * ids — a dropdown whose every option except one changed nothing at all.
 */
export function describeTransport(input: {
  storedProvider: string;
  smtpHost: string;
  smtpConfigured: boolean;
  hasResendKey: boolean;
}): TransportReport {
  const serverKey: TransportKey = input.smtpConfigured ? transportKeyForHost(input.smtpHost) : "console";
  const choices: TransportReport["choices"] = [
    { value: serverKey, label: `${TRANSPORT_LABEL[serverKey]} (set on the server)` },
  ];
  if (input.hasResendKey) choices.push({ value: "resend", label: TRANSPORT_LABEL.resend });

  if (input.storedProvider === "resend" && input.hasResendKey) {
    return {
      key: "resend",
      label: TRANSPORT_LABEL.resend,
      source: "settings",
      locked: false,
      detail: "Chosen here, using the Resend key this server has.",
      choices,
    };
  }

  const where = input.smtpHost.trim() ? ` (SMTP_HOST is ${input.smtpHost.trim()})` : "";
  return {
    key: serverKey,
    label: TRANSPORT_LABEL[serverKey],
    source: "server",
    locked: !input.hasResendKey,
    detail: input.hasResendKey
      ? `Set on the server${where}. You can switch to Resend here instead.`
      : `Set on the server${where}, so it can't be changed from this screen — changing it is a server change.`,
    choices,
  };
}

/**
 * The whole picture: what may be sent, what is missing, and what is merely lying.
 */
export function reviewSendingIdentity(input: SendingIdentityInput): SendingIdentityReport {
  const { marketing, provider, env } = input;
  const verifiedDomains = env.verifiedDomains ?? [];
  const problems = marketingIdentityProblems(marketing, { verifiedDomains });
  const warnings: IdentityProblem[] = [];

  const marketingFrom = fromHeaderFor(marketing.fromName, marketing.fromEmail);
  const transactionalFrom = marketingFrom || env.smtpFrom.trim();

  /*
   * The transport, as it actually is.
   *
   * The provider row said "Your own mail server" on a site whose delivery log is
   * full of SES ids. What used to stand here was a warning telling her to change
   * that dropdown to Amazon SES — which would have changed nothing, because the
   * transport is chosen from SMTP_HOST, and Postmark or SendGrid would have
   * changed nothing either. The screen now shows this report in the field itself
   * instead of the stored value, so there is nothing to warn about.
   */
  const transport = describeTransport({
    storedProvider: provider.provider,
    smtpHost: env.smtpHost,
    smtpConfigured: env.smtpConfigured ?? env.smtpHost.trim() !== "",
    hasResendKey: env.hasResendKey ?? false,
  });

  /*
   * Only a transport whose reports are signed with this secret needs it. SES
   * reports arrive through Amazon SNS, and routes/public/emailWebhook.ts proves
   * those against Amazon's own signing certificate — so on SES a blank box here
   * is correct, and warning about it was one more thing on this screen that was
   * not true.
   */
  if (!provider.hasWebhookSecret && transport.key === "resend") {
    warnings.push({
      field: "webhookSecret",
      label: "Signing secret from that service",
      message:
        "Nothing is saved, so delivery and bounce reports arriving from your sending service can't be " +
        "proved to have come from it.",
    });
  }

  if (transport.key === "console") {
    warnings.push({
      field: "smtpHost",
      label: "Mail server",
      message:
        "No mail server is configured on the server itself, so nothing is actually delivered — messages are written to the log.",
    });
  }

  if (problems.length > 0 && env.smtpFrom.trim()) {
    warnings.push({
      field: "fromEmail",
      label: "Sent from",
      message:
        `Receipts, password links and confirmation emails are still going out as “${env.smtpFrom.trim()}” — ` +
        "the address this server was set up with. Marketing email is refused until the fields above are filled in.",
    });
  }

  /*
   * Transactional readiness is a lower bar on purpose. Email confirmation gates
   * posting, commenting and every point a member can earn, so a member who
   * cannot receive a confirmation link cannot use the product at all. Refusing
   * that link because the marketing footer is blank would lock everybody out to
   * enforce a rule that does not apply to it.
   */
  const transactionalReady = transactionalFrom !== "";

  const summary =
    problems.length > 0
      ? `Marketing email can't be sent yet — ${problems.length} thing${
          problems.length === 1 ? "" : "s"
        } still to put right.`
      : warnings.length > 0
        ? "Ready to send. A couple of things are worth putting right."
        : "Ready to send.";

  return {
    ready: problems.length === 0,
    transport,
    verifiedDomains,
    transactionalReady,
    marketingFrom,
    transactionalFrom,
    problems,
    warnings,
    summary,
  };
}

/**
 * The refusal, as a 400 with the missing fields named.
 *
 * An HttpError subclass so that any route which sends inside a request — a test
 * send, a "send it now" button, an automation fired by hand — answers with the
 * specific sentence rather than a 500 saying "Internal server error". Jobs get
 * the same message written into `email_messages.error`, which is what the
 * delivery log shows.
 */
export class SendingIdentityError extends HttpError {
  readonly problems: IdentityProblem[];

  constructor(problems: IdentityProblem[]) {
    const unfinished = problems.filter((p) => p.code !== "unverified_domain");
    const offDomain = problems.filter((p) => p.code === "unverified_domain");
    const sentences: string[] = [];
    if (unfinished.length > 0) {
      sentences.push(
        `your sending identity isn't finished. Fill in ${unfinished
          .map((p) => p.label)
          .join(", ")} under Settings → Email.`
      );
    }
    for (const problem of offDomain) {
      sentences.push(`${problem.message} Change it under Settings → Email, or on the email itself.`);
    }
    super(400, `This email wasn't sent: ${sentences.join(" ")}`, {
      fields: problems.map((p) => p.label),
      problems,
    });
    this.problems = problems;
    this.name = "SendingIdentityError";
  }
}

/**
 * The one-line reason written to the delivery log, so the log says which field.
 *
 * The blank-identity wording is load-bearing — it is what the delivery log has
 * shown since this gate shipped, and what anybody checking a refused send reads
 * for — so a missing field still produces exactly
 * `sending identity incomplete: Sent from, Name in the inbox, Your postal address`.
 */
export function identityFailureReason(problems: IdentityProblem[]): string {
  const unfinished = problems.filter((p) => p.code !== "unverified_domain");
  const offDomain = problems.filter((p) => p.code === "unverified_domain");
  const parts: string[] = [];
  if (unfinished.length > 0) {
    parts.push(`sending identity incomplete: ${unfinished.map((p) => p.label).join(", ")}`);
  }
  for (const problem of offDomain) {
    const address = /“([^”]+)”/.exec(problem.message)?.[1] ?? problem.label;
    parts.push(`sending address not on a verified sending domain: ${address}`);
  }
  return parts.join("; ");
}
