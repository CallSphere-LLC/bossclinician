import addressparser from "nodemailer/lib/addressparser";

/**
 * The staging send guard.
 *
 * Every send to an address that cannot receive mail is a hard bounce against the
 * SES account this product depends on, and hard-bounce rate is exactly the
 * metric that put a sibling account under a review that took months to clear.
 * Test fixtures, seed scripts and throwaway ZZ registrations on staging used to
 * mail `@example.com` — nine of them reached SES before this existed.
 *
 * So outside production nothing leaves unless the recipient is on an allow-list:
 * the SES mailbox simulator (which exists for exactly this and does not touch
 * reputation), the owner's real test inboxes, and whatever an operator adds in
 * `EMAIL_TEST_RECIPIENTS`.
 *
 * "Outside production" is decided by `APP_ENV`, not `NODE_ENV`: the staging
 * container runs `NODE_ENV=production` for the optimised build, so keying on it
 * would switch the guard off on the one host that needs it. And it fails safe —
 * a developer with no `APP_ENV` at all is guarded. Only an explicit
 * `APP_ENV=production` sends to anyone, and `EMAIL_RECIPIENT_GUARD=on` turns the
 * guard back on even there. There is deliberately no "off" switch.
 *
 * Called from the transports themselves (mailer.ts `sendMailStrict`, and the
 * Resend provider), which every send path reaches — transactional, marketing,
 * the settings screen's test button — so no caller can forget it. A refusal is
 * thrown, and each caller's existing failure handling writes the delivery-log row
 * as `failed` with this message: a refused send is never recorded as sent.
 */

/** Always allowed, whatever the environment adds. Domains are literal; `*` is honoured in the local part only. */
export const FIXED_TEST_RECIPIENTS: readonly string[] = [
  "*@simulator.amazonses.com",
  "sagar+*@callsphere.ai",
  "sagarshankaranm@gmail.com",
  "sagarshankaranusa@gmail.com",
];

export interface RecipientGuardEnv {
  APP_ENV?: string;
  EMAIL_RECIPIENT_GUARD?: string;
  EMAIL_TEST_RECIPIENTS?: string;
}

export class RecipientGuardError extends Error {
  readonly refused: string[];

  constructor(message: string, refused: string[]) {
    super(message);
    this.name = "RecipientGuardError";
    this.refused = refused;
  }
}

/** Whether the guard applies, and the environment name its log line reports. */
export function recipientGuardState(source: RecipientGuardEnv = process.env): {
  active: boolean;
  environment: string;
} {
  const appEnv = (source.APP_ENV ?? "").trim().toLowerCase();
  const forcedOn = (source.EMAIL_RECIPIENT_GUARD ?? "").trim().toLowerCase() === "on";
  if (appEnv === "production" && !forcedOn) return { active: false, environment: "production" };
  return { active: true, environment: appEnv || "non-production" };
}

/** One mailbox, nothing else: no display name, no list, no wildcard. */
const SINGLE_ADDRESS = /^[^@\s<>,;"()*]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/;

const escapeRegExp = (text: string): string => text.replace(/[.+?^${}()|[\]\\]/g, "\\$&");

/**
 * An allow-list entry as an anchored pattern, or null when it is not one.
 *
 * The domain must be literal. A wildcard there (`*@*.callsphere.ai`) is exactly
 * how a lookalike domain would get in, so such an entry is ignored rather than
 * widened.
 */
function patternFor(entry: string): RegExp | null {
  const normalised = entry.trim().toLowerCase();
  const at = normalised.indexOf("@");
  if (at <= 0 || at !== normalised.lastIndexOf("@")) return null;

  const local = normalised.slice(0, at);
  const domain = normalised.slice(at + 1);
  if (/[\s<>,;"()]/.test(local)) return null;
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) return null;

  const localPattern = local.split("*").map(escapeRegExp).join("[^@\\s]*");
  return new RegExp(`^${localPattern}@${escapeRegExp(domain)}$`);
}

const warnedEntries = new Set<string>();

function allowListPatterns(source: RecipientGuardEnv): RegExp[] {
  const configured = (source.EMAIL_TEST_RECIPIENTS ?? "").split(/[\s,;]+/).filter(Boolean);
  const patterns: RegExp[] = [];
  for (const entry of [...FIXED_TEST_RECIPIENTS, ...configured]) {
    const pattern = patternFor(entry);
    if (pattern) {
      patterns.push(pattern);
    } else if (!warnedEntries.has(entry)) {
      warnedEntries.add(entry);
      // eslint-disable-next-line no-console
      console.warn(`email guard: ignoring EMAIL_TEST_RECIPIENTS entry "${entry}" (not an address or local-part pattern)`);
    }
  }
  return patterns;
}

/** Whether one bare address is on the allow-list. Case-insensitive; anchored, so lookalike domains fail. */
export function isAllowListedRecipient(address: string, source: RecipientGuardEnv = process.env): boolean {
  const normalised = address.trim().toLowerCase();
  if (!SINGLE_ADDRESS.test(normalised)) return false;
  return allowListPatterns(source).some((pattern) => pattern.test(normalised));
}

/**
 * The recipients in a To field that are not allow-listed; empty when all are.
 *
 * Parsed with nodemailer's own address parser, the one its SMTP envelope is
 * built from, so the guard judges exactly the mailboxes the transport would
 * deliver to: `"sagar+x@callsphere.ai" <someone@else.com>` is judged on
 * `someone@else.com`, and a list is refused if any member of it is.
 */
export function refusedRecipients(to: string, source: RecipientGuardEnv = process.env): string[] {
  let parsed: { name: string; address: string }[];
  try {
    parsed = addressparser(to, { flatten: true });
  } catch {
    return [to];
  }
  if (parsed.length === 0) return [to];
  return parsed
    .filter((entry) => !entry.address || !isAllowListedRecipient(entry.address, source))
    .map((entry) => entry.address || entry.name || to);
}

/**
 * Throws a RecipientGuardError, after logging it, when this send must not go.
 * A no-op in production (unless forced on).
 */
export function assertRecipientAllowed(to: string, source: RecipientGuardEnv = process.env): void {
  const state = recipientGuardState(source);
  if (!state.active) return;

  const refused = refusedRecipients(to, source);
  if (refused.length === 0) return;

  const message = `email guard: refused send to ${refused.join(", ")} (not allow-listed in ${state.environment})`;
  // eslint-disable-next-line no-console
  console.warn(message);
  throw new RecipientGuardError(message, refused);
}
