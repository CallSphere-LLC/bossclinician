import type { PoolClient } from "pg";

/**
 * Yvette, 23 Nov 2026 (item 12; migration 228): the Retreat Deposit email
 * (sequence 493, email 1619) shows shared-room details only to guests with a
 * confirmed shared-room arrangement, not to every buyer. The room comes from
 * the guest's retreat_guests.room_type (Admin > Retreats > Guests).
 *
 * Tokens: {{retreat_room_label}}, {{retreat_room_balance_line}},
 * {{retreat_room_total_line}}. Values are plain text (rich emails escape them).
 * A guest with no confirmed room gets a neutral line, never the shared one.
 */
type Queryable = Pick<PoolClient, "query">;

export const RETREAT_ROOM_TOKENS = ["retreat_room_label", "retreat_room_balance_line", "retreat_room_total_line"] as const;
type RoomToken = (typeof RETREAT_ROOM_TOKENS)[number];

const BLOCKS: Record<"private" | "shared" | "unknown", Record<RoomToken, string>> = {
  private: {
    retreat_room_label: "Private King Suite",
    retreat_room_balance_line: "Remaining balance: $5,000",
    retreat_room_total_line: "Total investment: $5,500",
  },
  shared: {
    retreat_room_label: "Shared Luxury Room",
    retreat_room_balance_line: "Remaining balance: $4,000 per person",
    retreat_room_total_line: "Total investment: $4,500 per person",
  },
  unknown: {
    retreat_room_label: "Your room",
    retreat_room_balance_line:
      "Your remaining balance depends on your room. Write to retreats@bossclinician.com and we will confirm it for you.",
    retreat_room_total_line: "Final payment deadline: June 8, 2027",
  },
};

export function retreatRoomValues(roomType: string | null | undefined): Record<string, string> {
  return { ...BLOCKS[roomType === "private" || roomType === "shared" ? roomType : "unknown"] };
}

export async function retreatRoomMergeValuesSafe(client: Queryable, email: string): Promise<Record<string, string>> {
  try {
    await client.query("SAVEPOINT retreat_room_merge");
    const r = await client.query<{ room_type: string | null }>(
      `SELECT g.room_type
         FROM retreat_guests g
         JOIN members m ON m.id = g.member_id
         JOIN retreats rt ON rt.id = g.retreat_id
        WHERE lower(m.email) = lower($1) OR (g.booking_email <> '' AND lower(g.booking_email) = lower($1))
        ORDER BY rt.start_date DESC NULLS LAST, g.retreat_id DESC
        LIMIT 1`,
      [email]
    );
    await client.query("RELEASE SAVEPOINT retreat_room_merge");
    return retreatRoomValues(r.rows[0]?.room_type ?? null);
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT retreat_room_merge").catch(() => undefined);
    console.error("[retreat-room] could not read the guest room for an email", {
      error: error instanceof Error ? error.message : String(error),
    });
    return retreatRoomValues(null);
  }
}
