import crypto from "crypto";
import { env } from "../config/env";

/**
 * Short-lived signed links to a member's receipt PDF.
 *
 * Why a link at all: member requests authenticate with a Bearer token held in
 * memory, and the refresh cookie is scoped to /api/auth. A browser following an
 * ordinary `<a href>` or a `location` change sends neither, so the one way to
 * let the browser download the PDF natively — `Content-Disposition: attachment`
 * on a plain navigation, no blob, no popup — is to put the credential in the URL
 * for a few minutes. The member's own "Download PDF" asks for one of these with
 * their token and then sends the tab to it.
 *
 * A separate token family from services/signedUrls.ts, derived under its own
 * `info` string: a receipt link presented to /api/files fails its signature, and
 * a file link presented here fails ours. Nothing in a receipt token can be
 * reinterpreted as a file id.
 *
 * What the link binds is the receipt (by order or by invoice) and the member it
 * was minted for. Delivery re-proves ownership with that member's scope, so a
 * receipt the member no longer owns — or an account suspended in the meantime —
 * is refused even inside the lifetime.
 */

const RECEIPT_LINK_INFO = "bossclinician/receipt-link/v1";

/** Bumped if the payload layout changes, so old tokens fail closed. */
const VERSION = "r1";

/** Long enough for the click to reach the download, short enough to be dead if pasted. */
export const RECEIPT_LINK_TTL_SECONDS = 5 * 60;

/** Where a receipt token is redeemed. Mounted by routes/public/receiptLink.ts. */
export const RECEIPT_LINK_ROUTE = "/api/receipts";

export type ReceiptLinkTarget = { orderId: number } | { invoiceId: number };

export interface ReceiptLinkPayload {
  target: ReceiptLinkTarget;
  memberId: number;
  /** Unix seconds. */
  expiresAt: number;
}

let signingKey: Buffer | null = null;

function key(): Buffer {
  if (signingKey === null) {
    signingKey = Buffer.from(
      crypto.hkdfSync(
        "sha256",
        Buffer.from(env.jwtSecret, "utf8"),
        Buffer.alloc(0),
        Buffer.from(RECEIPT_LINK_INFO, "utf8"),
        32
      )
    );
  }
  return signingKey;
}

function sign(body: string): string {
  return crypto.createHmac("sha256", key()).update(body).digest("base64url");
}

/** Mints a link for one receipt and one member. The caller has already proved ownership. */
export function signReceiptLink(input: {
  target: ReceiptLinkTarget;
  memberId: number;
  ttlSeconds?: number;
  now?: Date;
}): { url: string; token: string; expiresAt: Date } {
  const issuedAt = input.now ?? new Date();
  const expiresAt =
    Math.floor(issuedAt.getTime() / 1000) + (input.ttlSeconds ?? RECEIPT_LINK_TTL_SECONDS);
  const [kind, id] =
    "orderId" in input.target ? ["o", input.target.orderId] : ["i", input.target.invoiceId];

  const body = Buffer.from(
    [VERSION, kind, id, input.memberId, expiresAt].join("."),
    "utf8"
  ).toString("base64url");
  const token = `${body}.${sign(body)}`;

  return {
    url: `${RECEIPT_LINK_ROUTE}/${token}`,
    token,
    expiresAt: new Date(expiresAt * 1000),
  };
}

/** The payload of a token whose signature and expiry both hold, or null. */
export function verifyReceiptLink(token: string, now: Date = new Date()): ReceiptLinkPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, provided] = parts;
  if (!body || !provided) return null;

  const expected = sign(body);
  if (provided.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(provided, "utf8"), Buffer.from(expected, "utf8"))) {
    return null;
  }

  const fields = Buffer.from(body, "base64url").toString("utf8").split(".");
  if (fields.length !== 5) return null;
  const [version, kind, rawId, rawMember, rawExpires] = fields;
  if (version !== VERSION || (kind !== "o" && kind !== "i")) return null;

  const id = Number(rawId);
  const memberId = Number(rawMember);
  const expiresAt = Number(rawExpires);
  if (
    !Number.isSafeInteger(id) ||
    !Number.isSafeInteger(memberId) ||
    !Number.isSafeInteger(expiresAt) ||
    id <= 0 ||
    memberId <= 0
  ) {
    return null;
  }
  if (expiresAt * 1000 <= now.getTime()) return null;

  return {
    target: kind === "o" ? { orderId: id } : { invoiceId: id },
    memberId,
    expiresAt,
  };
}
