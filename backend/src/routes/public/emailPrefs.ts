import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { pool } from "../../db/pool";
import { escapeHtml } from "../../email/templates";
import {
  PREFERENCE_TOPICS,
  UNSUBSCRIBE_PATH,
  isKnownTopic,
  marketingSettings,
  suppress,
  verifyPreferencesToken,
} from "../../email/provider";
import { asyncHandler } from "../../utils/asyncHandler";

/**
 * The preferences and unsubscribe surface, served to a reader's browser.
 *
 * Authenticated by the HMAC in the link rather than by a login, because the
 * person clicking it usually has no account and, if they do, being asked to
 * remember a password in order to stop receiving email is the thing that gets
 * a sender reported instead of unsubscribed.
 *
 * The split between GET and POST here is not decoration. A GET must never
 * unsubscribe anybody: mail scanners, link checkers and Outlook's Safe Links
 * all fetch every URL in a message, and an acting GET would quietly opt out a
 * share of every list this platform sends to. RFC 8058's POST is what the
 * mailbox provider's own one-click button uses, and that is the only
 * confirmation-free path.
 */

export const emailPrefsRouter = Router();

/** Guessing protection. The token is a 256-bit HMAC, so this is belt and braces. */
const prefsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again in a few minutes." },
});

/* ------------------------------------------------------------------ lookup */

interface ContactPreferences {
  contactId: number;
  email: string;
  marketingStatus: string;
  topics: { topic: string; label: string; subscribed: boolean }[];
}

async function loadPreferences(contactId: number): Promise<ContactPreferences | null> {
  const contactRes = await pool.query<{ email: string; email_marketing_status: string }>(
    `SELECT email::text AS email, email_marketing_status FROM contacts WHERE id = $1`,
    [contactId]
  );
  const contact = contactRes.rows[0];
  if (!contact) return null;

  const prefsRes = await pool.query<{ topic: string; subscribed: boolean }>(
    `SELECT topic, subscribed FROM contact_email_preferences WHERE contact_id = $1`,
    [contactId]
  );
  const stored = new Map(prefsRes.rows.map((row) => [row.topic, row.subscribed]));

  return {
    contactId,
    email: contact.email,
    marketingStatus: contact.email_marketing_status,
    topics: PREFERENCE_TOPICS.map((topic) => ({
      topic: topic.topic,
      label: topic.label,
      // Absent means subscribed: somebody who has never touched this page is
      // opted in to everything they consented to at signup.
      subscribed: stored.get(topic.topic) ?? true,
    })),
  };
}

/** Reads the token out of the path, or answers 404 without saying which part failed. */
function contactFromToken(token: string): number | null {
  return verifyPreferencesToken(token);
}

