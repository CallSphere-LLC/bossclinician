import { formatAmount } from "../utils/money";
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

/** One line of a form reply as the owner reads it: the question, then the answer. */
export interface FormAnswerRow {
  label: string;
  value: string;
}

/**
 * The owner's copy of a form reply, with every answer on it.
 *
 * A lead from the contact form has always been emailed to her
 * (routes/public/leads.ts); a reply to a form built in the admin was filed and
 * then sat there until somebody happened to open Forms. For an application
 * like the Boardroom's — twenty-odd answers someone took real time over — the
 * email is the notification, so it carries the answers themselves rather than
 * a link to go and find them.
 *
 * Everything in it was typed by a stranger, so every label and answer is
 * escaped, and a long answer keeps its line breaks. The subject is squeezed to
 * one line: a name with a newline in it has no business in a mail header.
 */
export function formSubmissionNotification(reply: {
  formName: string;
  name: string;
  email: string;
  answers: FormAnswerRow[];
  /** The reply in the admin's Forms screen (migration 112). Optional so older callers still build. */
  adminUrl?: string;
}): { subject: string; text: string; html: string } {
  const who = (reply.name || reply.email).replace(/\s+/g, " ").trim().slice(0, 120);
  const formName = reply.formName.replace(/\s+/g, " ").trim();

  const text = [
    `${who} filled in "${formName}".`,
    ``,
    ...reply.answers.map((row) => `${row.label}: ${row.value}`),
    ``,
    ...(reply.adminUrl ? [`See every reply to this form: ${reply.adminUrl}`, ``] : []),
    `Reply to this email to write back to them.`,
  ].join("\n");

  const html = [
    `<p>${escapeHtml(who)} filled in "${escapeHtml(formName)}".</p>`,
    ...reply.answers.map(
      (row) =>
        `<p><strong>${escapeHtml(row.label)}:</strong> ${escapeHtml(row.value).replace(/\r?\n/g, "<br>")}</p>`,
    ),
    ...(reply.adminUrl
      ? [`<p><a href="${escapeHtml(reply.adminUrl)}">See every reply to this form</a></p>`]
      : []),
    `<p>Reply to this email to write back to them.</p>`,
  ].join("\n");

  return { subject: `New ${formName}: ${who}`, text, html };
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

/**
 * The owner's "someone bought this offer" email (services/ownerSaleNotification).
 *
 * Everything she would otherwise open the admin to find out: what sold, to
 * whom, for how much and on what plan, which coupon, and a link straight to
 * the purchase.
 */
export function ownerSaleNotification(sale: {
  offerTitle: string;
  buyerName: string;
  buyerEmail: string;
  /** What this order charged (the first installment on a plan), in cents. */
  amountCents: number;
  currency: string;
  /** "Payment plan: 3 payments of $1,250.00 every month"; '' to leave the line out. */
  plan: string;
  couponCode: string;
  giftRecipientEmail: string;
  adminUrl: string;
}): { subject: string; text: string; html: string } {
  const amount = formatAmount(sale.amountCents, sale.currency);
  const buyer = sale.buyerName
    ? `${sale.buyerName} <${sale.buyerEmail || "no email captured"}>`
    : sale.buyerEmail || "(no email captured)";

  const rows: [string, string][] = [
    ["Offer", sale.offerTitle],
    ["Buyer", buyer],
    ["Amount paid", amount],
  ];
  if (sale.plan) rows.push(["Plan", sale.plan]);
  if (sale.couponCode) rows.push(["Coupon", sale.couponCode]);
  if (sale.giftRecipientEmail) rows.push(["Gift for", sale.giftRecipientEmail]);

  const text = [
    `You made a sale.`,
    ``,
    ...rows.map(([label, value]) => `${label}: ${value}`),
    ``,
    `View the purchase: ${sale.adminUrl}`,
    ``,
    `You can turn these emails off, or send them somewhere else, per offer: Offers -> the offer -> Notifications.`,
  ].join("\n");

  const html = [
    `<p>You made a sale.</p>`,
    `<p>`,
    rows.map(([label, value]) => `<strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}`).join("<br>\n"),
    `</p>`,
    `<p><a href="${escapeHtml(sale.adminUrl)}">View the purchase</a></p>`,
    `<p style="color:#888;font-size:12px">You can turn these emails off, or send them somewhere else, per offer: Offers &rarr; the offer &rarr; Notifications.</p>`,
  ].join("\n");

  return { subject: `New sale: ${sale.offerTitle} (${amount})`, text, html };
}
