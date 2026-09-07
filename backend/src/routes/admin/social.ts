import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest } from "../../utils/httpError";
import { recordAdminAction } from "../../services/adminAudit";

/**
 * Social accounts — Final Sidebar & Page UX Requirements §6.
 *
 * "Do not hard-code platforms that are not used; make the page configurable."
 * So there is no enum of networks here: the owner names the platform, and the
 * page renders whatever she has entered. Instagram and TikTok are examples in
 * the requirements, not a schema.
 *
 * Stored as one JSON document in `settings` rather than as its own table. This
 * is a short, hand-maintained list with no relations, no history and no
 * queries run against it — a table plus a migration would buy nothing and cost
 * a schema change. The settings row is the same mechanism every other
 * operator-configured list already uses.
 *
 * §6 also anticipates "future integrations may add analytics, scheduled posts,
 * or publishing where supported". `status` is therefore a stored field rather
 * than something derived from a live connection: today the owner states it,
 * and a real OAuth connection can later set it without the shape changing.
 */
export const adminSocialRouter = Router();

const SETTINGS_KEY = "social_accounts";

const accountSchema = z.object({
  id: z.string().min(1).max(64),
  platform: z.string().trim().min(1).max(60),
  handle: z.string().trim().max(120).default(""),
  url: z
    .string()
    .trim()
    .max(500)
    .refine((v) => v === "" || /^https?:\/\//i.test(v), {
      // A bare "instagram.com/…" in an href resolves against the admin origin
      // and opens a 404 inside Boss Clinician rather than the profile.
      message: "Links must start with http:// or https://",
    })
    .default(""),
  status: z.enum(["connected", "not_connected", "needs_attention"]).default("not_connected"),
  notes: z.string().trim().max(400).default(""),
});

const payloadSchema = z.object({
  accounts: z.array(accountSchema).max(40),
});

export type SocialAccount = z.infer<typeof accountSchema>;

async function readAccounts(): Promise<SocialAccount[]> {
  const res = await pool.query<{ value: { accounts?: unknown } }>(
    `SELECT value FROM settings WHERE key = $1`,
    [SETTINGS_KEY],
  );
  const raw = res.rows[0]?.value?.accounts;
  if (!Array.isArray(raw)) return [];
  // Anything that no longer parses is dropped rather than thrown: a single
  // malformed row written by an older shape must not take the page down.
  return raw.flatMap((entry) => {
    const parsed = accountSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}

adminSocialRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json({ accounts: await readAccounts() });
  }),
);

adminSocialRouter.put(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = payloadSchema.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest("Check the accounts you're saving.", parsed.error.flatten());
    }

    // Two accounts sharing an id would make the list unaddressable — the UI
    // keys rows by it, and a delete would remove the wrong one.
    const ids = new Set(parsed.data.accounts.map((a) => a.id));
    if (ids.size !== parsed.data.accounts.length) {
      throw badRequest("Each account needs its own id.");
    }

    const existing = await readAccounts();

    await pool.query(
      `INSERT INTO settings (key, value, group_key, label, description)
       VALUES ($1, $2::jsonb, 'internal', 'Social accounts', 'The social platforms used for marketing.')
       ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value, updated_at = now()`,
      [SETTINGS_KEY, JSON.stringify({ accounts: parsed.data.accounts })],
    );

    // §9 of the calendar addendum and the SRS both ask that integration
    // changes be audited where the existing system supports it. It does.
    await recordAdminAction({
      req,
      action: "social.accountsUpdated",
      entityType: "settings",
      entityId: SETTINGS_KEY,
      before: { accounts: existing },
      after: { accounts: parsed.data.accounts },
    });

    res.json({ accounts: parsed.data.accounts });
  }),
);
