import fs from "fs";
import path from "path";
import { pool } from "./pool";

/**
 * Schema bootstrap, in two stages.
 *
 * 1. `schema.sql` is the baseline. Every statement in it uses IF NOT EXISTS, so
 *    it stays safe to re-run on every boot and keeps describing the shape the
 *    original build shipped with.
 * 2. `migrations/*.sql` are forward-only, applied once each, in filename order,
 *    and recorded in `schema_migrations`. One file per delivery phase.
 *
 * Splitting them this way means a phase migration can use plain `ALTER TABLE`
 * and `CREATE TABLE` without the IF NOT EXISTS contortions the baseline needs,
 * and a failed migration stops the boot loudly instead of half-applying.
 */

const MIGRATIONS_DIR = path.join(__dirname, "migrations");

async function ensureMigrationsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name        TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

function migrationFiles(): string[] {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/**
 * Applies the baseline then any unapplied migrations.
 *
 * Each migration runs inside its own transaction: Postgres executes DDL
 * transactionally, so a file that fails half way leaves the database exactly as
 * it was rather than in a state no migration describes.
 */
export async function applySchema(): Promise<void> {
  const schemaPath = path.join(__dirname, "schema.sql");
  const sql = fs.readFileSync(schemaPath, "utf-8");
  await pool.query(sql);

  await ensureMigrationsTable();

  const applied = new Set(
    (await pool.query<{ name: string }>(`SELECT name FROM schema_migrations`)).rows.map(
      (r) => r.name
    )
  );

  for (const file of migrationFiles()) {
    if (applied.has(file)) continue;

    const body = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(body);
      await client.query(`INSERT INTO schema_migrations (name) VALUES ($1)`, [file]);
      await client.query("COMMIT");
      // eslint-disable-next-line no-console
      console.log(`[migrate] applied ${file}`);
    } catch (err) {
      await client.query("ROLLBACK");
      // eslint-disable-next-line no-console
      console.error(`[migrate] FAILED ${file}:`, err);
      throw err;
    } finally {
      client.release();
    }
  }
}
