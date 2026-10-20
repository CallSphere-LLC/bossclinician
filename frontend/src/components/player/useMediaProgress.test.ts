import { describe, expect, it } from "vitest";
import { advanceContiguous } from "./useMediaProgress";

/** The player's own furthest-played figure: only playing moves it, never seeking. */
describe("advanceContiguous", () => {
  it("moves forward with normal playback", () => {
    expect(advanceContiguous({ playedTo: 10, previous: 10, current: 10.25, playbackRate: 1 })).toBe(10.25);
  });

  it("allows bigger steps at higher playback rates", () => {
    expect(advanceContiguous({ playedTo: 10, previous: 10, current: 13.5, playbackRate: 2 })).toBe(13.5);
  });

  it("does not count a seek ahead", () => {
    // A jump of minutes between two samples is a seek, not playback.
    expect(advanceContiguous({ playedTo: 10, previous: 10, current: 600, playbackRate: 1 })).toBe(10);
    // Straight after a seek there is no previous sample at all.
    expect(advanceContiguous({ playedTo: 10, previous: null, current: 600, playbackRate: 1 })).toBe(10);
  });

  it("does not count playing on from somewhere beyond what was watched", () => {
    expect(advanceContiguous({ playedTo: 10, previous: 600, current: 600.25, playbackRate: 1 })).toBe(10);
  });

  it("keeps the furthest point when re-watching an earlier part", () => {
    expect(advanceContiguous({ playedTo: 900, previous: 30, current: 30.25, playbackRate: 1 })).toBe(900);
  });

  it("resumes advancing once re-watching reaches the furthest point", () => {
    expect(advanceContiguous({ playedTo: 900, previous: 899.9, current: 900.2, playbackRate: 1 })).toBe(900.2);
  });
});
