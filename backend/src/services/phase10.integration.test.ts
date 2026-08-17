import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Client } from "pg";
import { createTestDatabase, hasTestDatabase } from "../testing/db";

/**
 * Integration tests for the settings, session and integration SQL.
 *
 * Everything in this phase that can go wrong at runtime rather than at compile
 * time is a statement: a jsonb merge that replaces instead of merging, an
 * `xmax = 0` upsert that reports every row as new, a session lookup that lets a
 * revoked token through. None of those are observable without a database, and
 * all of them are silent — a settings screen that saves nothing still shows a
 * "Saved" toast.
 *
 * Skipped when TEST_DATABASE_URL is unset, so the default `npm test` needs
 * nothing running. Run with ./scripts/test-integration.sh.
 */

const describeDb = hasTestDatabase ? describe : describe.skip;

describeDb("phase 10 (integration)", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let client: Client;
  let settings: typeof import("./settings");
  let webhooks: typeof import("./webhooksOut");
  let mfa: typeof import("./mfa");

  beforeAll(async () => {
    db = await createTestDatabase("phase10");
    client = db.client;

    // These modules read DATABASE_URL at import time through config/env, so the
    // environment has to point at the scratch database before they load.
    process.env.DATABASE_URL = db.url;
    process.env.JWT_SECRET ??= "integration-test-secret";

    settings = await import("./settings");
    webhooks = await import("./webhooksOut");
    mfa = await import("./mfa");
  }, 60_000);

  afterAll(async () => {
    const { pool } = await import("../db/pool");
    await pool.end().catch(() => undefined);
    await db?.drop();
  });

  /* ------------------------------------------------------------- settings */

  it("returns every seeded key with its defaults filled in", async () => {
    const groups = await settings.settingGroups();
    const keys = groups.flatMap((g) => g.settings.map((s) => s.key));

    for (const definition of settings.SETTING_DEFINITIONS) {
      expect(keys).toContain(definition.key);
    }

    const delivery = groups.find((g) => g.key === "delivery");
    const drip = delivery?.settings.find((s) => s.key === "drip");
    expect(drip?.fields.find((f) => f.name === "releaseTime")?.value).toBe("06:00");
  });

  it("merges a patch instead of replacing the row", async () => {
    settings.clearSettingsCache();
    await settings.writeSetting("branding", { primaryColor: "#5C457D" });
    await settings.writeSetting("branding", { fontHeading: "Fraunces" });

    settings.clearSettingsCache();
    const branding = await settings.readSetting("branding");
    // The first save has to survive the second, or every settings screen
    // silently wipes the fields it does not happen to show.
    expect(branding.primaryColor).toBe("#5C457D");
    expect(branding.fontHeading).toBe("Fraunces");
  });

  it("leaves fields it does not describe alone", async () => {
    await client.query(
      `UPDATE settings SET value = value || '{"rates":[{"country":"US","state":"CA","rateBps":825}]}'::jsonb
        WHERE key = 'tax'`
    );

    settings.clearSettingsCache();
    await settings.writeSetting("tax", { enabled: true, defaultRateBps: 700 });

    const stored = await client.query<{ value: { rates: unknown[]; defaultRateBps: number } }>(
      `SELECT value FROM settings WHERE key = 'tax'`
    );
    // Per-country rates are configured elsewhere and are not on this screen;
    // saving the screen must not delete them.
    expect(stored.rows[0].value.rates).toHaveLength(1);
    expect(stored.rows[0].value.defaultRateBps).toBe(700);
  });

  it("refuses a value the field declaration does not allow", async () => {
    await expect(settings.writeSetting("drip", { releaseTime: "25:99" })).rejects.toThrow();
    await expect(settings.writeSetting("scheduling", { timezone: "Mars/Olympus" })).rejects.toThrow();
    await expect(settings.writeSetting("checkout", { supportEmail: "not-an-email" })).rejects.toThrow();
    // A key the registry does not describe cannot be written through the form.
    await expect(settings.writeSetting("drip", { anythingAtAll: 1 })).rejects.toThrow();
  });

  it("survives a settings row somebody edited badly", async () => {
    await client.query(
      `UPDATE settings SET value = '{"releaseTime":"nonsense","timezone":"Nowhere/Nothing"}'::jsonb
        WHERE key = 'drip'`
    );
    settings.clearSettingsCache();

    const drip = await settings.readSetting("drip");
    expect(drip.releaseTime).toBe("06:00");
    expect(drip.timezone).toBe("America/New_York");
  });

  it("mirrors into the older keys the platform still reads", async () => {
    settings.clearSettingsCache();
    await settings.writeSetting("scheduling", { minNoticeHours: 48, cancelWindowHours: 12 });

    // services/coachingCalendar.ts reads `coaching`, not `scheduling`, and it
    // spells the fields differently. Without the mirror the booking rules
    // screen changes nothing at all.
    const coaching = await client.query<{ value: Record<string, unknown> }>(
      `SELECT value FROM settings WHERE key = 'coaching'`
    );
    expect(coaching.rows[0].value.minimumNoticeHours).toBe(48);
    expect(coaching.rows[0].value.cancellationWindowHours).toBe(12);

    await settings.writeSetting("customer_payments", {
      accessOnCancel: "period_end",
      graceDays: 5,
    });
    const billing = await client.query<{ value: Record<string, unknown> }>(
      `SELECT value FROM settings WHERE key = 'billing'`
    );
    // routes/public/stripeWebhook.ts reads `billing.cancelGraceDays`.
    expect(billing.rows[0].value.cancelGraceDays).toBe(5);
  });

  it("never sends a secret back, only a hint", async () => {
    settings.clearSettingsCache();
    await settings.writeSetting("analytics", { metaAccessToken: "EAAG-super-secret-value-1234" });

    const groups = await settings.settingGroups();
    const analytics = groups
      .flatMap((g) => g.settings)
      .find((s) => s.key === "analytics");
    const token = analytics?.fields.find((f) => f.name === "metaAccessToken");

    expect(token?.value).toBeUndefined();
    expect(token?.hasValue).toBe(true);
    expect(token?.hint).toBe("EAA…1234");
    expect(JSON.stringify(groups)).not.toContain("super-secret");
  });

  /* ------------------------------------------------------------ webhooks */

  async function makeEndpoint(eventTypes: string[]): Promise<number> {
    const res = await client.query<{ id: number }>(
      `INSERT INTO webhook_endpoints (name, url, event_types, signing_secret)
       VALUES ('test', 'https://example.invalid/hook', $1, 'whsec_test') RETURNING id`,
      [eventTypes]
    );
    return res.rows[0].id;
  }

  it("fans an event out to the endpoints that asked for it", async () => {
    const all = await makeEndpoint([]);
    const some = await makeEndpoint(["order.paid"]);
    const other = await makeEndpoint(["form.submitted"]);

    const sent = await webhooks.dispatchEvent("order.paid", { orderId: 1 });
    expect(sent).toBe(2);

    const rows = await client.query<{ endpoint_id: number }>(
      `SELECT endpoint_id FROM webhook_deliveries WHERE event_type = 'order.paid'`
    );
    const reached = rows.rows.map((r) => r.endpoint_id).sort();
    expect(reached).toEqual([all, some].sort());
    expect(reached).not.toContain(other);
  });

  it("skips an endpoint that has been switched off", async () => {
    const id = await makeEndpoint(["contact.created"]);
    await client.query(`UPDATE webhook_endpoints SET enabled = false WHERE id = $1`, [id]);

    await webhooks.dispatchEvent("contact.created", {});

    // Asserted per endpoint rather than on the total: an earlier test left a
    // catch-all endpoint subscribed to everything, which is the behaviour we
    // want and would make a count of zero the wrong expectation.
    const rows = await client.query(
      `SELECT id FROM webhook_deliveries WHERE endpoint_id = $1`,
      [id]
    );
    expect(rows.rowCount).toBe(0);
  });

  it("copies a delivery rather than rewriting its history on replay", async () => {
    const id = await makeEndpoint(["member.created"]);
    await webhooks.dispatchEvent("member.created", { memberId: 9 });

    const original = await client.query<{ id: string }>(
      `SELECT id FROM webhook_deliveries WHERE endpoint_id = $1`,
      [id]
    );
    const replayed = await webhooks.replayDelivery(original.rows[0].id);
    expect(replayed).not.toBe(original.rows[0].id);

    const count = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM webhook_deliveries WHERE endpoint_id = $1`,
      [id]
    );
    expect(Number(count.rows[0].count)).toBe(2);
  });

  it("gives up on an endpoint that cannot be reached, and never throws", async () => {
    const id = await makeEndpoint(["coaching.booked"]);
    // A host that does not resolve: every attempt fails at the network, which
    // is the path that must not take the queue down with it.
    await client.query(
      `UPDATE webhook_endpoints SET url = 'https://does-not-exist.invalid/hook' WHERE id = $1`,
      [id]
    );
    await webhooks.dispatchEvent("coaching.booked", {});

    const delivery = await client.query<{ id: string }>(
      `SELECT id FROM webhook_deliveries WHERE endpoint_id = $1`,
      [id]
    );

    let outcome = await webhooks.attemptDelivery(delivery.rows[0].id);
    expect(outcome.status).toBe("retrying");

    for (let i = 0; i < webhooks.MAX_DELIVERY_ATTEMPTS; i += 1) {
      // The retry is scheduled for the future, so the row is nudged back to due
      // rather than waiting out a real hour.
      await client.query(`UPDATE webhook_deliveries SET next_attempt_at = now() WHERE id = $1`, [
        delivery.rows[0].id,
      ]);
      outcome = await webhooks.attemptDelivery(delivery.rows[0].id);
      if (outcome.status === "dead") break;
    }

    expect(outcome.status).toBe("dead");

    const final = await client.query<{ status: string; attempts: number }>(
      `SELECT status, attempts FROM webhook_deliveries WHERE id = $1`,
      [delivery.rows[0].id]
    );
    expect(final.rows[0].status).toBe("dead");
    expect(final.rows[0].attempts).toBe(webhooks.MAX_DELIVERY_ATTEMPTS);

    const endpoint = await client.query<{ consecutive_failures: number }>(
      `SELECT consecutive_failures FROM webhook_endpoints WHERE id = $1`,
      [id]
    );
    expect(endpoint.rows[0].consecutive_failures).toBe(1);
  });

  it("switches an endpoint off once it has failed ten times running", async () => {
    const id = await makeEndpoint([]);
    await client.query(
      `UPDATE webhook_endpoints SET consecutive_failures = 9, url = 'https://does-not-exist.invalid/x'
        WHERE id = $1`,
      [id]
    );

    await client.query(
      `INSERT INTO webhook_deliveries (endpoint_id, event_type, payload, attempts, next_attempt_at)
       VALUES ($1, 'test.ping', '{}'::jsonb, 4, now())`,
      [id]
    );
    const delivery = await client.query<{ id: string }>(
      `SELECT id FROM webhook_deliveries WHERE endpoint_id = $1 ORDER BY id DESC LIMIT 1`,
      [id]
    );

    await webhooks.attemptDelivery(delivery.rows[0].id);

    const endpoint = await client.query<{ enabled: boolean; disabled_reason: string }>(
      `SELECT enabled, disabled_reason FROM webhook_endpoints WHERE id = $1`,
      [id]
    );
    expect(endpoint.rows[0].enabled).toBe(false);
    expect(endpoint.rows[0].disabled_reason).toContain("10");
  });

  /* ---------------------------------------------------------------- MFA */

  it("spends a recovery code exactly once", async () => {
    const admin = await client.query<{ id: number }>(
      `INSERT INTO admin_users (email, password_hash, name, role)
       VALUES ('mfa@test.invalid', 'x', 'MFA', 'admin') RETURNING id`
    );
    const id = admin.rows[0].id;

    const codes = await mfa.issueRecoveryCodes(id);
    expect(codes).toHaveLength(10);
    expect(await mfa.countUnusedRecoveryCodes(id)).toBe(10);

    expect(await mfa.consumeRecoveryCode(id, codes[0])).toBe(true);
    expect(await mfa.consumeRecoveryCode(id, codes[0])).toBe(false);
    expect(await mfa.countUnusedRecoveryCodes(id)).toBe(9);

    // Case and hyphens are cosmetic — she reads these off a printout.
    expect(await mfa.consumeRecoveryCode(id, codes[1].toLowerCase().replace("-", " "))).toBe(true);

    // Regenerating invalidates everything issued before it.
    await mfa.issueRecoveryCodes(id);
    expect(await mfa.consumeRecoveryCode(id, codes[2])).toBe(false);
    expect(await mfa.countUnusedRecoveryCodes(id)).toBe(10);
  });

  it("will not accept another administrator's recovery code", async () => {
    const a = await client.query<{ id: number }>(
      `INSERT INTO admin_users (email, password_hash, name, role)
       VALUES ('mfa-a@test.invalid', 'x', 'A', 'admin') RETURNING id`
    );
    const b = await client.query<{ id: number }>(
      `INSERT INTO admin_users (email, password_hash, name, role)
       VALUES ('mfa-b@test.invalid', 'x', 'B', 'admin') RETURNING id`
    );

    const codes = await mfa.issueRecoveryCodes(a.rows[0].id);
    expect(await mfa.consumeRecoveryCode(b.rows[0].id, codes[0])).toBe(false);
    expect(await mfa.consumeRecoveryCode(a.rows[0].id, codes[0])).toBe(true);
  });

  /* ----------------------------------------------------------- sessions */

  it("recognises a live session and refuses a revoked or expired one", async () => {
    const { hashToken } = await import("../auth/tokens");
    const admin = await client.query<{ id: number }>(
      `INSERT INTO admin_users (email, password_hash, name, role)
       VALUES ('sessions@test.invalid', 'x', 'S', 'owner') RETURNING id`
    );
    const id = admin.rows[0].id;

    await client.query(
      `INSERT INTO admin_sessions (admin_user_id, token_hash, expires_at) VALUES
         ($1, $2, now() + interval '7 days'),
         ($1, $3, now() + interval '7 days'),
         ($1, $4, now() - interval '1 day')`,
      [id, hashToken("live"), hashToken("revoked"), hashToken("expired")]
    );
    await client.query(`UPDATE admin_sessions SET revoked_at = now() WHERE token_hash = $1`, [
      hashToken("revoked"),
    ]);

    const lookup = async (token: string) =>
      (
        await client.query(
          `SELECT id FROM admin_sessions
            WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
          [hashToken(token)]
        )
      ).rowCount;

    expect(await lookup("live")).toBe(1);
    expect(await lookup("revoked")).toBe(0);
    expect(await lookup("expired")).toBe(0);
    expect(await lookup("never-issued")).toBe(0);
  });

  /* --------------------------------------------------------- api keys */

  it("tells a newly inserted contact from an updated one", async () => {
    const upsert = async (email: string, first: string) =>
      client.query<{ inserted: boolean }>(
        `INSERT INTO contacts (email, first_name, last_name, name, phone, source)
         VALUES ($1, $2, '', $2, '', 'api')
         ON CONFLICT (email) DO UPDATE
           SET first_name = COALESCE(NULLIF(EXCLUDED.first_name, ''), contacts.first_name),
               updated_at = now()
         RETURNING id, (xmax = 0) AS inserted`,
        [email, first]
      );

    expect((await upsert("api@test.invalid", "Sam")).rows[0].inserted).toBe(true);
    expect((await upsert("api@test.invalid", "Sam")).rows[0].inserted).toBe(false);

    // A blank on the second write must not erase what the first one knew.
    await upsert("api@test.invalid", "");
    const row = await client.query<{ first_name: string }>(
      `SELECT first_name FROM contacts WHERE email = 'api@test.invalid'`
    );
    expect(row.rows[0].first_name).toBe("Sam");
  });

  it("finds an api key by the hash of the key and nothing else", async () => {
    const { hashToken, generateToken } = await import("../auth/tokens");
    const { formatApiKey, keyPrefix } = await import("../routes/public/apiV1");

    const key = formatApiKey("0a1b2c3d", generateToken(24));
    await client.query(
      `INSERT INTO api_keys (name, key_hash, key_prefix, scopes)
       VALUES ('Zapier', $1, $2, $3)`,
      [hashToken(key), keyPrefix(key), ["contacts.read"]]
    );

    const found = await client.query(`SELECT id FROM api_keys WHERE key_hash = $1`, [
      hashToken(key),
    ]);
    expect(found.rowCount).toBe(1);

    // The key itself is nowhere in the table.
    const raw = await client.query<{ key_hash: string; key_prefix: string }>(
      `SELECT key_hash, key_prefix FROM api_keys`
    );
    expect(raw.rows.some((r) => r.key_hash === key)).toBe(false);
    expect(keyPrefix(key)).toBe("0a1b2c3d");
  });
});
