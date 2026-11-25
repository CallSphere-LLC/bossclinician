import { describe, expect, it } from "vitest";
import { describeEmailTiming, describeTrigger, describeWhereTheyAre } from "./SequenceEditor";

describe("describeTrigger", () => {
  it("names the offer in plain words", () => {
    expect(
      describeTrigger({
        triggerType: "offer_purchased",
        triggerSentence: "When someone buys an offer or you give it to them — The Club",
      }),
    ).toBe("When someone buys The Club");
  });

  it("leaves other triggers, and an offer not chosen yet, as the sentence they came with", () => {
    const form = { triggerType: "form_submitted", triggerSentence: "When someone submits a form — Quiz" };
    const any = {
      triggerType: "offer_purchased",
      triggerSentence: "When someone buys an offer or you give it to them (any)",
    };
    expect(describeTrigger(form)).toBe(form.triggerSentence);
    expect(describeTrigger(any)).toBe(any.triggerSentence);
  });
});

describe("describeWhereTheyAre", () => {
  // Email 2 was deleted, so the stored positions have a gap.
  const emails = [
    { position: 1, enabled: true },
    { position: 3, enabled: true },
    { position: 4, enabled: true },
  ];

  it("counts the email they are waiting for as it is listed, not by its stored position", () => {
    expect(describeWhereTheyAre({ status: "active", position: 3 }, emails)).toBe("On email 2");
    // Waiting on the deleted email's slot: the next one listed is what goes.
    expect(describeWhereTheyAre({ status: "active", position: 2 }, emails)).toBe("On email 2");
  });

  it("skips a switched-off email, as the sender does", () => {
    const withOff = [
      { position: 1, enabled: true },
      { position: 3, enabled: false },
      { position: 4, enabled: true },
    ];
    expect(describeWhereTheyAre({ status: "active", position: 3 }, withOff)).toBe("On email 3");
  });

  it("keeps a paused run on the sequence rather than calling it left", () => {
    expect(describeWhereTheyAre({ status: "paused", position: 4 }, emails)).toBe(
      "On email 3 (paused)",
    );
  });

  it("says finished and left early for the ended runs", () => {
    expect(describeWhereTheyAre({ status: "completed", position: 4 }, emails)).toBe("Finished");
    expect(describeWhereTheyAre({ status: "exited", position: 2 }, emails)).toBe("Left early");
  });
});


describe("completion-anchored email timing labels", () => {
  it("labels every stored offset from quiz completion", () => {
    expect(describeEmailTiming(1440, 0, true)).toBe("Goes out 1 day after quiz completion");
    expect(describeEmailTiming(3 * 1440, 1, true)).toBe("Goes out 3 days after quiz completion");
    expect(describeEmailTiming(14 * 1440, 4, true)).toBe("Goes out 2 weeks after quiz completion");
  });
  it("preserves ordinary first-email and cumulative descriptions", () => {
    expect(describeEmailTiming(1440, 0)).toBe("Goes out 1 day after somebody joins");
    expect(describeEmailTiming(3 * 1440, 1)).toBe("Goes out 3 days after the one above");
  });
});
