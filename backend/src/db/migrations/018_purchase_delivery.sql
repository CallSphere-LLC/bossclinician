/**
 * What a buyer is told to do next, per offer.
 *
 * The welcome email that goes out after a purchase is assembled from the offer
 * itself rather than from a template, because the useful part of it is never
 * generic: which module to open first, where the community is, which planner to
 * download. Held on the offer so Yvette writes it once, beside the price and the
 * thank-you page, and every future buyer of that offer gets it.
 *
 * Empty is a supported value, not a missing one — the welcome email drops the
 * step entirely rather than rendering an empty bullet.
 */
ALTER TABLE offers ADD COLUMN IF NOT EXISTS welcome_next_steps TEXT NOT NULL DEFAULT '';

/**
 * Whether this offer sends the welcome email at all.
 *
 * On by default, because an offer that grants access and says nothing is the
 * behaviour this migration exists to end. Off is for the offer that is a bump,
 * a $7 download or an upsell, where a second "welcome to your new program" email
 * on top of the receipt reads as a mistake.
 */
ALTER TABLE offers ADD COLUMN IF NOT EXISTS send_welcome_email BOOLEAN NOT NULL DEFAULT true;

/**
 * The wording for the post-purchase welcome, editable on the same screen as
 * every other automatic email.
 *
 * Seeded with no subject or body: `email/templateStore.ts` treats a blank row as
 * unwritten and falls back to the compiled-in template, so this row exists to
 * put the email on Yvette's screen, not to define it.
 */
INSERT INTO email_templates (key, name, description) VALUES
  ('purchase_welcome', 'Welcome after a purchase',
   'The "here is what to do next" email, sent alongside the receipt')
ON CONFLICT (key) DO NOTHING;
