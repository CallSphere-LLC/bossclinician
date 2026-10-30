import type { SettingDefinition } from "./settings";

export const recoveryDefinition: SettingDefinition = {
  key: "cart_recovery", group: "payments", label: "Abandoned checkout reminders",
  description: "By default one reminder goes out, 6 hours after the visitor's last checkout activity. Change its timing below, or switch on more. Nobody gets more than one reminder in 24 hours, even if they left several offers. Buying stops any reminder still to come for that offer. Sales are attributed to the last reminder link followed before purchase.",
  defaults: {
    enabled: true, recipients: "", ...Object.fromEntries([6, 24, 48, 72].flatMap((hours, i) => [
      [`enabled${i}`, i === 0], [`hours${i}`, hours],
      [`subject${i}`, i === 0 ? "Still interested in {offer}?" : i === 3 ? "Your last reminder about {offer}" : "Your {offer} checkout is waiting"],
      [`body${i}`, "Hi {name},\n\nYour checkout for {offer} is still available. If you need a hand, reply to this email.\n\n[Continue checkout]({checkout_url})"],
    ])),
  },
  fields: [
    {name: "enabled", type: "boolean", label: "Send abandoned checkout reminders"},
    {name: "recipients", type: "longtext", label: "Who receives reminders", help: "Leave empty for all eligible checkout visitors, or enter specific email addresses separated by commas or newlines. Only people who started a checkout receive reminders. Unsubscribes and suppressions always apply."},
    ...[0, 1, 2, 3].flatMap((i) => [
      {name: `enabled${i}`, type: "boolean" as const, label: `Send reminder ${i + 1}`},
      {name: `hours${i}`, type: "number" as const, min: 0.01, max: 720, unit: "hours", label: `Reminder ${i + 1}: delay`, help: "Hours after the visitor's last checkout activity. Keep later reminders at a later delay. A reminder that would land within 24 hours of the last one this person got waits until the 24 hours are up."},
      {name: `subject${i}`, type: "text" as const, label: `Reminder ${i + 1}: subject`},
      {name: `body${i}`, type: "longtext" as const, label: `Reminder ${i + 1}: email body`, help: "Use {name}, {offer} and {checkout_url}. Links use [link text]({checkout_url}). A tracked checkout link is appended if you leave it out."},
    ]),
  ],
};
