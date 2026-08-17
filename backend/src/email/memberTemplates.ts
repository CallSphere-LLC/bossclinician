import { env } from "../config/env";
import { escapeHtml } from "./templates";

/**
 * The account emails: the ones a member receives because of something they did
 * with their login, not because of anything they bought.
 *
 * Two rules hold across all five. Every link is absolute (an email client has
 * no origin to resolve a relative path against) and carries its token in the
 * query string, and every expiry is stated in words the reader can act on —
 * "this link works for the next hour" is the difference between someone
 * requesting a fresh link and someone emailing to ask why nothing happened.
 */

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

const HONORIFIC = /^(dr|mr|mrs|ms|mx|miss|prof|professor)\.?$/i;

/**
 * The signup form asks for a first name and a good number of clinicians type
 * "Dr. Jane" into it, so the title is skipped rather than greeted — "Hi Dr.,"
 * is worse than no personalisation at all.
 */
function greeting(firstName: string): string {
  const parts = firstName.trim().split(/\s+/).filter((part) => !HONORIFIC.test(part));
  return parts[0] || "there";
}

/** Absolute, and token-encoded: base64url is URL-safe, but the encode costs nothing and outlives the assumption. */
function link(path: string, token: string): string {
  return `${env.publicSiteUrl}${path}?token=${encodeURIComponent(token)}`;
}

function humanDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return hours === 1 ? "hour" : `${hours} hours`;
  const days = Math.round(hours / 24);
  return days === 1 ? "day" : `${days} days`;
}

/** "for the next hour" / "for the next 24 hours" — reads naturally either way. */
function validFor(minutes: number): string {
  const duration = humanDuration(minutes);
  return duration === "hour" || duration === "day" ? `the next ${duration}` : duration;
}

export interface TokenEmailInput {
  firstName: string;
  token: string;
  expiresInMinutes: number;
}

export function verifyEmail(input: TokenEmailInput): EmailContent {
  const name = greeting(input.firstName);
  const url = link("/verify-email", input.token);
  const window = validFor(input.expiresInMinutes);

  const text = [
    `Hi ${name},`,
    ``,
    `Please confirm this is your email address so I know where to reach you:`,
    ``,
    url,
    ``,
    `The link works for ${window}. If you didn't create an account at Boss Clinician, you can ignore this.`,
    ``,
    `— Yvette`,
  ].join("\n");

  const html = [
    `<p>Hi ${escapeHtml(name)},</p>`,
    `<p>Please confirm this is your email address so I know where to reach you:</p>`,
    `<p><a href="${escapeHtml(url)}">Confirm my email address</a></p>`,
    `<p>The link works for ${escapeHtml(window)}. If you didn't create an account at Boss Clinician, you can ignore this.</p>`,
    `<p>— Yvette</p>`,
  ].join("\n");

  return { subject: "Confirm your email address", text, html };
}

export function passwordReset(input: TokenEmailInput): EmailContent {
  const name = greeting(input.firstName);
  const url = link("/reset-password", input.token);
  const window = validFor(input.expiresInMinutes);

  const text = [
    `Hi ${name},`,
    ``,
    `Here's the link to set a new password:`,
    ``,
    url,
    ``,
    `It works for ${window}, and only once.`,
    ``,
    `If you didn't ask for this, nothing has changed on your account — you can safely ignore this email.`,
    ``,
    `— Yvette`,
  ].join("\n");

  const html = [
    `<p>Hi ${escapeHtml(name)},</p>`,
    `<p>Here's the link to set a new password:</p>`,
    `<p><a href="${escapeHtml(url)}">Choose a new password</a></p>`,
    `<p>It works for ${escapeHtml(window)}, and only once.</p>`,
    `<p>If you didn't ask for this, nothing has changed on your account — you can safely ignore this email.</p>`,
    `<p>— Yvette</p>`,
  ].join("\n");

  return { subject: "Reset your Boss Clinician password", text, html };
}

export function magicLink(input: TokenEmailInput): EmailContent {
  const name = greeting(input.firstName);
  const url = link("/magic-link", input.token);
  const window = validFor(input.expiresInMinutes);

  const text = [
    `Hi ${name},`,
    ``,
    `Here's your sign-in link — no password needed:`,
    ``,
    url,
    ``,
    `It works for ${window}, and only once. Don't forward it: anyone who opens it is signed in as you.`,
    ``,
    `— Yvette`,
  ].join("\n");

  const html = [
    `<p>Hi ${escapeHtml(name)},</p>`,
    `<p>Here's your sign-in link — no password needed:</p>`,
    `<p><a href="${escapeHtml(url)}">Sign me in</a></p>`,
    `<p>It works for ${escapeHtml(window)}, and only once. Don't forward it: anyone who opens it is signed in as you.</p>`,
    `<p>— Yvette</p>`,
  ].join("\n");

  return { subject: "Your sign-in link", text, html };
}

