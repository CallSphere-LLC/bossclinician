import { pool } from "../db/pool";

/**
 * The member as every authenticated response describes them.
 *
 * One shape, produced in one place: /register, /login, /refresh, /magic-link
 * and /me all hand the browser the same object, so a signed-in tab never has to
 * reconcile two slightly different pictures of who it is.
 */
export interface MemberProfile {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  name: string;
  avatarUrl: string;
  timezone: string;
  locale: string;
  status: string;
  emailVerifiedAt: string | null;
  createdAt: string;
  /** Present only while an admin is viewing the site as this member. */
  impersonatedBy?: number;
}

/** Every column `toMemberProfile` reads. Kept here so no caller can under-select. */
export const MEMBER_PROFILE_COLUMNS =
  "id, email, name, first_name, last_name, avatar_url, timezone, locale, status, email_verified_at, created_at";

export interface MemberProfileRow {
  id: number;
  email: string;
  name: string;
  first_name: string;
  last_name: string;
  avatar_url: string;
  timezone: string;
  locale: string;
  status: string;
  email_verified_at: Date | string | null;
  created_at: Date | string;
}

/**
 * Mirrors the `members.timezone` column default. Registration needs the value in
 * JS as well as in the DDL, because an omitted timezone has to land on the same
 * zone whether the row is being created or an invited row is being claimed.
 */
export const DEFAULT_TIMEZONE = "America/New_York";

/** pg hands back TIMESTAMPTZ as a Date; the JSON contract is an ISO string. */
function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

export function toMemberProfile(row: MemberProfileRow, impersonatedBy?: number): MemberProfile {
  const split = `${row.first_name} ${row.last_name}`.trim();

  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    // `name` predates first_name/last_name and the admin list still reads it, so
    // it stays the display name — used verbatim for the members Yvette typed in
    // by hand, and derived once someone fills in the split fields themselves.
    name: split || row.name,
    avatarUrl: row.avatar_url,
    timezone: row.timezone,
    locale: row.locale,
    status: row.status,
    emailVerifiedAt: iso(row.email_verified_at),
    createdAt: iso(row.created_at) ?? "",
    ...(impersonatedBy === undefined ? {} : { impersonatedBy }),
  };
}

export async function loadMemberProfile(
  id: number,
  impersonatedBy?: number
): Promise<MemberProfile | null> {
  const result = await pool.query<MemberProfileRow>(
    `SELECT ${MEMBER_PROFILE_COLUMNS} FROM members WHERE id = $1`,
    [id]
  );
  const row = result.rows[0];
  return row ? toMemberProfile(row, impersonatedBy) : null;
}
