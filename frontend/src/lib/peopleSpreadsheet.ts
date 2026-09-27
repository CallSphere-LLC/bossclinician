/* ------------------------------------------------- Reading her spreadsheet */

/** One person read off a line, in the shape `POST /admin/contacts/import` takes. */
export interface ImportRow {
  email: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  tags?: string;
  /** Comma-separated, as the old system lists what they bought. */
  products?: string;
  /** When they first joined the old system, as the file writes it. */
  createdAt?: string;
  lastActivityAt?: string;
  /** Every other column, keyed by its heading, so nothing in the file is lost. */
  customFields?: Record<string, string>;
}

type Field = Exclude<keyof ImportRow, "customFields">;

/** Column headings she might have used, mapped to what we keep. */
const HEADINGS: Record<string, Field> = {
  email: "email",
  "email address": "email",
  "e-mail": "email",
  name: "name",
  "full name": "name",
  "first name": "firstName",
  firstname: "firstName",
  "given name": "firstName",
  "last name": "lastName",
  lastname: "lastName",
  surname: "lastName",
  phone: "phone",
  "phone number": "phone",
  mobile: "phone",
  "mobile phone number": "phone",
  tags: "tags",
  tag: "tags",
  products: "products",
  "created at": "createdAt",
  "date added": "createdAt",
  "last activity": "lastActivityAt",
};

/**
 * Card details are never taken in, whatever the file holds under them. Kajabi's
 * export carries "Credit Card Number", "Expiration" and "CW" columns from an old
 * payment form; they are empty today, and the server refuses them too.
 */
const REFUSED_HEADING = /credit\s*card|card\s*number|\bcvv\b|\bcvc\b|\bcw\b|expiration|security\s*code/i;

/**
 * Kajabi writes custom headings as `Question (custom_14)`. The part in brackets
 * is its internal key; the question is what she will recognise on the screen.
 */
function splitHeading(heading: string): { label: string; key: string } {
  const match = /^(.*?)\s*\(([a-z0-9_]+)\)\s*$/i.exec(heading.trim());
  return match ? { label: match[1].trim(), key: match[2] } : { label: heading.trim(), key: "" };
}

/**
 * Splits pasted spreadsheet text into rows of cells.
 *
 * Hand-rolled because the only thing harder here than `split(",")` is quoted
 * cells: a name like "Howard, Yvette" comes out of Excel wrapped in quotes with
 * its comma intact, and a naive split silently shifts every column after it
 * onto the wrong person.
 */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (quoted) {
      if (char !== '"') {
        cell += char;
      } else if (text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else {
        quoted = false;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(cell.trim());
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell.trim());
  rows.push(row);
  return rows.filter((cells) => cells.some((value) => value !== ""));
}

export interface ParsedSpreadsheet {
  rows: ImportRow[];
  /** Lines with nothing that looks like an email address on them. */
  unusable: number;
}

type Column =
  | { kind: "field"; field: Field; heading: string }
  | { kind: "custom"; heading: string }
  | { kind: "refused" };

function readHeading(cell: string, used: Set<string>): Column {
  const heading = cell.trim();
  if (!heading) return { kind: "refused" };
  if (REFUSED_HEADING.test(heading)) return { kind: "refused" };
  const { label, key } = splitHeading(heading);
  const field =
    HEADINGS[heading.toLowerCase()] ?? HEADINGS[label.toLowerCase()] ?? HEADINGS[key.toLowerCase()];
  if (field) return { kind: "field", field, heading };

  // Two columns asking the same question must not overwrite each other, so the
  // second keeps Kajabi's key beside the label.
  let name = label || heading;
  if (used.has(name)) name = heading;
  used.add(name);
  return { kind: "custom", heading: name };
}

/**
 * Pasted text → the people in it.
 *
 * Deliberately forgiving, because the file is whatever her old system gave her:
 * copying straight out of a spreadsheet produces tabs rather than commas, the
 * headings might be missing entirely, and the columns arrive in any order.
 * Anything we can't place is counted rather than dropped silently, so the
 * numbers she sees back add up to the file she handed over. A column we have no
 * field for is kept as a custom field under its heading, not thrown away.
 */
export function readSpreadsheet(text: string): ParsedSpreadsheet {
  // `File.text()` keeps a byte-order mark, which would hide the first heading.
  const clean = text.replace(/^﻿/, "");
  if (!clean.trim()) return { rows: [], unusable: 0 };

  const firstLine = clean.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = firstLine.split("\t").length > firstLine.split(",").length ? "\t" : ",";
  const table = parseDelimited(clean, delimiter);
  if (table.length === 0) return { rows: [], unusable: 0 };

  const hasHeadings = !table[0].some((cell) => cell.includes("@"));
  const used = new Set<string>();
  const mapped = hasHeadings ? table[0].map((cell) => readHeading(cell, used)) : null;
  // Headings we don't recognise are no better than none: fall back to reading
  // each line by eye rather than filing every column under nothing.
  const columns = mapped?.some((column) => column.kind === "field" && column.field === "email")
    ? mapped
    : null;
  const body = hasHeadings ? table.slice(1) : table;

  const rows: ImportRow[] = [];
  let unusable = 0;

  for (const line of body) {
    const row: Partial<ImportRow> = {};
    const custom: Record<string, string> = {};
    line.forEach((cell, index) => {
      if (!cell) return;
      if (!columns) {
        const field: Field = cell.includes("@") ? "email" : "name";
        if (!row[field]) row[field] = cell;
        return;
      }
      const column = columns[index];
      if (!column || column.kind === "refused") return;
      if (column.kind === "custom") {
        custom[column.heading] = cell;
        return;
      }
      const current = row[column.field];
      // Kajabi repeats some fields ("Email" and "Email (email)"). The first one
      // wins; a second that disagrees is kept under its own heading.
      // Kajabi's "First Name (name)" is really the full name, so a repeat that
      // matches anything already read off the line adds nothing.
      if (!current) row[column.field] = cell;
      else if (!Object.values(row).some((value) => typeof value === "string" && value.toLowerCase() === cell.toLowerCase())) {
        custom[column.heading] = cell;
      }
    });
    if (Object.keys(custom).length) row.customFields = custom;
    if (row.email) rows.push(row as ImportRow);
    else unusable += 1;
  }

  return { rows, unusable };
}