export function welcome(input: { firstName: string }): EmailContent {
  const name = greeting(input.firstName);
  const url = `${env.publicSiteUrl}/account`;

  const text = [
    `Hi ${name},`,
    ``,
    `You're all set — your Boss Clinician account is confirmed.`,
    ``,
    `Everything you've enrolled in lives in one place, along with your downloads and your profile:`,
    ``,
    url,
    ``,
    `If you get stuck anywhere, just reply to this email. It comes to me.`,
    ``,
    `— Yvette`,
  ].join("\n");

  const html = [
    `<p>Hi ${escapeHtml(name)},</p>`,
    `<p>You're all set — your Boss Clinician account is confirmed.</p>`,
    `<p>Everything you've enrolled in lives in one place, along with your downloads and your profile:</p>`,
    `<p><a href="${escapeHtml(url)}">Open my account</a></p>`,
    `<p>If you get stuck anywhere, just reply to this email. It comes to me.</p>`,
    `<p>— Yvette</p>`,
  ].join("\n");

  return { subject: "Welcome to Boss Clinician", text, html };
}

/**
 * Sent after the password actually changes, to the address on the account.
 *
 * This is the one email nobody asks for and the only warning a member gets that
 * someone else got into their account, so it says plainly what to do about it.
 */
export function passwordChanged(input: { firstName: string }): EmailContent {
  const name = greeting(input.firstName);
  const url = `${env.publicSiteUrl}/forgot-password`;

  const text = [
    `Hi ${name},`,
    ``,
    `Your Boss Clinician password was just changed, and everywhere else you were signed in has been signed out.`,
    ``,
    `If that was you, there's nothing to do.`,
    ``,
    `If it wasn't, reset your password straight away and then reply to this email so I can help:`,
    ``,
    url,
    ``,
    `— Yvette`,
  ].join("\n");

  const html = [
    `<p>Hi ${escapeHtml(name)},</p>`,
    `<p>Your Boss Clinician password was just changed, and everywhere else you were signed in has been signed out.</p>`,
    `<p>If that was you, there's nothing to do.</p>`,
    `<p>If it wasn't, <a href="${escapeHtml(url)}">reset your password</a> straight away and then reply to this email so I can help.</p>`,
    `<p>— Yvette</p>`,
  ].join("\n");

  return { subject: "Your password was changed", text, html };
}

/**
 * Sent when someone tries to sign up with an address that already has a working
 * account.
 *
 * The signup response says only "check your email", so this is what tells the
 * real owner what happened — and, if it was not them, that somebody is probing
 * their address. It deliberately contains no link and no token: there is
 * nothing here for a stranger to act on, because a stranger is exactly who may
 * have triggered it.
 */
export function registrationAttempted(input: { firstName: string }): EmailContent {
  const name = greeting(input.firstName);
  const signIn = `${env.publicSiteUrl}/login`;
  const reset = `${env.publicSiteUrl}/forgot-password`;

  const text = [
    `Hi ${name},`,
    ``,
    `Someone just tried to create a Boss Clinician account with this email address, but you already have one.`,
    ``,
    `If that was you, you can sign in here: ${signIn}`,
    `Forgotten your password? Reset it here: ${reset}`,
    ``,
    `If it wasn't you, you don't need to do anything — nothing about your account has changed, and no one was given access to it.`,
    ``,
    `— Yvette`,
  ].join("\n");

  const html = [
    `<p>Hi ${escapeHtml(name)},</p>`,
    `<p>Someone just tried to create a Boss Clinician account with this email address, but you already have one.</p>`,
    `<p>If that was you, you can <a href="${escapeHtml(signIn)}">sign in here</a>. Forgotten your password? <a href="${escapeHtml(reset)}">Reset it here</a>.</p>`,
    `<p>If it wasn't you, you don't need to do anything — nothing about your account has changed, and no one was given access to it.</p>`,
    `<p>— Yvette</p>`,
  ].join("\n");

  return { subject: "You already have a Boss Clinician account", text, html };
}

/**
 * Sent to finish an account that exists but has never had a password — a guest
 * checkout, an admin-added member, a CSV import, or a lead captured by an
 * automation.
 *
 * This link is the only way such an account can be claimed. Registration will
 * not do it, because a request cannot prove who owns an inbox and this can.
 */
export function setPassword(input: TokenEmailInput): EmailContent {
  const name = greeting(input.firstName);
  const url = link("/reset-password", input.token);
  const window = validFor(input.expiresInMinutes);

  const text = [
    `Hi ${name},`,
    ``,
    `You already have a Boss Clinician account — it was created when you bought something, or when Yvette added you — it just doesn't have a password yet.`,
    ``,
    `Choose one here and you're in: ${url}`,
    ``,
    `This link works for ${window}. Anything you've already bought is waiting in your library.`,
    ``,
    `— Yvette`,
  ].join("\n");

  const html = [
    `<p>Hi ${escapeHtml(name)},</p>`,
    `<p>You already have a Boss Clinician account — it was created when you bought something, or when Yvette added you — it just doesn't have a password yet.</p>`,
    `<p><a href="${escapeHtml(url)}">Choose one here and you're in</a>.</p>`,
    `<p>This link works for ${escapeHtml(window)}. Anything you've already bought is waiting in your library.</p>`,
    `<p>— Yvette</p>`,
  ].join("\n");

  return { subject: "Finish setting up your Boss Clinician account", text, html };
}