/* -------------------------------------------------------------------- pages */

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; padding:48px 20px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         background:#faf7f2; color:#241f26; line-height:1.6; }
  .card { max-width:34rem; margin:0 auto; background:#fff; border:1px solid #e7e0d6; border-radius:18px; padding:32px; }
  h1 { font-size:1.4rem; margin:0 0 8px; }
  p { margin:0 0 16px; color:#5c5560; }
  label { display:flex; gap:12px; align-items:flex-start; padding:12px 0; border-bottom:1px solid #f0ebe3; }
  label:last-of-type { border-bottom:none; }
  button { background:#4a2545; color:#fff; border:0; border-radius:10px; padding:12px 20px;
           font-size:1rem; cursor:pointer; }
  button.quiet { background:transparent; color:#4a2545; text-decoration:underline; padding-left:0; }
  .foot { max-width:34rem; margin:20px auto 0; font-size:.8rem; color:#8a8290; text-align:center; }
</style>
</head><body><div class="card">${body}</div></body></html>`;
}

async function footerNote(): Promise<string> {
  const settings = await marketingSettings();
  return settings.address ? `<p class="foot">${escapeHtml(settings.address)}</p>` : "";
}

function preferencesPage(prefs: ContactPreferences, token: string, saved: boolean): string {
  const optedOut = prefs.marketingStatus !== "subscribed" && prefs.marketingStatus !== "unconfirmed";

  const checkboxes = prefs.topics
    .map(
      (topic) =>
        `<label><input type="checkbox" name="topic_${escapeHtml(topic.topic)}" value="yes"${
          topic.subscribed && !optedOut ? " checked" : ""
        }><span>${escapeHtml(topic.label)}</span></label>`
    )
    .join("\n");

  const banner = saved ? `<p><strong>Saved. Thank you.</strong></p>` : "";
  const optedOutNote = optedOut
    ? `<p><strong>You are currently unsubscribed from everything.</strong> Tick anything below and save to start hearing from us again.</p>`
    : "";

  return page(
    "Your email preferences",
    `${banner}
<h1>What would you like to hear about?</h1>
<p>These settings are for <strong>${escapeHtml(prefs.email)}</strong>. You will still get receipts and anything to do with your account.</p>
${optedOutNote}
<form method="post" action="/api/email/prefs/${escapeHtml(token)}">
${checkboxes}
<p style="margin-top:24px"><button type="submit">Save my preferences</button></p>
</form>
<form method="post" action="${UNSUBSCRIBE_PATH}/${escapeHtml(token)}">
<button class="quiet" type="submit">Unsubscribe from everything</button>
</form>`
  );
}

/* ------------------------------------------------------------------ reading */

/**
 * GET /api/email/prefs/:token
 *
 * Serves a page to a browser and JSON to anything that asks for it, so the
 * link in an email works today without a frontend route and a proper page can
 * be built against the same endpoint later.
 */
emailPrefsRouter.get(
  "/email/prefs/:token",
  prefsLimiter,
  asyncHandler(async (req, res) => {
    const contactId = contactFromToken(req.params.token);
    const prefs = contactId === null ? null : await loadPreferences(contactId);

    if (!prefs) {
      res.status(404);
      if (req.accepts(["html", "json"]) === "json") {
        res.json({ error: "That link is no longer valid" });
        return;
      }
      res.type("html").send(
        page(
          "Link expired",
          `<h1>That link is no longer valid</h1><p>It may have been changed since the email was sent. Use the unsubscribe link on a more recent email, or reply to any of ours and we will sort it out.</p>`
        )
      );
      return;
    }

    if (req.accepts(["html", "json"]) === "json") {
      res.json({
        email: prefs.email,
        marketingStatus: prefs.marketingStatus,
        topics: prefs.topics,
      });
      return;
    }

    res
      .type("html")
      .send(
        preferencesPage(prefs, req.params.token, req.query.saved === "1") + (await footerNote())
      );
  })
);

/* ------------------------------------------------------------------ writing */

const updateSchema = z.object({
  topics: z.record(z.string(), z.boolean()).optional(),
  unsubscribeAll: z.boolean().optional(),
});

/** Writes one topic switch. Rows are created on first use, not at signup. */
async function setTopic(contactId: number, topic: string, subscribed: boolean): Promise<void> {
  await pool.query(
    `INSERT INTO contact_email_preferences (contact_id, topic, subscribed)
     VALUES ($1, $2, $3)
     ON CONFLICT (contact_id, topic)
       DO UPDATE SET subscribed = EXCLUDED.subscribed, updated_at = now()`,
    [contactId, topic, subscribed]
  );
}

/**
 * POST /api/email/prefs/:token
 *
 * Takes either the HTML form above (a checkbox absent means unticked) or a JSON
 * body of explicit switches. Saving anything at all lifts a previous blanket
 * opt-out, because ticking a box is an unambiguous request to be emailed.
 */
emailPrefsRouter.post(
  "/email/prefs/:token",
  prefsLimiter,
  asyncHandler(async (req, res) => {
    const contactId = contactFromToken(req.params.token);
    if (contactId === null) {
      res.status(404).json({ error: "That link is no longer valid" });
      return;
    }

    const prefs = await loadPreferences(contactId);
    if (!prefs) {
      res.status(404).json({ error: "That link is no longer valid" });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const parsed = updateSchema.safeParse(body);
    const wanted = new Map<string, boolean>();

    if (parsed.success && parsed.data.topics) {
      for (const [topic, subscribed] of Object.entries(parsed.data.topics)) {
        if (isKnownTopic(topic)) wanted.set(topic, subscribed);
      }
    } else {
      // The form path: every known topic is decided by whether its checkbox
      // came back, since an unticked checkbox is simply absent from the post.
      for (const { topic } of PREFERENCE_TOPICS) {
        wanted.set(topic, body[`topic_${topic}`] !== undefined);
      }
    }

    if (parsed.success && parsed.data.unsubscribeAll) {
      for (const { topic } of PREFERENCE_TOPICS) wanted.set(topic, false);
    }

    for (const [topic, subscribed] of wanted) {
      await setTopic(contactId, topic, subscribed);
    }

    const anyOn = [...wanted.values()].some(Boolean);
    if (anyOn) {
      // Re-subscribing clears the suppression too, or every future send would
      // be stopped by a list the reader has no way of seeing.
      await pool.query(
        `UPDATE contacts
            SET email_marketing_status = 'subscribed', opted_in_at = COALESCE(opted_in_at, now()),
                opted_out_at = NULL, consent_source = 'preferences page', updated_at = now()
          WHERE id = $1 AND email_marketing_status IN ('opted_out', 'unconfirmed')`,
        [contactId]
      );
      await pool.query(
        `DELETE FROM email_suppressions
          WHERE email = $1 AND reason IN ('unsubscribe', 'manual')`,
        [prefs.email]
      );
    } else {
      await suppress({ email: prefs.email, reason: "unsubscribe", detail: "preferences page" });
    }

    if (req.accepts(["html", "json"]) === "json") {
      res.json({ ok: true, topics: [...wanted].map(([topic, subscribed]) => ({ topic, subscribed })) });
      return;
    }
    res.redirect(303, `/api/email/prefs/${req.params.token}?saved=1`);
  })
);

/* -------------------------------------------------------------- unsubscribe */

/**
 * GET /api/email/unsubscribe/:token
 *
 * Shows a button. It deliberately does not act: this URL sits in the
 * List-Unsubscribe header of every marketing email, and every scanner that
 * inspects that header would otherwise opt the reader out on our behalf.
 */
emailPrefsRouter.get(
  "/email/unsubscribe/:token",
  prefsLimiter,
  asyncHandler(async (req, res) => {
    const contactId = contactFromToken(req.params.token);
    const prefs = contactId === null ? null : await loadPreferences(contactId);

    if (!prefs) {
      res.status(404).type("html").send(
        page(
          "Link expired",
          `<h1>That link is no longer valid</h1><p>Reply to any of our emails and we will take you off the list by hand.</p>`
        )
      );
      return;
    }

    const already =
      prefs.marketingStatus !== "subscribed" && prefs.marketingStatus !== "unconfirmed";

    res
      .type("html")
      .send(
        page(
          "Unsubscribe",
          already
            ? `<h1>You are already unsubscribed</h1><p><strong>${escapeHtml(prefs.email)}</strong> will not get any more marketing email from us.</p>
<p><a href="/api/email/prefs/${escapeHtml(req.params.token)}">Change what you hear about instead</a></p>`
            : `<h1>Unsubscribe ${escapeHtml(prefs.email)}?</h1>
<p>You will stop getting marketing email from us. Receipts and anything about your account will still come through.</p>
<form method="post" action="${UNSUBSCRIBE_PATH}/${escapeHtml(req.params.token)}">
<button type="submit">Yes, unsubscribe me</button>
</form>
<p style="margin-top:20px"><a href="/api/email/prefs/${escapeHtml(req.params.token)}">Or choose what you hear about</a></p>`
        ) + (await footerNote())
      );
  })
);

/**
 * POST /api/email/unsubscribe/:token
 *
 * The one-click path. Answers both the mailbox provider's RFC 8058 post — whose
 * body is `List-Unsubscribe=One-Click` and which carries no session, no
 * referrer and no cookies — and the confirm button above.
 */
emailPrefsRouter.post(
  "/email/unsubscribe/:token",
  prefsLimiter,
  asyncHandler(async (req, res) => {
    const contactId = contactFromToken(req.params.token);
    const prefs = contactId === null ? null : await loadPreferences(contactId);

    if (!prefs || contactId === null) {
      // 200 rather than 404 to a mailbox provider: it has nothing useful to do
      // with a failure, and a non-2xx here shows the reader an error for an
      // action they have every right to consider finished.
      res.status(200).type("text/plain").send("Unsubscribed.");
      return;
    }

    await suppress({ email: prefs.email, reason: "unsubscribe", detail: "one-click" });
    for (const { topic } of PREFERENCE_TOPICS) {
      await setTopic(contactId, topic, false);
    }

    if (req.accepts(["html", "json"]) === "json") {
      res.json({ ok: true, email: prefs.email });
      return;
    }

    res
      .type("html")
      .send(
        page(
          "Unsubscribed",
          `<h1>Done — you are unsubscribed</h1>
<p><strong>${escapeHtml(prefs.email)}</strong> will not get any more marketing email from us.</p>
<p>Changed your mind? <a href="/api/email/prefs/${escapeHtml(req.params.token)}">Choose what you hear about</a>.</p>`
        ) + (await footerNote())
      );
  })
);
