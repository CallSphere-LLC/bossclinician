import { sendMail } from "../email/mailer";
import { ownerOptInNotification, type FormAnswerRow } from "../email/templates";
import { notificationRecipients } from "./notificationRecipients";

/**
 * Tells the owner someone opted in to something that is not a form: the mailing
 * list, a quiz, an event. Form replies have their own richer email, under the
 * form's own switch (`notifyOwnerOfReply` in routes/public/growthPublic.ts).
 *
 * Goes to the address in Settings under the "someone fills in a form" switch.
 * Fire-and-forget, and it cannot throw or reject: the person's sign-up is saved
 * by now, and neither a settings read nor the mail server may cost them it.
 */
export function notifyOwnerOfOptIn(input: {
  what: string;
  name?: string;
  email: string;
  details?: FormAnswerRow[];
}): void {
  void (async () => {
    try {
      const to = await notificationRecipients("lead");
      if (!to) return;
      const content = ownerOptInNotification({
        what: input.what,
        name: input.name ?? "",
        email: input.email,
        details: input.details,
      });
      await sendMail({ to, ...content, replyTo: input.email, topic: "owner_optin_notification" });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[notify] owner opt-in email for ${input.what} failed:`, (err as Error).message);
    }
  })();
}
