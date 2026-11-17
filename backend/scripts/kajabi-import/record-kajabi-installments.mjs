#!/usr/bin/env node
/**
 * Record Kajabi-collected payment-plan instalments that happened AFTER the
 * one-off Kajabi import (2026-09-27), so the admin's purchase cards match
 * Kajabi (QA sheet row 232, retreat payment plans).
 *
 * Why this exists: the Kajabi purchases (migration 076, source='kajabi') are a
 * SNAPSHOT. Kajabi kept charging the retreat plans after the import (Oct 12,
 * Oct 20, Nov 12, Nov 20 ...), and nothing syncs those charges here, so the
 * cards stay at "1/10" / "2/12" with a stale "Upcoming Oct 20" line.
 *
 * WHAT IT WRITES (and nothing else):
 *   - one `orders` row per confirmed instalment, shaped exactly like the
 *     imported Kajabi instalments (source 'kajabi', status 'paid', notes
 *     "Payment plan instalment N" where N counts the setup fee as 1,
 *     owner_notified_at set so no sale notification can ever go out for it,
 *     no Stripe/PayPal ids), linked with purchase_id;
 *   - one `transactions` row (kind 'payment', status 'succeeded');
 *   - the purchase's installments_paid / next_payment_at / next_payment_cents /
 *     meta.kajabiProgressText (and status 'completed' when paid off);
 *   - optionally, for "close" entries, the Kajabi plan is marked ended
 *     (status 'canceled', ended_at, next payment cleared) once Kajabi stops
 *     billing, so the admin stops showing an "Upcoming" Kajabi charge.
 *
 * WHAT IT NEVER DOES: no Stripe/PayPal call, no email, no automation, no
 * access_grants change, no payment_plans row (so the dunning/charge jobs, which
 * read payment_plans only, never see these). Purchase 2 style "paused" plans
 * are refused.
 *
 * Idempotent: an instalment already present (same purchase_id + same
 * "Payment plan instalment N" note, paid) is skipped; re-running only
 * recomputes the purchase summary.
 *
 * INPUT (JSON, kept OUTSIDE the repo — customer data stays out of git, as
 * migration 076 requires):
 *   {
 *     "payments": [
 *       { "purchaseId": 3, "instalment": 4, "amountCents": 25000,
 *         "paidAt": "2026-10-20T23:20:00-07:00",
 *         "kajabiTransaction": "<optional Kajabi transaction id>",
 *         "confirmed": true }
 *     ],
 *     "close": [
 *       { "purchaseId": 3, "endedAt": "2026-11-23T00:00:00-08:00",
 *         "reason": "Kajabi account closed; balance continues on bossclinician.com",
 *         "confirmed": true }
 *     ]
 *   }
 *   `instalment` is Kajabi's payment number counting the $500 setup fee as 1
 *   (so Kajabi's "3/12 payments completed" = setup + instalments 2..4 here).
 *   Entries with confirmed !== true are shown in a dry run but REFUSED by
 *   --commit: only enter what Yvette has confirmed in Kajabi (date + amount).
 *
 * Usage. Needs the `pg` package next to it (ESM ignores NODE_PATH; the
 * worktrees have no node_modules). Run it inside the boss-app backend
 * container, where DATABASE_URL, /app/node_modules/pg and the Postgres CA are:
 *   P=$(sudo kubectl -n bossclinician get pods -o name | grep boss-app)
 *   sudo kubectl -n bossclinician cp record-kajabi-installments.mjs ${P#pod/}:/app/.rki.mjs -c backend
 *   sudo kubectl -n bossclinician cp payments.json ${P#pod/}:/app/.rki.json -c backend
 *   sudo kubectl -n bossclinician exec $P -c backend -- node /app/.rki.mjs --input /app/.rki.json            # dry run
 *   sudo kubectl -n bossclinician exec $P -c backend -- node /app/.rki.mjs --input /app/.rki.json --commit   # apply
 *   sudo kubectl -n bossclinician exec $P -c backend -- rm -f /app/.rki.mjs /app/.rki.json
 * NOTE: even the dry run INSERTs and locks the purchase rows before its
 * ROLLBACK (and advances the orders/transactions id sequences).
 * Tested 2026-11-16 only on a scratch copy of the four retreat purchases.
 *
 * AFTER --commit: contact totals refresh on their own (contacts.rollup, hourly).
 * The Reports figures do NOT: the nightly reports.rollup only redoes yesterday
 * and today, so rebuild the range of the backdated payments (admin Reports
 * "update these figures", or a reports.rebuild job {from, to}).
 *
 * Env: DATABASE_URL (or ~/.bc-dburl). PG_CA_FILE optional (default
 * /etc/bossclinician/pg-ca/ca.crt when present).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
};
if (flag("--commit") && flag("--dry-run")) {
  console.error("Choose --dry-run or --commit, not both.");
  process.exit(2);
}
const COMMIT = flag("--commit");
const INPUT = opt("--input");
if (!INPUT) {
  console.error("--input <file.json> is required");
  process.exit(2);
}

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const f = path.join(os.homedir(), ".bc-dburl");
  if (fs.existsSync(f)) return fs.readFileSync(f, "utf8").trim();
  throw new Error("DATABASE_URL not set and ~/.bc-dburl not found");
}
function poolConfig() {
  const caFile = process.env.PG_CA_FILE || "/etc/bossclinician/pg-ca/ca.crt";
  if (!fs.existsSync(caFile)) return { connectionString: databaseUrl(), max: 1 };
  const u = new URL(databaseUrl());
  u.searchParams.delete("sslmode");
  return { connectionString: u.toString(), max: 1, ssl: { ca: fs.readFileSync(caFile, "utf8"), rejectUnauthorized: false } };
}

/** Same day next month, clamped to month end (Kajabi bills on the anniversary). */
function nextMonth(d) {
  const x = new Date(d.getTime());
  const day = x.getUTCDate();
  x.setUTCDate(1);
  x.setUTCMonth(x.getUTCMonth() + 1);
  const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate();
  x.setUTCDate(Math.min(day, last));
  return x;
}

