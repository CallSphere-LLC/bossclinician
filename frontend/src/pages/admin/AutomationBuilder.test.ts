import { describe, expect, it } from "vitest";
import { displayedRunStatus } from "./AutomationBuilder";

describe("automation run verdict", () => {
  it("repairs a legacy success verdict when its own log says the step was blocked", () => {
    expect(displayedRunStatus({ status: "success", log: ["Tag: none chosen"] })).toBe("partial");
    expect(
      displayedRunStatus({ status: "success", log: ["Offer: blocked — they have no account"] }),
    ).toBe("partial");
  });

  it("leaves a genuinely successful run alone", () => {
    expect(displayedRunStatus({ status: "success", log: ["Tag added: client"] })).toBe("success");
  });
});
