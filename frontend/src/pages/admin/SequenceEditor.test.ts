import { describe, expect, it } from "vitest";
import { describeWhereTheyAre } from "./SequenceEditor";

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
