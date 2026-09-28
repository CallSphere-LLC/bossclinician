import { describe, expect, it } from "vitest";
import { LIFECYCLE_EVENT_TYPES, lifecycleEventType, lifecycleHeadline } from "./contactLifecycle";

/** QA row 25: the Lifecycle tab's "Filter by event type" menu and its entries. */
describe("lifecycle event types", () => {
  it("are Kajabi's menu, in Kajabi's order", () => {
    expect(LIFECYCLE_EVENT_TYPES).toEqual([
      "Form Submission",
      "Email Delivery",
      "Email Sequence Subscription",
      "Offer Purchase",
      "Offer Grant",
      "Event Registration",
      "Assessment Result",
      "Expert Agent Chat",
      "Contact Created",
      "Tag Added",
      "Automation Enrollment",
    ]);
  });

  it.each([
    ["imported", "Contact Created"],
    ["created", "Contact Created"],
    ["account.created", "Contact Created"],
    ["purchase", "Offer Purchase"],
    ["offer_granted", "Offer Grant"],
    ["offer.granted", "Offer Grant"],
    ["lead.created", "Form Submission"],
    ["form.submitted", "Form Submission"],
    ["subscribed", "Form Submission"],
    ["sequence_started", "Email Sequence Subscription"],
    ["sequence_completed", "Email Sequence Subscription"],
    ["event.registered", "Event Registration"],
    ["assessment.completed", "Assessment Result"],
    ["tag.added", "Tag Added"],
    ["automation.enrolled", "Automation Enrollment"],
    ["email.delivered", "Email Delivery"],
  ])("files %s under %s", (kind, type) => {
    expect(lifecycleEventType(kind)).toBe(type);
  });

  it("leaves moments Kajabi has no type for under All types only", () => {
    for (const kind of ["note", "merged", "email_preference", "email.confirmed", "constructor", "__proto__"]) {
      expect(lifecycleEventType(kind)).toBeNull();
    }
  });
});

describe("lifecycle headlines", () => {
  const row = (kind: string, title: string, meta: Record<string, unknown> = {}) => ({ kind, title, body: "", meta });

  it("says Contact created for a Kajabi import, not the import's own wording", () => {
    expect(lifecycleHeadline(row("imported", "Joined — brought over from a spreadsheet"))).toBe("Contact created");
  });

  it("words purchases, opt-ins and broadcasts the way Kajabi does", () => {
    expect(lifecycleHeadline(row("purchase", "Bought Do's and Don'ts of Documentation CE"))).toBe(
      "Purchased Do's and Don'ts of Documentation CE",
    );
    expect(lifecycleHeadline(row("form.submitted", "Filled in Free Guide"))).toBe("Opted Into Free Guide");
    expect(lifecycleHeadline(row("email.delivered", "Fall launch", { sourceType: "broadcast", campaign: "Fall launch" }))).toBe(
      "Was broadcasted by Fall launch",
    );
    expect(lifecycleHeadline(row("tag.added", "VIP"))).toBe("Tag added: VIP");
  });

  it("keeps the stored title for anything else", () => {
    expect(lifecycleHeadline(row("note", "Note"))).toBe("Note");
  });
});
