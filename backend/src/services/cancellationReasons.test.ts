import { describe, expect, it } from "vitest";
import {
  DEFAULT_CANCEL_REASONS,
  cancelReasonLabel,
  cancelReasonsProblem,
  cancellationFromStripe,
  parseCancelReasons,
  reasonForStripeFeedback,
  serializeCancelReasons,
} from "./cancellationReasons";

/** The exact value stored on the live site on 11 Sep, compact `key|label` form. */
const LIVE_VALUE =
  "too_expensive|It costs more than I can justify\nnot_using|I am not using it enough\n" +
  "found_alternative|I found something that fits better\nother|Something else";

describe("cancellation reasons", () => {
  it("reads the list already stored on the live site", () => {
    expect(parseCancelReasons(LIVE_VALUE)).toEqual([
      { value: "too_expensive", label: "It costs more than I can justify" },
      { value: "not_using", label: "I am not using it enough" },
      { value: "found_alternative", label: "I found something that fits better" },
      { value: "other", label: "Something else" },
    ]);
    expect(cancelReasonsProblem(LIVE_VALUE)).toBeNull();
  });

  it("round-trips through the editor's serialisation", () => {
    const text = serializeCancelReasons(DEFAULT_CANCEL_REASONS);
    expect(parseCancelReasons(text)).toEqual(DEFAULT_CANCEL_REASONS);
    expect(cancelReasonsProblem(text)).toBeNull();
  });

  it("falls back to the defaults rather than offering an empty form", () => {
    expect(parseCancelReasons("")).toEqual(DEFAULT_CANCEL_REASONS);
    expect(parseCancelReasons(42)).toEqual(DEFAULT_CANCEL_REASONS);
  });

  it.each([
    ["", "Keep at least one reason"],
    ["too_expensive It's too expensive", 'missing the "|"'],
    ["Too Expensive | It's too expensive", "isn't lower-case letters"],
    ["too_expensive | ", "no wording"],
    ["a_key | one\na_key | two", 'share the report key "a_key"'],
    ["a_key | Same words\nb_key | same words", "on the list twice"],
    [`a_key | ${"x".repeat(161)}`, "longer than 160"],
    [Array.from({ length: 31 }, (_, i) => `k_${i} | Reason ${i}`).join("\n"), "30 or fewer"],
  ])("refuses %j and says why", (value, message) => {
    expect(cancelReasonsProblem(value)).toContain(message);
  });

  it("maps a Stripe-side answer onto the owner's own key when there is one", () => {
    const live = parseCancelReasons(LIVE_VALUE);
    expect(reasonForStripeFeedback("too_expensive", live)).toBe("too_expensive");
    expect(reasonForStripeFeedback("switched_service", live)).toBe("found_alternative");
    // No equivalent configured: the default key, which still has a label.
    expect(reasonForStripeFeedback("unused", live)).toBe("not_using_it");
    expect(reasonForStripeFeedback("too_complex", live)).toBe("too_complex");
  });

  it("reads Stripe's cancellation_details, ignoring an empty one", () => {
    const live = parseCancelReasons(LIVE_VALUE);
    expect(cancellationFromStripe(null, live)).toBeNull();
    expect(cancellationFromStripe({ feedback: null, comment: "  " }, live)).toBeNull();
    expect(cancellationFromStripe({ feedback: "too_expensive", comment: " Too pricey " }, live)).toEqual({
      reason: "too_expensive",
      feedback: "Too pricey",
    });
    expect(cancellationFromStripe({ feedback: null, comment: "Moving abroad" }, live)).toEqual({
      reason: "",
      feedback: "Moving abroad",
    });
  });

  it("labels report rows with the owner's current wording", () => {
    const live = parseCancelReasons(LIVE_VALUE);
    expect(cancelReasonLabel("too_expensive", live)).toBe("It costs more than I can justify");
    expect(cancelReasonLabel("not given", live)).toBe("No reason given");
    // Removed from the list since, but past answers still have words.
    expect(cancelReasonLabel("temporary_pause", live)).toBe("I just need a break for now");
    expect(cancelReasonLabel("too_complex", live)).toBe("It was too complicated");
    expect(cancelReasonLabel("some_old_key", live)).toBe("Some old key");
  });
});
