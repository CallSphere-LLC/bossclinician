import { pool } from "../db/pool";
import type { EmailContent } from "./memberTemplates";
import { renderMarkdown, renderTokens } from "./provider";

/**
 * The owner's own wording for an automatic email, when she has written one.
 *
 * `email_templates` has existed since Phase 5 and the admin has had a screen to
 * edit it, but nothing ever read the table — so every edit Yvette made on that
 * screen changed precisely nothing while telling her it had saved. This is the
 * reader that makes it true.
 *
 * The contract is the one the migration documented and the screen promises: a
 * row that is missing, switched off, or left blank falls back to the compiled-in
 * template. That is why every failure here returns null rather than throwing.
 * The worst an edit on that screen can do is return an email to its shipped
 * wording; it can never stop a receipt going out.
 */

export interface StoredTemplateTokens {
  [token: string]: string;
}

/**
 * The stored version of `key`, rendered with `tokens`, or null to use the
 * shipped template.
 *
 * A subject with no body — or a body with no subject — counts as unwritten. A
 * half-filled row is someone who started editing and navigated away, and
 * sending a blank-bodied receipt because of it would be a worse outcome than
 * ignoring the row.
 */
export async function storedTemplate(
  key: string,
  tokens: StoredTemplateTokens
): Promise<EmailContent | null> {
  try {
    const res = await pool.query<{ subject: string; body_md: string; enabled: boolean }>(
      `SELECT subject, body_md, enabled FROM email_templates WHERE key = $1`,
      [key]
    );
    const row = res.rows[0];
    if (!row || !row.enabled) return null;

    const subject = renderTokens(row.subject ?? "", tokens).trim();
    const body = renderTokens(row.body_md ?? "", tokens).trim();
    if (subject === "" || body === "") return null;

    return { subject, text: body, html: renderMarkdown(body) };
  } catch (err) {
    // A database hiccup while reading an optional override must not take down
    // the send it was only ever going to decorate.
    // eslint-disable-next-line no-console
    console.error(`[templateStore] could not read "${key}":`, (err as Error).message);
    return null;
  }
}

/**
 * The stored template if there is one, otherwise the one passed in.
 *
 * Written as a helper so a call site reads as one expression and nobody has to
 * remember which way round the fallback goes.
 */
export async function withStoredTemplate(
  key: string,
  tokens: StoredTemplateTokens,
  fallback: EmailContent
): Promise<EmailContent> {
  return (await storedTemplate(key, tokens)) ?? fallback;
}
