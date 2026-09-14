import { pool } from "../db/pool";

/**
 * Who the business is, as it prints on a document a customer keeps.
 *
 * Lifted out of routes/member/billing.ts so the emailed PDF invoice and the
 * on-screen receipt cannot disagree about the seller's own name — two copies of
 * this reader is how a customer ends up with an invoice headed one way and a
 * receipt headed another for the same payment.
 *
 * Everything is read defensively. `settings` is free-form JSONB that Yvette
 * edits through a form, and a receipt that renders nothing because the address
 * arrived as a string where an object was expected is worse than one built from
 * whichever shape turned up.
 */

export interface BusinessDetails {
  name: string;
  addressLines: string[];
  email: string;
  /** EIN or VAT number. Empty means the line is left off entirely. */
  taxId: string;
  /**
   * Her own line at the foot of every receipt. Empty leaves it off. Optional so
   * a caller that builds details by hand (a test, a preview) need not invent one.
   */
  footerNote?: string;
  /**
   * The receipt logo as stored by the settings form: `/uploads/<file>`. Only
   * ever a reference — the bytes are read by `receiptLogo`, which decides
   * whether it is a file this server holds and a format both documents can draw.
   */
  logoUrl?: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 200) : "";
}

/** Builds the details from already-loaded `settings` rows. */
export function readBusinessDetails(rows: { key: string; value: unknown }[]): BusinessDetails {
  const byKey = new Map(rows.map((row) => [row.key, asRecord(row.value)]));
  const business = byKey.get("business") ?? {};
  const contact = byKey.get("contact") ?? {};

  const address = business.address;
  let lines: string[] = [];
  if (typeof address === "string") {
    lines = address.split(/\r?\n/);
  } else if (Array.isArray(address)) {
    lines = address.map(asText);
  } else {
    const parts = Object.keys(address ?? {}).length > 0 ? asRecord(address) : business;
    lines = [
      asText(parts.line1),
      asText(parts.line2),
      [asText(parts.city), asText(parts.state), asText(parts.postalCode) || asText(parts.zip)]
        .filter((part) => part !== "")
        .join(", "),
      asText(parts.country),
    ];
  }

  return {
    name: asText(business.name) || asText(contact.name) || "Boss Clinician",
    addressLines: lines.map((line) => asText(line)).filter((line) => line !== "").slice(0, 6),
    email: asText(business.email) || asText(contact.email),
    taxId: asText(business.taxId) || asText(business.taxNumber),
    // Longer than the other fields and allowed its line breaks: it is a note, not
    // a label. Capped so it cannot push the PDF's total onto a second page.
    footerNote:
      typeof business.footerNote === "string" ? business.footerNote.trim().slice(0, 500) : "",
    logoUrl: asText(business.logoUrl),
  };
}

/** The same, read straight from the database. */
export async function loadBusinessDetails(): Promise<BusinessDetails> {
  const rows = await pool.query<{ key: string; value: unknown }>(
    `SELECT key, value FROM settings WHERE key IN ('business', 'contact')`
  );
  return readBusinessDetails(rows.rows);
}
