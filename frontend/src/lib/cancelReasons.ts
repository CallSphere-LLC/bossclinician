/**
 * The cancellation-reasons editor's model.
 *
 * The setting is stored as one `key | label` line per reason (see
 * backend/src/services/cancellationReasons.ts, whose `cancelReasonsProblem` this
 * mirrors). The owner never types a key: an existing reason keeps the one it was
 * saved with, so renaming it keeps its history in the reports, and a new reason
 * is given one made from its wording when it is saved.
 */

export interface ReasonRow {
  /** Local identity for React only. */
  id: string;
  key: string;
  label: string;
  /** True once saved — the key is then part of the report history. */
  keyLocked: boolean;
}

export const MAX_REASONS = 30;
export const MAX_REASON_LABEL = 160;
const KEY_PATTERN = /^[a-z][a-z0-9_]{1,49}$/;

let counter = 0;
const nextId = (): string => `reason-${Date.now().toString(36)}-${(counter += 1)}`;

export function rowsFromText(text: string): ReasonRow[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => {
      const sep = line.indexOf("|");
      const key = sep === -1 ? "" : line.slice(0, sep).trim();
      const label = sep === -1 ? line : line.slice(sep + 1).trim();
      return { id: nextId(), key, label, keyLocked: KEY_PATTERN.test(key) };
    });
}

export function newReasonRow(): ReasonRow {
  return { id: nextId(), key: "", label: "", keyLocked: false };
}

/** "It's too expensive" → "its_too_expensive", unique against `taken`. */
export function keyFromLabel(label: string, taken: Set<string>): string {
  let base = label
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40)
    .replace(/_+$/g, "");
  if (!/^[a-z]/.test(base)) base = base ? `reason_${base}` : "reason";
  if (base.length < 2) base = `reason_${base}`;

  let key = base;
  for (let n = 2; taken.has(key); n += 1) key = `${base}_${n}`;
  return key;
}

/** The rows as the stored text, minting keys for reasons that have none yet. */
export function textFromRows(rows: ReasonRow[]): string {
  const taken = new Set(rows.filter((row) => row.keyLocked).map((row) => row.key));
  return rows
    .map((row) => {
      let key = row.key;
      if (!row.keyLocked) {
        key = keyFromLabel(row.label, taken);
        taken.add(key);
      }
      return `${key} | ${row.label.trim()}`;
    })
    .join("\n");
}

export interface ReasonProblems {
  /** By row id: what is wrong with that reason. */
  rows: Record<string, string>;
  /** Wrong with the list as a whole. */
  list: string | null;
}

export function reasonProblems(rows: ReasonRow[]): ReasonProblems {
  const out: ReasonProblems = { rows: {}, list: null };
  const seen = new Map<string, string>();

  rows.forEach((row) => {
    const label = row.label.trim();
    if (label === "") {
      out.rows[row.id] = "Write what the customer will see, or remove this reason.";
      return;
    }
    if (label.length > MAX_REASON_LABEL) {
      out.rows[row.id] = `Keep it to ${MAX_REASON_LABEL} characters or fewer.`;
      return;
    }
    const lower = label.toLowerCase();
    if (seen.has(lower)) {
      out.rows[row.id] = "This reason is already on the list.";
      return;
    }
    seen.set(lower, row.id);
  });

  if (rows.length === 0) out.list = "Keep at least one reason, so a customer has something to choose.";
  else if (rows.length > MAX_REASONS) out.list = `Keep it to ${MAX_REASONS} reasons or fewer.`;
  return out;
}

/** The first problem with a stored value, in words — the Save button's gate. */
export function cancelReasonsProblem(text: string): string | null {
  const rows = rowsFromText(text);
  const problems = reasonProblems(rows);
  if (problems.list) return problems.list;

  const index = rows.findIndex((row) => problems.rows[row.id]);
  if (index !== -1) return `Cancellation reason ${index + 1}: ${problems.rows[rows[index].id]}`;

  const keys = new Set<string>();
  for (const [i, row] of rows.entries()) {
    if (!KEY_PATTERN.test(row.key)) {
      return `Cancellation reason ${i + 1} could not be given a report key. Try rewording it.`;
    }
    if (keys.has(row.key)) return `Two cancellation reasons share the report key "${row.key}".`;
    keys.add(row.key);
  }
  return null;
}
