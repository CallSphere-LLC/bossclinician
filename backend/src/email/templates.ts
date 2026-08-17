/** Escapes HTML-significant characters so untrusted strings are safe to interpolate into email HTML. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function newLeadNotification(lead: {
  name: string;
  email: string;
  phone?: string | null;
  message?: string | null;
  source: string;
}): { subject: string; text: string; html: string } {
  const text = [
    `New lead submitted via "${lead.source}".`,
    ``,
    `Name: ${lead.name}`,
    `Email: ${lead.email}`,
    `Phone: ${lead.phone ?? "-"}`,
    `Message: ${lead.message ?? "-"}`,
  ].join("\n");

  const html = [
    `<p>New lead submitted via "${escapeHtml(lead.source)}".</p>`,
    `<p>`,
    `Name: ${escapeHtml(lead.name)}<br>`,
    `Email: ${escapeHtml(lead.email)}<br>`,
    `Phone: ${escapeHtml(lead.phone ?? "-")}<br>`,
    `Message: ${escapeHtml(lead.message ?? "-")}`,
    `</p>`,
  ].join("\n");

  return {
    subject: `New lead (${lead.source}): ${lead.name}`,
    text,
    html,
  };
}

export function subscriberWelcome(email: string): { subject: string; text: string; html: string } {
  const text = [
    `Hi there,`,
    ``,
    `Thanks for subscribing (${email}). You'll be the first to hear about new trainings, resources, and the free masterclass.`,
    ``,
    `— Yvette`,
  ].join("\n");

  const html = [
    `<p>Hi there,</p>`,
    `<p>Thanks for subscribing (${escapeHtml(email)}). You'll be the first to hear about new trainings, resources, and the free masterclass.</p>`,
    `<p>— Yvette</p>`,
  ].join("\n");

  return {
    subject: "You're in! Welcome to Boss Clinician",
    text,
    html,
  };
}

/** Titles the form's "full name" field routinely collects, dropped before greeting. */
const HONORIFIC = /^(dr|mr|mrs|ms|mx|miss|prof|professor)\.?$/i;

/**
 * A greeting name. First name only — the form asks for a full one, and
 * "Hi Dr. Jane Okafor," reads like a mail merge — but "Dr." is a title, not a
 * name, so the honorific is skipped rather than greeted.
 */
function greetingName(name: string): string {
  const parts = name.trim().split(/\s+/).filter((part) => !HONORIFIC.test(part));
  return parts[0] || "there";
}

/**
 * The Income Calculator's results, sent to the visitor who asked for them.
 *
 * The capture band on /resource-hub promises "this projection to your inbox
 * with the pricing math behind it", so the arithmetic is written out rather
 * than just the total — the number on its own is what they already saw.
 */
export function incomeProjection(projection: {
  name: string;
  sessionRate: number;
  clientsPerWeek: number;
  weeksPerYear: number;
  annualIncome: number;
  monthlyIncome: number;
}): { subject: string; text: string; html: string } {
  const money = (value: number) => `$${Math.round(value).toLocaleString("en-US")}`;
  const firstName = greetingName(projection.name);
  const annual = money(projection.annualIncome);
  const clientWord = projection.clientsPerWeek === 1 ? "client" : "clients";
  const math = `${projection.clientsPerWeek} ${clientWord}/week × ${money(
    projection.sessionRate,
  )}/session × ${projection.weeksPerYear} weeks`;

  const text = [
    `Hi ${firstName},`,
    ``,
    `Here's the projection you ran on the Boss Clinician income calculator:`,
    ``,
    `Annual: ${annual}`,
    `Monthly: ${money(projection.monthlyIncome)}`,
    ``,
    `The math behind it: ${math}.`,
    `That's ${projection.clientsPerWeek * projection.weeksPerYear} sessions a year.`,
    ``,
    `Change one number and the whole picture moves — raising your rate by $25 a session adds ${money(
      25 * projection.clientsPerWeek * projection.weeksPerYear,
    )} a year without a single extra client.`,
    ``,
    `Reply to this email if you want to talk through what it would take to get there.`,
    ``,
    `— Yvette`,
  ].join("\n");

  const html = [
    `<p>Hi ${escapeHtml(firstName)},</p>`,
    `<p>Here's the projection you ran on the Boss Clinician income calculator:</p>`,
    `<p>`,
    `Annual: <strong>${escapeHtml(annual)}</strong><br>`,
    `Monthly: ${escapeHtml(money(projection.monthlyIncome))}`,
    `</p>`,
    `<p>The math behind it: ${escapeHtml(math)}. That's ${
      projection.clientsPerWeek * projection.weeksPerYear
    } sessions a year.</p>`,
    `<p>Change one number and the whole picture moves — raising your rate by $25 a session adds ${escapeHtml(
      money(25 * projection.clientsPerWeek * projection.weeksPerYear),
    )} a year without a single extra client.</p>`,
    `<p>Reply to this email if you want to talk through what it would take to get there.</p>`,
    `<p>— Yvette</p>`,
  ].join("\n");

  return { subject: `Your ${annual} projection`, text, html };
}

export function orderPaidNotification(order: {
  courseTitle: string;
  email: string;
  amountCents: number;
  currency: string;
}): { subject: string; text: string; html: string } {
  const amount = `${(order.amountCents / 100).toFixed(2)} ${order.currency.toUpperCase()}`;

  const text = [
    `New purchase.`,
    ``,
    `Course: ${order.courseTitle}`,
    `Buyer: ${order.email || "(no email captured)"}`,
    `Amount: ${amount}`,
  ].join("\n");

  const html = [
    `<p>New purchase.</p>`,
    `<p>`,
    `Course: ${escapeHtml(order.courseTitle)}<br>`,
    `Buyer: ${escapeHtml(order.email || "(no email captured)")}<br>`,
    `Amount: ${escapeHtml(amount)}`,
    `</p>`,
  ].join("\n");

  return { subject: `Purchase: ${order.courseTitle}`, text, html };
}
