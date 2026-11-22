/**
 * The last check before a sequence email leaves (Yvette, 22 Nov 2026, item 3;
 * migration 222): "Implementation placeholders should never appear in
 * customer emails."
 *
 * `renderTokens` quietly blanks a token it has no value for, so a template
 * that names a token nobody fills would go out with a hole where a price
 * should be. This finds that before rendering, and finds anything that still
 * looks like a placeholder or a team note after it. A non-empty answer means
 * "do not send"; the caller holds the email.
 *
 * Every token used by a live sequence email on 22 Nov 2026 (firstName,
 * first_name, clubBonusToken, clubBonusDeadline, the retreat links, the Lounge
 * blocks) is always given a value by the send path, so this changes nothing
 * for them; an empty first name is still fine.
 */

const TOKEN = /\{\{\s*([\w.]+)\s*\}\}/g;

/** Tokens that must have real text, never an empty string. */
export const REQUIRED_NON_EMPTY_TOKENS: readonly string[] = [
  "lounge_general_pricing_block",
  "lounge_vip_availability_block",
];

/** Wording that only ever belongs in a team note or a draft, never in a customer's inbox. */
const INTERNAL_NOTE =
  /\b(DO NOT SEND|TEAM IMPLEMENTATION NOTES?|IMPLEMENTATION NOTES?|IMPLEMENTATION PLACEHOLDERS?|INTERNAL NOTES?|PREVIEW NOTES?|PLACEHOLDER)\b/i;

/** The same alias `renderTokens` applies. */
function tokenKey(raw: string): string {
  return /^(firstname|first_name)$/i.test(raw) ? "firstName" : raw;
}

export function unresolvedTokens(templates: ReadonlyArray<string | null | undefined>, values: Record<string, string>): string[] {
  const missing = new Set<string>();
  for (const template of templates) {
    if (!template) continue;
    for (const match of template.matchAll(TOKEN)) {
      const key = tokenKey(match[1]);
      const value = values[key];
      if (value === undefined || (REQUIRED_NON_EMPTY_TOKENS.includes(key) && value.trim() === "")) missing.add(match[1]);
    }
  }
  return [...missing];
}

/** What is wrong with a rendered email, or '' when it is fit to send. */
export function renderedProblem(rendered: ReadonlyArray<string | null | undefined>): string {
  for (const text of rendered) {
    if (!text) continue;
    if (/\{\{|\}\}|\{%|%\}/.test(text)) return "placeholder left in the email";
    const note = INTERNAL_NOTE.exec(text);
    if (note) return `internal note in the email ("${note[0]}")`;
  }
  return "";
}

/**
 * The guard: '' to send, otherwise why not. `templates` are the stored
 * subject / preview / body; `rendered` the same after `renderTokens`.
 */
export function unsendableReason(
  templates: ReadonlyArray<string | null | undefined>,
  values: Record<string, string>,
  rendered: ReadonlyArray<string | null | undefined>
): string {
  const missing = unresolvedTokens(templates, values);
  if (missing.length > 0) return `unresolved placeholder: ${missing.map((t) => `{{${t}}}`).join(", ")}`;
  // A template note ("DO NOT SEND") is caught here too: it survives rendering.
  return renderedProblem(rendered);
}
