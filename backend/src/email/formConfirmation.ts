import { env } from "../config/env";
import { escapeHtml } from "./templates";

/**
 * The double opt-in email a form sends when `forms.double_opt_in` is set: one
 * link, which GET /api/forms/confirm/:token consumes (routes/public/growthPublic.ts).
 *
 * The link is absolute and carries the token as its last path segment, like
 * every other link this platform emails (see memberTemplates.ts). It goes to
 * the API rather than a page because the person is expecting a video, not a
 * form: the route confirms and redirects in one hop.
 */
export function formConfirmationLink(token: string): string {
  return `${env.publicSiteUrl}/api/forms/confirm/${encodeURIComponent(token)}`;
}

export function formConfirmationEmail(input: {
  firstName: string;
  formName: string;
  token: string;
  /** What the link leads to, in words: "the masterclass", "your download". */
  destination: string;
  validDays: number;
}): { subject: string; text: string; html: string } {
  const name = input.firstName.trim().split(/\s+/)[0] || "there";
  const url = formConfirmationLink(input.token);
  const window = input.validDays === 1 ? "the next day" : `${input.validDays} days`;

  const text = [
    `Hi ${name},`,
    ``,
    `One quick step: please confirm this is your email address and I'll take you straight to ${input.destination}.`,
    ``,
    url,
    ``,
    `The link works for ${window}. If you didn't sign up for ${input.formName} at Boss Clinician, you can ignore this email.`,
    ``,
    `— Yvette`,
  ].join("\n");

  const html = [
    `<p>Hi ${escapeHtml(name)},</p>`,
    `<p>One quick step: please confirm this is your email address and I'll take you straight to ${escapeHtml(input.destination)}.</p>`,
    `<p><a href="${escapeHtml(url)}">Confirm my email and watch</a></p>`,
    `<p>The link works for ${escapeHtml(window)}. If you didn't sign up for ${escapeHtml(input.formName)} at Boss Clinician, you can ignore this email.</p>`,
    `<p>— Yvette</p>`,
  ].join("\n");

  return { subject: `Confirm your email to watch ${input.formName}`, text, html };
}
