import { describe, expect, it } from "vitest";
import { previewWindow } from "./availability";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-09-27T12:00:00Z");

describe("previewWindow", () => {
  it("stops at the booking horizon, as the member's slot list does", () => {
    const window = previewWindow({ durationMinutes: 60 }, { bookingHorizonDays: 7 }, NOW);
    expect(window.from.toISOString()).toBe(NOW.toISOString());
    expect(window.to.getTime()).toBe(NOW.getTime() + 7 * DAY_MS);
  });

  it("keeps the two-week default when the horizon is further out", () => {
    const window = previewWindow({ durationMinutes: 60 }, { bookingHorizonDays: 60 }, NOW);
    expect(window.to.getTime()).toBe(NOW.getTime() + 14 * DAY_MS);
  });

  it("reads bookings one session length past the end", () => {
    const window = previewWindow({ durationMinutes: 90 }, { bookingHorizonDays: 60 }, NOW);
    expect(window.busyTo.getTime() - window.to.getTime()).toBe(90 * 60_000);
  });

  it("never ends before it starts", () => {
    const window = previewWindow(
      { from: "2026-12-01T00:00:00Z", durationMinutes: 60 },
      { bookingHorizonDays: 7 },
      NOW
    );
    expect(window.to.getTime()).toBe(window.from.getTime());
  });
});
