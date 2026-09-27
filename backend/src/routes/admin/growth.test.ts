import { describe, it, expect } from "vitest";
import { legacyActivationRefusal, legacyTestRefusal } from "./growth";

/**
 * The older automations screen's test button went through `fireTrigger`, which
 * runs every active automation on the trigger. It is only allowed through when
 * that means exactly this one.
 */
describe("legacyTestRefusal", () => {
  it("runs a lone active automation", () => {
    expect(
      legacyTestRefusal({ triggerType: "lead_created", status: "active", othersOnTrigger: 0 }),
    ).toBeNull();
  });

  it("refuses when other active automations share the trigger", () => {
    expect(
      legacyTestRefusal({ triggerType: "lead_created", status: "active", othersOnTrigger: 2 }),
    ).toMatch(/2 other active automations/);
  });

  it("refuses a paused automation rather than claiming it fired", () => {
    expect(
      legacyTestRefusal({ triggerType: "lead_created", status: "paused", othersOnTrigger: 0 }),
    ).toMatch(/paused/);
  });

  it("sends a builder automation to the builder's own test", () => {
    expect(
      legacyTestRefusal({ triggerType: "form_submitted", status: "active", othersOnTrigger: 0 }),
    ).toMatch(/automation builder/);
  });
});

/** The CRUD write must not skip the builder's turn-it-on readiness check. */
describe("legacyActivationRefusal", () => {
  const pausedV2 = { trigger_type: "form_submitted", status: "paused" };

  it("refuses turning on a builder automation", () => {
    expect(legacyActivationRefusal({ status: "active" }, pausedV2)).not.toBeNull();
  });

  it("refuses creating a builder automation live, including by the column default", () => {
    expect(legacyActivationRefusal({ triggerType: "form_submitted", status: "active" }, null)).not.toBeNull();
    expect(legacyActivationRefusal({ triggerType: "form_submitted" }, null)).not.toBeNull();
    expect(legacyActivationRefusal({ triggerType: "form_submitted", status: "paused" }, null)).toBeNull();
  });

  it("refuses moving an active legacy automation onto a builder trigger", () => {
    expect(
      legacyActivationRefusal({ triggerType: "tag_added" }, { trigger_type: "lead_created", status: "active" }),
    ).not.toBeNull();
  });

  it("leaves an already-live builder automation alone and lets it be paused", () => {
    const live = { trigger_type: "form_submitted", status: "active" };
    expect(legacyActivationRefusal({ name: "Renamed" }, live)).toBeNull();
    expect(legacyActivationRefusal({ status: "paused" }, live)).toBeNull();
    expect(legacyActivationRefusal({ name: "x" }, pausedV2)).toBeNull();
  });

  it("never touches the older screen's own saves", () => {
    const legacy = { trigger_type: "lead_created", status: "paused" };
    expect(legacyActivationRefusal({ status: "active" }, legacy)).toBeNull();
    expect(
      legacyActivationRefusal({ name: "Welcome", triggerType: "lead_created", status: "active", conditions: {} }, legacy),
    ).toBeNull();
    expect(legacyActivationRefusal({ name: "New", triggerType: "order_paid" }, null)).toBeNull();
  });
});
