import { describe, expect, it } from "vitest";
import { guidelinesOutstanding } from "./community";

/**
 * An acceptance is of a particular text, and stops meaning anything the moment
 * that text changes. These pin that: the gate is a comparison of two
 * timestamps, not a boolean somebody sets once.
 */

const MARCH = new Date("2026-03-01T00:00:00Z");
const APRIL = new Date("2026-04-01T00:00:00Z");

describe("community guidelines gate", () => {
  it("is closed when there are no guidelines to accept", () => {
    expect(
      guidelinesOutstanding({
        guidelines_md: "",
        guidelines_updated_at: null,
        guidelines_accepted_at: null,
      }),
    ).toBe(false);
  });

  it("treats whitespace-only guidelines as none at all", () => {
    // Otherwise clearing the field by selecting all and deleting leaves a gate
    // in front of an empty modal.
    expect(
      guidelinesOutstanding({
        guidelines_md: "   \n  ",
        guidelines_updated_at: APRIL,
        guidelines_accepted_at: null,
      }),
    ).toBe(false);
  });

  it("opens for a member who has never accepted", () => {
    expect(
      guidelinesOutstanding({
        guidelines_md: "## Rules",
        guidelines_updated_at: MARCH,
        guidelines_accepted_at: null,
      }),
    ).toBe(true);
  });

  it("stays shut once accepted, while the text is unchanged", () => {
    expect(
      guidelinesOutstanding({
        guidelines_md: "## Rules",
        guidelines_updated_at: MARCH,
        guidelines_accepted_at: APRIL,
      }),
    ).toBe(false);
  });

  it("re-opens when the rules change after an acceptance", () => {
    // The whole point: rules somebody agreed to in March are not the rules
    // they are being held to in April.
    expect(
      guidelinesOutstanding({
        guidelines_md: "## Rules v2",
        guidelines_updated_at: APRIL,
        guidelines_accepted_at: MARCH,
      }),
    ).toBe(true);
  });

  it("stays shut for guidelines that were never stamped", () => {
    // Seeded or hand-written text with no updated_at cannot be shown to be
    // newer than an acceptance, and guessing "yes" would nag every member of
    // every community on the first deploy.
    expect(
      guidelinesOutstanding({
        guidelines_md: "## Rules",
        guidelines_updated_at: null,
        guidelines_accepted_at: MARCH,
      }),
    ).toBe(false);
  });
});
