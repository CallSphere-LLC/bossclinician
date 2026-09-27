import { Router } from "express";
import { pool } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest } from "../../utils/httpError";
import { clearSettingsCache, secretFieldNames } from "../../services/settings";
import { clearDripSettingsCache } from "../../services/curriculum";
import { settingsUpdateSchema } from "../../validation/schemas";

export const adminSettingsRouter = Router();

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Credentials a stored row can hold without the registry declaring them.
 *
 * The Resend API key is read from `email_provider.apiKey` when the environment
 * has none (email/provider.ts, `providerSettings`), but the settings screen has
 * no box for it, so it is not a declared secret field and `secretFieldNames`
 * never names it. Without this list the whole key went back to the browser in
 * clear from GET /admin/settings.
 */
const UNDECLARED_SECRET_FIELDS: Record<string, string[]> = {
  email_provider: ["apiKey"],
};

function hiddenFieldNames(key: string): string[] {
  return [...secretFieldNames(key), ...(UNDECLARED_SECRET_FIELDS[key] ?? [])];
}

/**
 * A stored value with its credentials taken out.
 *
 * This endpoint returns the settings table as it stands, and three of its keys
 * hold a secret beside their ordinary fields: the Turnstile secret, the Meta
 * access token and the email provider's signing secret. The settings screen
 * that replaced this one is built on the rule that a secret never leaves the
 * server once it has been saved (services/settings.ts, `settingGroups`), and an
 * endpoint handing the same three values back in clear makes that rule
 * decorative. Removed rather than masked, because a mask is itself a value and
 * this screen posts back everything it was given.
 */
export function withoutSecrets(key: string, value: unknown): unknown {
  const secrets = hiddenFieldNames(key);
  const object = secrets.length === 0 ? null : asObject(value);
  if (!object) return value;

  const out: Record<string, unknown> = {};
  for (const [name, item] of Object.entries(object)) {
    if (!secrets.includes(name)) out[name] = item;
  }
  return out;
}

/**
 * The value to store, with any secret this body did not carry put back.
 *
 * The write is a whole-value replace and the read above no longer includes the
 * secrets, so without this the first save from that screen would blank all
 * three of them. A body that does carry a secret field still overwrites it —
 * absent means "leave it alone", not "there isn't one".
 */
export function keepStoredSecrets(key: string, incoming: unknown, stored: unknown): unknown {
  const secrets = hiddenFieldNames(key);
  const next = secrets.length === 0 ? null : asObject(incoming);
  const previous = next === null ? null : asObject(stored);
  if (!next || !previous) return incoming;

  const kept: Record<string, unknown> = {};
  for (const name of secrets) {
    if (!(name in next) && previous[name] !== undefined) kept[name] = previous[name];
  }
  return Object.keys(kept).length === 0 ? incoming : { ...kept, ...next };
}

/**
 * The table as this screen may see it.
 *
 * A row flagged `is_secret` is left out altogether: that flag is how a key the
 * registry does not describe is marked as a credential, and the settings screen
 * already hides every field of such a row (services/settings.ts,
 * `settingGroups`). This screen never writes one back, so leaving it out cannot
 * blank it either.
 */
async function readableSettings(): Promise<Record<string, unknown>> {
  const result = await pool.query<{ key: string; value: unknown; is_secret: boolean | null }>(
    "SELECT key, value, is_secret FROM settings WHERE key != 'seed_completed'"
  );
  const merged: Record<string, unknown> = {};
  for (const row of result.rows) {
    if (row.is_secret === true) continue;
    merged[row.key] = withoutSecrets(row.key, row.value);
  }
  return merged;
}

adminSettingsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json(await readableSettings());
  })
);

/** Body is a flat map of {key: value}; each key is upserted into the settings table. */
adminSettingsRouter.put(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = settingsUpdateSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid payload", parsed.error.flatten());

    const entries = Object.entries(parsed.data).filter(([key]) => key !== "seed_completed");
    for (const [key, value] of entries) {
      let toStore = value;
      if (secretFieldNames(key).length > 0) {
        const existing = await pool.query<{ value: unknown }>(
          "SELECT value FROM settings WHERE key = $1",
          [key]
        );
        toStore = keepStoredSecrets(key, value, existing.rows[0]?.value);
      }

      await pool.query(
        `INSERT INTO settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = $2`,
        [key, JSON.stringify(toStore)]
      );
    }

    // Several readers cache settings in process — the drip release hour is read
    // on every progress ping and every lesson unlock, so it is not re-queried
    // per request. Saving here has to invalidate them, or an edit appears to do
    // nothing for a minute and gets saved again.
    clearSettingsCache();
    if (entries.some(([key]) => key === "drip")) clearDripSettingsCache();

    res.json(await readableSettings());
  })
);
