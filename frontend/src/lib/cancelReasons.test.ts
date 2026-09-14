import { describe, expect, it } from "vitest";
import {
  cancelReasonsProblem,
  keyFromLabel,
  newReasonRow,
  reasonProblems,
  rowsFromText,
  textFromRows,
} from "./cancelReasons";

const LIVE_VALUE =
  "too_expensive|It costs more than I can justify\nnot_using|I am not using it enough\n" +
  "found_alternative|I found something that fits better\nother|Something else";

describe("cancellation reasons editor model", () => {
  it("keeps the keys already saved, so renaming keeps report history", () => {
    const rows = rowsFromText(LIVE_VALUE);
    expect(rows.map((row) => [row.key, row.keyLocked])).toEqual([
      ["too_expensive", true],
      ["not_using", true],
      ["found_alternative", true],
      ["other", true],
    ]);
    rows[0].label = "Money is tight right now";
    expect(textFromRows(rows).split("\n")[0]).toBe("too_expensive | Money is tight right now");
    expect(cancelReasonsProblem(textFromRows(rows))).toBeNull();
  });

  it("gives a new reason a key made from its wording, never clashing", () => {
    const rows = rowsFromText(LIVE_VALUE);
    rows.push({ ...newReasonRow(), label: "Too expensive!" });
    rows.push({ ...newReasonRow(), label: "Too expensive?" });
    const lines = textFromRows(rows).split("\n");
    expect(lines[4]).toBe("too_expensive_2 | Too expensive!");
    expect(lines[5]).toBe("too_expensive_3 | Too expensive?");
  });

  it("makes a valid key from wording that starts with a number or has none", () => {
    expect(keyFromLabel("2 many emails", new Set())).toBe("reason_2_many_emails");
    expect(keyFromLabel("!!!", new Set())).toBe("reason");
    expect(keyFromLabel("Café prices", new Set())).toBe("cafe_prices");
  });

  it("names the reason that blocks a save", () => {
    const rows = rowsFromText(LIVE_VALUE);
    rows.push(newReasonRow());
    const problems = reasonProblems(rows);
    expect(problems.rows[rows[4].id]).toContain("Write what the customer will see");
    expect(cancelReasonsProblem(textFromRows(rows))).toContain("Cancellation reason 5");
  });

  it("refuses duplicates and an empty list", () => {
    expect(cancelReasonsProblem("a_key | Same\nb_key | same")).toContain("already on the list");
    expect(cancelReasonsProblem("")).toContain("at least one reason");
  });
});
