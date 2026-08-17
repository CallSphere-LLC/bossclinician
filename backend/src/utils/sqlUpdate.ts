import { toSnake } from "./case";

/**
 * Builds a parameterised SET clause from a request body against a column
 * whitelist.
 *
 * The whitelist is what makes this safe: column names are never interpolated
 * from user input, only matched against a fixed list, and every value goes
 * through a bind parameter.
 *
 * Returns null when the body contains no updatable fields, so callers can
 * reject the request instead of emitting `SET  WHERE id = $1`.
 */
export function buildUpdate(
  body: Record<string, unknown>,
  allowedColumns: readonly string[],
): { clause: string; values: unknown[] } | null {
  const sets: string[] = [];
  const values: unknown[] = [];

  for (const [key, value] of Object.entries(body)) {
    const column = toSnake(key);
    if (!allowedColumns.includes(column)) continue;
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  }

  if (sets.length === 0) return null;
  return { clause: sets.join(", "), values };
}
