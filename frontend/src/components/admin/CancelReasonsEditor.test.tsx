import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CancelReasonsEditor, lockSavedReasons } from "./CancelReasonsEditor";
import { newReasonRow, rowsFromText, textFromRows } from "@/lib/cancelReasons";
import { paymentFieldProblem } from "@/lib/paymentSettingsRules";

const LIVE_VALUE =
  "too_expensive|It costs more than I can justify\nnot_using|I am not using it enough\n" +
  "found_alternative|I found something that fits better\nother|Something else";

describe("CancelReasonsEditor", () => {
  it("shows each reason as its own editable row, not the key | label text", () => {
    const html = renderToStaticMarkup(
      <CancelReasonsEditor id="reasons" label="Reasons" value={LIVE_VALUE} onChange={() => undefined} />,
    );

    expect(html).toContain('value="It costs more than I can justify"');
    expect(html).toContain('value="Something else"');
    expect(html).toContain("In reports as “too_expensive”");
    expect(html).toContain("asks the customer to say more");
    expect(html).not.toContain("too_expensive|");
    // Four rows, each with move and remove controls that say what they do.
    expect(html.match(/aria-label="Remove reason \d"/g)).toHaveLength(4);
    expect(html).toContain('aria-label="Move reason 1 up"');
    expect(html).toContain("Add a reason");
  });

  it("disables moving the first reason up and the last one down", () => {
    const html = renderToStaticMarkup(
      <CancelReasonsEditor id="reasons" label="Reasons" value={LIVE_VALUE} onChange={() => undefined} />,
    );
    expect(html).toMatch(/aria-label="Move reason 1 up"[^>]*disabled|disabled[^>]*aria-label="Move reason 1 up"/);
    expect(html).toMatch(/aria-label="Move reason 4 down"[^>]*disabled|disabled[^>]*aria-label="Move reason 4 down"/);
  });

  it("says why an empty list cannot be saved", () => {
    const html = renderToStaticMarkup(
      <CancelReasonsEditor id="reasons" label="Reasons" value="" onChange={() => undefined} />,
    );
    expect(html).toContain("Keep at least one reason");
  });
});

describe("lockSavedReasons", () => {
  it("locks a new reason's key once a save stores it, so renaming it keeps that key", () => {
    const added = { ...newReasonRow(), label: "I moved clinics" };
    const rows = [...rowsFromText(LIVE_VALUE), added];
    const saved = textFromRows(rows);

    const locked = lockSavedReasons(rows, saved);
    expect(locked[4]).toMatchObject({ id: added.id, key: "i_moved_clinics", keyLocked: true });
    // The text did not change, so the card is not left "unsaved".
    expect(textFromRows(locked)).toBe(saved);

    const renamed = locked.map((row, i) => (i === 4 ? { ...row, label: "I changed jobs" } : row));
    expect(textFromRows(renamed)).toContain("i_moved_clinics | I changed jobs");
  });

  it("leaves a new reason unsaved when the stored text does not hold it", () => {
    const saved = textFromRows([...rowsFromText(LIVE_VALUE), { ...newReasonRow(), label: "I moved clinics" }]);
    // Reworded while the save was in flight: its key would now be minted differently.
    const rows = [...rowsFromText(LIVE_VALUE), { ...newReasonRow(), label: "I changed jobs" }];
    expect(lockSavedReasons(rows, saved)[4]).toMatchObject({ key: "", keyLocked: false });
  });
});

describe("payment settings save gate", () => {
  it("blocks the save with the reason for each payment rule", () => {
    expect(paymentFieldProblem("reasonlist", "")).toContain("at least one reason");
    expect(paymentFieldProblem("descriptor", "BOSS")).toContain("5 to 22 characters");
    expect(paymentFieldProblem("retryschedule", "3; 5")).toContain("separated by commas");
    expect(paymentFieldProblem("reasonlist", LIVE_VALUE)).toBeNull();
    expect(paymentFieldProblem("descriptor", "BOSSCLINICIAN")).toBeNull();
    expect(paymentFieldProblem("text", "anything")).toBeNull();
  });
});
