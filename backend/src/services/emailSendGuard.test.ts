import { describe, expect, it } from "vitest";
import { renderTokens } from "../email/provider";
import { renderedProblem, unresolvedTokens, unsendableReason } from "./emailSendGuard";

/**
 * Migration 222 (Yvette 22 Nov 2026, item 3): "Implementation placeholders
 * should never appear in customer emails." The guard must stop an unfilled
 * token or a team note, and must not stop any email that is live today.
 */

const check = (template: string, values: Record<string, string>) =>
  unsendableReason([template], values, [renderTokens(template, values)]);

describe("unresolved placeholders", () => {
  it("stops a token nobody gives a value for (renderTokens would blank it)", () => {
    expect(renderTokens("Price: {{lounge_general_pricing_block}}", {})).toBe("Price: ");
    expect(check("Price: {{lounge_general_pricing_block}}", {})).toBe(
      "unresolved placeholder: {{lounge_general_pricing_block}}"
    );
    expect(check("{{ lounge_vip_availability_block }}", { firstName: "A" })).toMatch(/lounge_vip_availability_block/);
  });

  it("stops a Lounge block that resolved to nothing", () => {
    expect(
      unresolvedTokens(["{{lounge_general_pricing_block}} {{lounge_vip_availability_block}}"], {
        lounge_general_pricing_block: "General: Join for $247/month or $2,497/year.",
        lounge_vip_availability_block: "  ",
      })
    ).toEqual(["lounge_vip_availability_block"]);
  });

  it("passes both blocks once filled", () => {
    const values = {
      firstName: "Dana",
      lounge_general_pricing_block: "General: Join for $247/month or $2,497/year.",
      lounge_vip_availability_block: "VIP is currently full.",
    };
    expect(check("Hey {{first_name}},\n{{lounge_general_pricing_block}}\n{{lounge_vip_availability_block}}", values)).toBe("");
  });

  it("does not stop the tokens live emails use, even when empty", () => {
    const live = {
      firstName: "",
      clubBonusToken: "",
      clubBonusDeadline: "",
      clubBonusLink: "https://www.bossclinician.com/club",
      retreatFeedbackUrl: "https://www.bossclinician.com/x",
      retreatInterestUrl: "https://www.bossclinician.com/y",
      retreatMemoriesUrl: "https://www.bossclinician.com/z",
      retreatNextUrl: "",
    };
    for (const template of [
      "Hey {{firstName}},",
      "Hey {{first_name}},",
      "Hey {{ first_name }},",
      "Hey {{firstname}},",
      "<a href=\"https://www.bossclinician.com/club?b={{clubBonusToken}}\">Join</a> by {{clubBonusDeadline}}",
      "[OPEN]({{retreatMemoriesUrl}} \"button\") [SHARE]({{retreatFeedbackUrl}} \"button\") {{retreatInterestUrl}} {{retreatNextUrl}}",
    ]) {
      expect(check(template, live)).toBe("");
    }
  });
});

describe("leftovers and team notes after rendering", () => {
  it("stops anything still shaped like a placeholder", () => {
    expect(renderedProblem(["Join {{lounge-general}} today"])).toBe("placeholder left in the email");
    expect(renderedProblem(["{% if vip %}"])).toBe("placeholder left in the email");
    expect(check("Join {{ lounge general }} today", {})).toBe("placeholder left in the email");
  });

  it("stops her doc's internal notes", () => {
    for (const note of [
      "TEAM IMPLEMENTATION NOTES — DO NOT SEND",
      "Emails 11–12 use two independently selected pricing blocks. The labels are implementation placeholders, not verified platform tags.",
      "Internal note: check the VIP count",
      "[Preview note] remove before sending",
    ]) {
      expect(check(note, {})).toMatch(/internal note/);
    }
  });

  it("checks the subject and preview too", () => {
    expect(unsendableReason(["{{lounge_vip_availability_block}}", "", "Hi"], {}, ["", "", "Hi"])).toMatch(/unresolved/);
    expect(unsendableReason(["Hi", "DO NOT SEND", "Hi"], {}, ["Hi", "DO NOT SEND", "Hi"])).toMatch(/internal note/);
  });

  it("lets her real Email 11 wording through", () => {
    const body =
      "Hey {{first_name}},\nThat’s how we begin working toward time off that feels like time off.\n{{lounge_general_pricing_block}}\n{{lounge_vip_availability_block}}\nMonthly plans have a six-month minimum commitment, then continue month-to-month unless canceled. Annual prices cover one year.\nFounding members keep their original rate while continuously enrolled on the same plan.";
    const values = {
      firstName: "Dana",
      lounge_general_pricing_block:
        "General: The first 20 paid General members can join for $197/month or $1,997/year. The monthly option has a six-month minimum totaling $1,182, then continues month-to-month. Starting with the 21st paid General member, pricing becomes $247/month or $2,497/year.",
      lounge_vip_availability_block:
        "VIP is currently full. Join the VIP waitlist through The Lounge page to hear when a seat becomes available. Future seats are $447/month or $4,497/year. Seats are first come, first served; joining the waitlist does not reserve a place.",
    };
    expect(check(body, values)).toBe("");
  });
});