const input = JSON.parse(fs.readFileSync(INPUT, "utf8"));
const payments = Array.isArray(input.payments) ? input.payments : [];
const closes = Array.isArray(input.close) ? input.close : [];

const problems = [];
for (const p of payments) {
  const where = `payment ${JSON.stringify(p)}`;
  if (!Number.isInteger(p.purchaseId)) problems.push(`${where}: purchaseId must be an integer`);
  if (!Number.isInteger(p.instalment) || p.instalment < 2) problems.push(`${where}: instalment must be an integer >= 2 (1 is the setup fee)`);
  if (!Number.isInteger(p.amountCents) || p.amountCents <= 0) problems.push(`${where}: amountCents must be a positive integer`);
  if (!p.paidAt || !Number.isFinite(new Date(p.paidAt).getTime())) problems.push(`${where}: paidAt must be an ISO timestamp with offset`);
  if (COMMIT && p.confirmed !== true) problems.push(`${where}: not confirmed — --commit refuses unconfirmed payments`);
}
for (const c of closes) {
  if (!Number.isInteger(c.purchaseId)) problems.push(`close ${JSON.stringify(c)}: purchaseId must be an integer`);
  if (!c.endedAt || !Number.isFinite(new Date(c.endedAt).getTime())) problems.push(`close ${JSON.stringify(c)}: endedAt must be an ISO timestamp`);
  if (COMMIT && c.confirmed !== true) problems.push(`close ${JSON.stringify(c)}: not confirmed — --commit refuses it`);
}
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(2);
}

