import { describe, expect, it } from "vitest";
import { retreatRoomValues } from "./retreatRoomBlock";

describe("retreat deposit email room block (23 Nov 2026, item 12)", () => {
  it("shows shared-room lines only to a confirmed shared-room guest", () => {
    expect(retreatRoomValues("shared").retreat_room_label).toBe("Shared Luxury Room");
    expect(retreatRoomValues("private").retreat_room_label).toBe("Private King Suite");
    for (const room of [null, undefined, "", "other"]) {
      const v = retreatRoomValues(room);
      expect(JSON.stringify(v)).not.toMatch(/Shared|per person/);
      expect(Object.values(v).every((x) => x.trim().length > 0)).toBe(true);
    }
  });
});
