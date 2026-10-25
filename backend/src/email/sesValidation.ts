import { GetEmailAddressInsightsCommand, SESv2Client } from "@aws-sdk/client-sesv2";

/** SES SMTP passwords cannot sign API requests. Use the existing application IAM key,
 * scoped to ses:GetEmailAddressInsights; the S3 media role remains separate. */
const enabled = () => process.env.SES_VALIDATION_ENABLED === "true";
const keyId = () => process.env.AWS_ACCESS_KEY_ID || "";
const secret = () => process.env.AWS_SECRET_ACCESS_KEY || "";
const region = () => process.env.SES_VALIDATION_REGION || "us-east-1";
const MAX_DAILY_LOOKUPS = 2000;
const CACHE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_CACHE = 20000;

type Verdict = "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
export type EmailValidation = { accepted: boolean; verdict: Verdict; checked: boolean; reason?: string };
const cache = new Map<string, { value: EmailValidation; expires: number }>();
const inFlight = new Map<string, Promise<EmailValidation>>();
let day = "";
let dailyLookups = 0;
let client: SESv2Client | undefined;
let lastWarning = 0;

function warnOnce(message: string): void {
  if (Date.now() - lastWarning < 60 * 60 * 1000) return;
  lastWarning = Date.now();
  // Never put the address or AWS response into logs.
  console.warn(`[email-validation] ${message}`);
}

function sesClient(): SESv2Client {
  return client ??= new SESv2Client({
    region: region(),
    credentials: { accessKeyId: keyId(), secretAccessKey: secret() },
    maxAttempts: 1,
  });
}

/** Low confidence is refused; medium can be a legitimate protected mailbox. */
export function interpretInsights(input: {
  IsValid?: { ConfidenceVerdict?: string };
  Evaluations?: { HasValidSyntax?: { ConfidenceVerdict?: string }; HasValidDnsRecords?: { ConfidenceVerdict?: string } };
} | undefined): EmailValidation {
  const verdict = input?.IsValid?.ConfidenceVerdict;
  if (input?.Evaluations?.HasValidSyntax?.ConfidenceVerdict === "LOW")
    return { accepted: false, verdict: "LOW", checked: true, reason: "Please check the email address spelling." };
  if (input?.Evaluations?.HasValidDnsRecords?.ConfidenceVerdict === "LOW")
    return { accepted: false, verdict: "LOW", checked: true, reason: "This email domain cannot receive mail. Please check its spelling." };
  if (verdict === "LOW")
    return { accepted: false, verdict: "LOW", checked: true, reason: "This address is unlikely to receive email. Please check it or use another address." };
  if (verdict === "HIGH" || verdict === "MEDIUM")
    return { accepted: true, verdict, checked: true };
  // A missing/unknown verdict must not become a false refusal.
  return { accepted: true, verdict: "UNKNOWN", checked: false };
}

/** Called after local syntax checks and rate limits, before any public form write. */
export async function validateCollectedEmail(raw: string): Promise<EmailValidation> {
  const email = raw.trim().toLowerCase();
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return { accepted: false, verdict: "LOW", checked: false, reason: "Please enter a valid email address." };
  if (!enabled()) return { accepted: true, verdict: "UNKNOWN", checked: false };
  if (!keyId() || !secret()) {
    warnOnce("SES validation is enabled but API credentials are missing");
    return { accepted: true, verdict: "UNKNOWN", checked: false };
  }
  const cached = cache.get(email);
  if (cached && cached.expires > Date.now()) return cached.value;
  const ongoing = inFlight.get(email);
  if (ongoing) return ongoing;
  const today = new Date().toISOString().slice(0, 10);
  if (day !== today) { day = today; dailyLookups = 0; }
  if (dailyLookups >= MAX_DAILY_LOOKUPS) {
    warnOnce("daily SES validation lookup cap reached");
    return { accepted: true, verdict: "UNKNOWN", checked: false };
  }
  dailyLookups++;
  const lookup = (async () => {
    try {
      const result = await sesClient().send(new GetEmailAddressInsightsCommand({ EmailAddress: email }), { abortSignal: AbortSignal.timeout(3500) });
      const value = interpretInsights(result.MailboxValidation);
      if (value.checked) {
        if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value!);
        cache.set(email, { value, expires: Date.now() + CACHE_MS });
      }
      return value;
    } catch {
      warnOnce("SES validation lookup failed; check IAM permission, region and service health");
      return { accepted: true, verdict: "UNKNOWN", checked: false } as EmailValidation;
    } finally {
      inFlight.delete(email);
    }
  })();
  inFlight.set(email, lookup);
  return lookup;
}

/** Refuse a known bad recipient at the common transport boundary. */
export class InvalidEmailRecipientError extends Error {
  constructor(reason: string) { super(reason); this.name = "InvalidEmailRecipientError"; }
}

export async function assertDeliverableRecipient(email: string): Promise<void> {
  if (process.env.NODE_ENV !== "production") return;
  for (const recipient of email.split(/[;,]/).map((value) => value.trim()).filter(Boolean)) {
    const result = await validateCollectedEmail(recipient);
    if (!result.accepted) throw new InvalidEmailRecipientError(result.reason || "Email recipient failed validation");
  }
}