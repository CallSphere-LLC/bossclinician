/**
 * The frame every account email arrives in.
 *
 * The templates write plain paragraphs — a greeting, a sentence, a link, a
 * sign-off — which is the right thing for them to own, and which used to be the
 * whole email: black Times on white with a blue underlined link. This puts that
 * copy inside the brand instead: the wordmark, a white card on a warm ground, a
 * gold button where a paragraph is nothing but a link, the signature set apart,
 * and a quiet footer.
 *
 * Email rules, not web rules. Tables for layout, inline styles for everything
 * that matters (Gmail strips <style> in some contexts and Outlook ignores most
 * of it), web-safe font stacks, no images to be blocked, no background images,
 * 600px. The <style> block only adds what is safe to lose: dark-mode hints and
 * the narrow-screen padding.
 *
 * A message that already brings its own document or layout table (receipts,
 * calendar invitations) is left exactly as it is.
 */

const INK = "#1e1828";
const BODY = "#4a4256";
const MUTED = "#8a8296";
const GOLD = "#b8915a";
const GOLD_DEEP = "#76501b";
const GROUND = "#f6f2ec";
const CARD = "#ffffff";
const HAIRLINE = "#e9e2d8";

const SERIF = "Georgia, 'Times New Roman', Times, serif";
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** True when the message already is a laid-out document and must not be framed again. */
export function isAlreadyLaidOut(html: string): boolean {
  return /<html[\s>]|<body[\s>]|<table[\s>]|data-bc-shell/i.test(html);
}

/**
 * A paragraph that holds one link and nothing else is the action of the email.
 * The anchor keeps its href and label; only its presentation changes.
 */
export function promoteLoneLinks(html: string): string {
  return html.replace(
    /<p>\s*<a\s+href="([^"]+)"\s*>([^<]+)<\/a>\s*<\/p>/gi,
    (_match, href: string, label: string) =>
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 28px;">` +
      `<tr><td align="center" bgcolor="${GOLD}" style="border-radius:999px;background-color:${GOLD};` +
      `background-image:linear-gradient(135deg,#a9824b 0%,#e2c48c 50%,#a9824b 100%);">` +
      `<a href="${href}" style="display:inline-block;padding:15px 34px;font-family:${SANS};font-size:13px;` +
      `font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#1a1208;text-decoration:none;` +
      `border-radius:999px;">${label}</a></td></tr></table>`,
  );
}

/** Body paragraphs, the sign-off, and any remaining inline links, styled inline. */
export function styleBody(html: string): string {
  return html
    .replace(
      /<p>(\s*(?:—|&mdash;|--)\s*[^<]{1,60})<\/p>/gi,
      (_m, signature: string) =>
        `<p style="margin:30px 0 0;padding-top:22px;border-top:1px solid ${HAIRLINE};font-family:${SERIF};` +
        `font-size:18px;font-style:italic;line-height:1.5;color:${GOLD_DEEP};">${signature.trim()}</p>`,
    )
    .replace(
      /<p>/gi,
      `<p style="margin:0 0 18px;font-family:${SANS};font-size:16px;line-height:1.7;color:${BODY};">`,
    )
    .replace(/<a\s+href="([^"]+)"\s*>/gi, (_m, href: string) => `<a href="${href}" style="color:${GOLD_DEEP};">`)
    .replace(
      /<(ul|ol)>/gi,
      (_m, tag: string) =>
        `<${tag} style="margin:0 0 18px;padding-left:22px;font-family:${SANS};font-size:16px;line-height:1.7;color:${BODY};">`,
    );
}

/** The first sentence of the copy, for the inbox preview line. */
export function preheaderFrom(text: string): string {
  const line = text
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find((part) => part.length > 0 && !/^(hi|hello|dear)\b/i.test(part) && !/^https?:\/\//i.test(part));
  return (line ?? "").slice(0, 140);
}

export interface BrandShellInput {
  html: string;
  subject: string;
  /** The plain-text body; its first real sentence becomes the preview line. */
  text?: string;
  /** Falls back to the production origin, so a caller with a thin env still sends. */
  siteUrl?: string;
}

export function brandEmailHtml(input: BrandShellInput): string {
  if (isAlreadyLaidOut(input.html)) return input.html;

  const site = (input.siteUrl || "https://bossclinician.callsphere.site").replace(/\/+$/, "");
  const host = site.replace(/^https?:\/\//i, "");
  const body = styleBody(promoteLoneLinks(input.html));
  const preheader = escapeText(preheaderFrom(input.text ?? ""));

  return `<!doctype html>
<html lang="en" data-bc-shell="1">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeText(input.subject)}</title>
<style>
  @media only screen and (max-width: 620px) {
    .bc-card { padding: 30px 24px 28px !important; }
    .bc-outer { padding: 20px 12px 28px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:${GROUND};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${GROUND}" style="background-color:${GROUND};">
<tr><td align="center" class="bc-outer" style="padding:36px 16px 40px;">

  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
    <tr><td align="center" style="padding:0 0 24px;">
      <a href="${escapeAttr(site)}" style="text-decoration:none;">
        <span style="font-family:${SERIF};font-size:27px;font-weight:700;letter-spacing:0.02em;color:${INK};">Boss <span style="font-style:italic;color:${GOLD_DEEP};">Clinician</span></span><br>
        <span style="font-family:${SANS};font-size:10px;font-weight:700;letter-spacing:0.34em;text-transform:uppercase;color:${GOLD};">Lead. Heal. Elevate.</span>
      </a>
    </td></tr>

    <tr><td bgcolor="${CARD}" style="background-color:${CARD};border:1px solid ${HAIRLINE};border-radius:18px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr><td height="4" style="height:4px;line-height:4px;font-size:0;border-radius:18px 18px 0 0;background-color:${GOLD};background-image:linear-gradient(90deg,#a9824b,#e2c48c,#a9824b);">&nbsp;</td></tr>
        <tr><td class="bc-card" style="padding:40px 44px 38px;">
${body}
        </td></tr>
      </table>
    </td></tr>

    <tr><td align="center" style="padding:26px 20px 0;font-family:${SANS};font-size:12px;line-height:1.7;color:${MUTED};">
      You are receiving this because of your account at
      <a href="${escapeAttr(site)}" style="color:${MUTED};text-decoration:underline;">${escapeText(host)}</a>.<br>
      Replies to this email reach a real person.
      <div style="padding-top:14px;font-family:${SERIF};font-size:13px;font-style:italic;color:${GOLD_DEEP};">Boss Clinician &middot; Private practice strategy for therapists</div>
    </td></tr>
  </table>

</td></tr>
</table>
</body>
</html>`;
}