const pool = new pg.Pool(poolConfig());
const client = await pool.connect();
let finished = false;
try {
  await client.query("BEGIN");
  console.log(`record-kajabi-installments — ${COMMIT ? "COMMIT" : "DRY RUN (rolled back)"} — ${INPUT}`);

  const purchaseIds = [...new Set([...payments.map((p) => p.purchaseId), ...closes.map((c) => c.purchaseId)])];
  const { rows: purchases } = await client.query(
    `SELECT id, contact_id, offer_title, kind, source, status, installment_cents, installments_total,
            installments_paid, currency, meta
       FROM purchases WHERE id = ANY($1::int[]) FOR UPDATE`,
    [purchaseIds]
  );
  const byId = new Map(purchases.map((r) => [r.id, r]));
  for (const id of purchaseIds) {
    const pur = byId.get(id);
    if (!pur) throw new Error(`purchase ${id} not found`);
    if (pur.source !== "kajabi" || pur.kind !== "payment_plan") throw new Error(`purchase ${id} is not a Kajabi payment plan`);
    if (pur.status === "paused" || pur.status === "refunded") throw new Error(`purchase ${id} is ${pur.status}; refusing`);
  }

  for (const p of payments) {
    const pur = byId.get(p.purchaseId);
    if (p.amountCents !== pur.installment_cents) {
      throw new Error(`purchase ${pur.id}: amount ${p.amountCents} != plan instalment ${pur.installment_cents}`);
    }
    if (p.instalment - 1 > pur.installments_total) {
      throw new Error(`purchase ${pur.id}: instalment ${p.instalment} is past the plan's ${pur.installments_total} payments + setup`);
    }
    const note = `Payment plan instalment ${p.instalment}`;
    const dup = await client.query(
      `SELECT id FROM orders WHERE purchase_id = $1 AND notes = $2 AND status IN ('paid','refunded')`,
      [pur.id, note]
    );
    if (dup.rows.length) {
      console.log(`  skip  purchase ${pur.id} ${note}: already order ${dup.rows[0].id}`);
      continue;
    }
    // Same shape as the imported Kajabi instalments (e.g. orders 28/33).
    const ins = await client.query(
      `INSERT INTO orders (course_title, email, amount_cents, currency, status, created_at, updated_at,
                           subtotal_cents, discount_cents, tax_cents, total_cents, refunded_cents,
                           custom_field_data, source, notes, contact_id, purchase_id,
                           owner_notified_at, payment_provider)
       SELECT $2, COALESCE(c.email, ''), $3, $4, 'paid', $5, now(),
              $3, 0, 0, $3, 0,
              jsonb_build_object('kajabiType', 'Payment Plan',
                                 'kajabiPurchaseId', $6::text,
                                 'kajabiTransaction', $7::text,
                                 'recordedBy', 'record-kajabi-installments (row 232)'),
              'kajabi', $8, $9, $1, now(), 'stripe'
         FROM (SELECT 1) one LEFT JOIN contacts c ON c.id = $9
       RETURNING id, email`,
      [
        pur.id,
        pur.offer_title,
        p.amountCents,
        pur.currency || "usd",
        new Date(p.paidAt),
        String(pur.meta?.kajabiPurchaseId ?? ""),
        p.kajabiTransaction ? String(p.kajabiTransaction) : `manual:${pur.id}:${p.instalment}`,
        note,
        pur.contact_id,
      ]
    );
    const order = ins.rows[0];
    await client.query(
      `INSERT INTO transactions (order_id, email, kind, status, amount_cents, fee_cents, net_cents, currency, occurred_at)
       VALUES ($1, $2, 'payment', 'succeeded', $3, 0, $3, $4, $5)`,
      [order.id, order.email, p.amountCents, pur.currency || "usd", new Date(p.paidAt)]
    );
    console.log(`  add   purchase ${pur.id} ${note}: order ${order.id} ${p.amountCents}c at ${p.paidAt}${p.confirmed === true ? "" : "  [UNCONFIRMED]"}`);
  }

  // Recompute each touched purchase from its linked paid instalment orders.
  for (const id of purchaseIds) {
    const pur = byId.get(id);
    const { rows } = await client.query(
      `SELECT notes, created_at FROM orders
        WHERE purchase_id = $1 AND status = 'paid' AND notes LIKE 'Payment plan instalment %'
        ORDER BY created_at`,
      [id]
    );
    const numbers = rows.map((r) => Number(r.notes.replace("Payment plan instalment ", ""))).filter(Number.isInteger);
    const highest = numbers.length ? Math.max(...numbers) : 1;
    // A typo (5 for 4) must not silently skip a payment and inflate the count.
    const sorted = [...new Set(numbers)].sort((a, b) => a - b);
    if (sorted.length !== highest || sorted.some((n, i) => n !== i + 1)) {
      throw new Error(`purchase ${id}: instalment numbers are not contiguous from 1: ${sorted.join(",")}`);
    }
    const paid = Math.max(0, highest - 1); // instalment 1 is the setup fee
    const last = rows.length ? new Date(rows[rows.length - 1].created_at) : null;
    const done = paid >= pur.installments_total;
    const close = closes.find((c) => c.purchaseId === id);
    const progress = `${paid}/${pur.installments_total} payments completed`;
    let status = done ? "completed" : pur.status === "past_due" ? "active" : pur.status;
    const ended = pur.status === "canceled" || pur.status === "completed";
    let nextAt = done || ended || !last ? null : nextMonth(last);
    let nextCents = done || ended ? null : pur.installment_cents;
    let endedAt = null;
    let billing = done ? "Completed" : pur.meta?.kajabiBillingStatus ?? "Active";
    if (close && !done) {
      status = "canceled";
      nextAt = null;
      nextCents = null;
      endedAt = new Date(close.endedAt);
      billing = `Ended on Kajabi (${close.reason || "Kajabi closed"})`;
    }
    await client.query(
      `UPDATE purchases
          SET installments_paid = $2, status = $3, next_payment_at = $4, next_payment_cents = $5,
              ended_at = COALESCE($6, ended_at),
              meta = meta || jsonb_build_object('kajabiProgressText', $7::text, 'kajabiBillingStatus', $8::text,
                                                'row232UpdatedAt', now()::text),
              updated_at = now()
        WHERE id = $1`,
      [id, paid, done ? "completed" : status, nextAt, nextCents, done ? last : endedAt, progress, billing]
    );
    console.log(
      `  purch ${id} (${pur.offer_title}): ${pur.installments_paid}/${pur.installments_total} -> ${paid}/${pur.installments_total}, ` +
        `status ${pur.status} -> ${done ? "completed" : status}, next ${nextAt ? nextAt.toISOString().slice(0, 10) : "none"}` +
        `, remaining ${Math.max(0, pur.installments_total - paid)} x ${pur.installment_cents}c`
    );
  }

  if (COMMIT) {
    await client.query("COMMIT");
    console.log("COMMITTED.");
  } else {
    await client.query("ROLLBACK");
    console.log("Dry run — rolled back. Re-run with --commit to apply.");
  }
  finished = true;
} finally {
  if (!finished) await client.query("ROLLBACK").catch(() => {});
  client.release();
  await pool.end();
}
