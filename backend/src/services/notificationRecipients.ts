import { env } from "../config/env";
import { readSetting } from "./settings";

/**
 * Who gets told, and whether they asked to be.
 *
 * Settings → "What you get told about" has offered an address and a switch per
 * kind of news since the settings screen was built, and nothing ever read them:
 * every sender went straight to the NOTIFY_EMAIL environment variable. So the
 * owner could change the address, or switch "someone buys something" off, press
 * Save, and carry on receiving exactly what she had before at the old address.
 *
 * This is the one place that answers both questions:
 *
 *  - the address is the one saved in settings, falling back to NOTIFY_EMAIL when
 *    that box is empty — so a deployment that only ever set the variable keeps
 *    working untouched;
 *  - a kind with a switch is sent only while its switch is on.
 *
 * `alert` has no switch on purpose. It is for the things she did not choose to
 * hear about and must anyway — a customer charged past the end of a payment
 * plan, or a "tell me" step she built into an automation herself. Turning off
 * sale emails must not be able to silence those.
 */

export type NotificationKind = "sale" | "lead" | "dispute" | "jobFailure" | "alert";

const FLAG_FOR: Record<Exclude<NotificationKind, "alert">, string> = {
  sale: "onSale",
  lead: "onLead",
  dispute: "onDispute",
  jobFailure: "onJobFailure",
};

/**
 * The address to notify about this kind of thing, or "" for nobody.
 *
 * Never throws: every caller is on the far side of a payment or a form
 * submission, and a settings read that fails should cost nothing more than the
 * saved preferences — the environment's address is used as though they were
 * blank.
 */
export async function notificationRecipients(kind: NotificationKind): Promise<string> {
  let saved: Record<string, unknown> = {};
  try {
    saved = await readSetting("notifications");
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      "[notifications] could not read the notification settings (using NOTIFY_EMAIL):",
      (err as Error).message
    );
  }

  // Only an explicit `false` is "off": a missing row, or a flag added after the
  // row was saved, means the default — and every default is on.
  if (kind !== "alert" && saved[FLAG_FOR[kind]] === false) return "";

  const address = typeof saved.notifyEmail === "string" ? saved.notifyEmail.trim() : "";
  return address || env.notifyEmail;
}
