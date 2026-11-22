import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

/**
 * Migration 226 (Yvette, 22 Nov 2026, items 9 and 10). The 301s it writes to the
 * `redirects` table are served by nginx from the committed nginx/redirects.map,
 * which the k3s gateway image copies as is, so the two must agree row for row.
 */
const ROOT = path.join(__dirname, "../../..");
const MIGRATION = fs.readFileSync(
  path.join(__dirname, "migrations/226_retire_boss_builders_reset_audit.sql"),
  "utf8",
);
const MAP_PATH = path.join(ROOT, "nginx/redirects.map");
// The backend image carries no nginx/ folder; the map checks run from a repo checkout.
const HAS_MAP = fs.existsSync(MAP_PATH);
const MAP = HAS_MAP ? fs.readFileSync(MAP_PATH, "utf8") : "";

function permanentMap(): Map<string, string> {
  const block = /map \$uri \$redirect_target \{([\s\S]*?)\n\}/.exec(MAP)?.[1] ?? "";
  const rows = new Map<string, string>();
  for (const line of block.split("\n")) {
    const m = /^\s*(\/\S*)\s+(\S+);\s*$/.exec(line);
    if (m) rows.set(m[1], m[2]);
  }
  return rows;
}

const EXPECTED: Record<string, string> = {
  "/profitable-private-practice-leap-accelerator": "/club",
  "/leap-accelerator-thank-you": "/club",
  "/pppbossbuildersales": "/club",
  "/checkout/ppp-collective": "/club",
  "/boss-builders-sales-page": "/club",
  "/the-boss-builders-collective-thank-you-page": "/club",
  "/reset-audit": "/practice-reset-planner",
  "/reset-audit-form": "/reset-planner-form",
  "/practice-reset-audit-ty": "/practice-reset-planner",
  "/uploads/kajabi-rehost/practice-reset-audit-fillable-c996ffdf7c4c.pdf": "/downloads/practice-freedom-audit.pdf",
};

describe("migration 226 — retire Boss Builders Collective and the Practice Reset Audit", () => {
  const map = permanentMap();

  it.skipIf(!HAS_MAP)("nginx/redirects.map serves every 301 the migration writes", () => {
    for (const [from, to] of Object.entries(EXPECTED)) {
      expect(map.get(from), from).toBe(to);
    }
  });

  it("writes the same redirect rows it promises", () => {
    for (const [from, to] of Object.entries(EXPECTED)) {
      if (from.startsWith("/boss-builders") || from.startsWith("/the-boss-builders")) continue;
      expect(MIGRATION).toContain(`('${from}', '${to}', 301, true,`);
    }
    expect(MIGRATION).toMatch(/SET to_path = '\/club'[\s\S]*'\/boss-builders-sales-page', '\/the-boss-builders-collective-thank-you-page'/);
  });

  it.skipIf(!HAS_MAP)("keeps the map's row count header honest", () => {
    const declared = Number(/# Generated from (\d+) rows\./.exec(MAP)?.[1]);
    const temp = /map \$uri \$redirect_target_temp \{([\s\S]*?)\n\}/.exec(MAP)?.[1] ?? "";
    const tempRows = temp.split("\n").filter((l) => /^\s*\/\S*\s+\S+;/.test(l)).length;
    expect(map.size + tempRows).toBe(declared);
  });

  it.skipIf(!HAS_MAP)("does not catch the Club's First 30 Days planner or any other upload", () => {
    for (const from of map.keys()) {
      if (from.startsWith("/uploads/")) {
        expect(from).toBe("/uploads/kajabi-rehost/practice-reset-audit-fillable-c996ffdf7c4c.pdf");
      }
    }
    expect(MIGRATION).not.toMatch(/the-first-30-days-success-planner/);
  });

  it("never deletes or rewrites member data, orders or sent campaigns", () => {
    const sql = MIGRATION.replace(/--.*$/gm, "");
    expect(sql).not.toMatch(/\b(orders|purchases|access_grants|email_campaigns|contacts|form_submissions)\b/i);
    expect(sql).not.toMatch(/\bamount_cents\b|\bstripe_/i);
    // The only DELETE is the one Kajabi-import funnel record, by id and kajabi_id.
    const deletes = sql.match(/DELETE FROM \w+[\s\S]*?;/g) ?? [];
    expect(deletes).toHaveLength(1);
    expect(deletes[0]).toMatch(/^DELETE FROM funnels\s+WHERE id = 27 AND kajabi_id = '2148658460'/);
  });

  it("sends nobody anything: it only pauses, archives, unpublishes and rewords", () => {
    const sql = MIGRATION.replace(/--.*$/gm, "");
    expect(sql).not.toMatch(/INSERT INTO (sequence_subscriptions|email_sends|jobs|email_campaigns)/i);
    expect(sql).not.toMatch(/status = 'active'\s*,|SET status = 'active'/);
    expect(sql).not.toContain("{{");
  });

  it("drops the Boss Builders Collective name from the published CEU offer bio", () => {
    expect(MIGRATION).toMatch(
      /WHERE id = 115 AND slug = 'profitable-private-practices-ceu'\s+AND position\('the creator of Boss Builders Collective , where she coaches' in description\) > 0/,
    );
  });

  it("uses support@bossclinician.com as the checkout support address only where it was blank", () => {
    expect(MIGRATION).toMatch(
      /jsonb_set\(value, '\{supportEmail\}', to_jsonb\('support@bossclinician\.com'::text\)\)[\s\S]*WHERE key = 'checkout' AND coalesce\(value->>'supportEmail', ''\) = ''/,
    );
  });
});
