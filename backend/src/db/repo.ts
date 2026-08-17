import { pool } from "./pool";
import { rowToCamel, rowsToCamel, toSnake } from "../utils/case";

/**
 * Minimal typed CRUD repository over a Postgres table with an integer `id` PK.
 * Converts snake_case columns <-> camelCase JSON on the way in/out.
 * `columns` is the whitelist of camelCase fields that may be written.
 */
export function createCrudRepo<T extends { id: number }>(
  table: string,
  columns: string[],
  /**
   * camelCase fields backed by JSONB columns.
   *
   * node-postgres serializes a JS array as a Postgres *array literal*
   * (`{a,b}`), which JSONB rejects with json_errsave_error. These fields are
   * explicitly JSON-encoded instead.
   */
  jsonColumns: string[] = []
) {
  /** Encodes JSONB values; leaves an already-serialized string untouched. */
  const encode = (field: string, value: unknown): unknown => {
    if (!jsonColumns.includes(field)) return value;
    if (typeof value === "string") return value;
    return JSON.stringify(value ?? null);
  };

  return {
    async list(opts: { where?: string; params?: unknown[]; orderBy?: string } = {}): Promise<T[]> {
      const where = opts.where ? `WHERE ${opts.where}` : "";
      const orderBy = opts.orderBy ?? "sort ASC, id ASC";
      const res = await pool.query(`SELECT * FROM ${table} ${where} ORDER BY ${orderBy}`, opts.params ?? []);
      return rowsToCamel<T>(res.rows);
    },

    async getById(id: number): Promise<T | null> {
      const res = await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
      if (res.rows.length === 0) return null;
      return rowToCamel<T>(res.rows[0]);
    },

    async getBySlug(slug: string): Promise<T | null> {
      const res = await pool.query(`SELECT * FROM ${table} WHERE slug = $1`, [slug]);
      if (res.rows.length === 0) return null;
      return rowToCamel<T>(res.rows[0]);
    },

    async create(data: Record<string, unknown>): Promise<T> {
      const fields = columns.filter((c) => data[c] !== undefined);
      const snakeCols = fields.map(toSnake);
      const placeholders = fields.map((_, i) => `$${i + 1}`);
      const values = fields.map((f) => encode(f, data[f]));
      const res = await pool.query(
        `INSERT INTO ${table} (${snakeCols.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING *`,
        values
      );
      return rowToCamel<T>(res.rows[0]);
    },

    async update(id: number, data: Record<string, unknown>): Promise<T | null> {
      const fields = columns.filter((c) => data[c] !== undefined);
      if (fields.length === 0) return this.getById(id);
      const snakeCols = fields.map(toSnake);
      const setClauses = snakeCols.map((c, i) => `${c} = $${i + 1}`);
      const values = fields.map((f) => encode(f, data[f]));
      const sql = `UPDATE ${table} SET ${setClauses.join(", ")}, updated_at = now() WHERE id = $${
        values.length + 1
      } RETURNING *`;
      const res = await pool.query(sql, [...values, id]);
      if (res.rows.length === 0) return null;
      return rowToCamel<T>(res.rows[0]);
    },

    async remove(id: number): Promise<boolean> {
      const res = await pool.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
      return (res.rowCount ?? 0) > 0;
    },
  };
}
