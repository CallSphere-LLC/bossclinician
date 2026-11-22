import { describe, expect, it } from "vitest";
import { RAMP_UP_BONUS_LABEL, club, clubCheckout } from "@/content/club";
import { clubBonusToken, personalBonusLine } from "@/lib/clubBonus";

/** Yvette, 22 Nov 2026, item 3: the Club page's bonus wording and FAQs. */
describe("Club bonus copy", () => {
  it("replaces the blanket 'included' statement with her eligibility rule", () => {
    const page = JSON.stringify(club);
    expect(page).not.toContain("Enrollment Bonus: Ramp-Up Rate Formula included");
    expect(page).not.toContain("during the current bonus period");
    expect(club.hero.bonus).toBe(
      "Your training registration bonus: Join The Club within 14 days of your first registration for the free training to receive the Ramp-Up Rate Formula."
    );
  });

  it("uses her bonus section word for word", () => {
    const [rampUp] = club.bonuses.items;
    expect(rampUp.label).toBe("YOUR TRAINING REGISTRATION BONUS");
    expect(rampUp.title).toBe("The Ramp-Up Rate Formula");
    expect(rampUp.body).toBe(
      "Starting your practice comes with enough decisions. Your fee does not have to be another number you choose out of fear or by copying someone else."
    );
    expect(rampUp.body2).toBe(
      "Use the Ramp-Up Rate Formula to connect your fee to the income your practice needs to support and the number of clients you want to see."
    );
    expect(rampUp.note).toBe(
      "Join The Club within 14 days of your first registration for the free training to receive this bonus with your enrollment."
    );
  });

  it("keeps the First 30 Days Success Planner intact", () => {
    const planner = club.bonuses.items.find((item) => item.title === "The First 30 Days Success Planner");
    expect(planner?.label).toBe("Bonus 1");
    expect(clubCheckout.bonuses.find((b) => b.title === "The First 30 Days Success Planner")?.label).toBe("BONUS #1");
  });

  it("adds her two FAQs verbatim", () => {
    const faq = Object.fromEntries(club.faq.items.map((item) => [item.q, item.a]));
    expect(faq["Does enrollment in The Club close?"]).toBe(
      "The Club remains open for enrollment. The deadline in your training emails applies to the Ramp-Up Rate Formula enrollment bonus."
    );
    expect(faq["How do I qualify for the Ramp-Up Rate Formula bonus?"]).toBe(
      "Join The Club by the personalized deadline provided after your first registration for the free training. Your deadline is 11:59 p.m. Pacific Time, 14 calendar days after registration. Registering again does not restart your bonus window."
    );
  });

  it("states the rule at checkout, with no fixed countdown", () => {
    const rampUp = clubCheckout.bonuses.find((b) => b.label === RAMP_UP_BONUS_LABEL);
    expect(rampUp?.body).toContain(
      "Join The Club within 14 days of your first registration for the free training to receive this bonus with your enrollment."
    );
    expect(JSON.stringify(clubCheckout)).not.toMatch(/72 hours|Included when you enroll/);
  });
});

describe("personalBonusLine", () => {
  it("is her sentence with the subscriber's own date", () => {
    expect(personalBonusLine("December 6")).toBe("Your bonus expires December 6 at 11:59 p.m. Pacific Time.");
  });
});

describe("clubBonusToken", () => {
  const token = "Y2IxLjEx.abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";

  it("ignores anything that is not shaped like one", () => {
    expect(clubBonusToken("?b=someone@example.com")).toBe("");
    expect(clubBonusToken("?b=<script>")).toBe("");
    expect(clubBonusToken("")).toBe("");
  });

  it("reads a well-formed ?b= token", () => {
    expect(clubBonusToken(`?b=${token}`)).toBe(token);
  });
});
