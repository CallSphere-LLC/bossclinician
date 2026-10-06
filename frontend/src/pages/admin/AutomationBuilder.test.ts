import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  displayedRunStatus,
  filterAutomations,
  readAutomationFilters,
  writeAutomationFilters,
  type AutomationFilters,
} from "./AutomationBuilder";
import {
  EMPTY_AUTOMATION_FILTERS,
  facetValues,
  relatedLabel,
  relatedRefsOf,
  sourceOf,
  thenLabel,
  toggleValue,
  whenLabel,
} from "./automations/automationFilters";

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

/* ------------------------------------------------- list filters (QA row 71) */

const TRIGGERS = [
  { type: "form_submitted", subjectKey: "formId", subjectSource: "forms" },
  { type: "offer_purchased", subjectKey: "offerId", subjectSource: "offers" },
  { type: "tag_added", subjectKey: "tagId", subjectSource: "tags" },
  { type: "payment_failed", subjectKey: "", subjectSource: "" },
];

const ROWS = [
  {
    id: 1,
    name: "Tag quiz takers",
    description: "",
    triggerType: "form_submitted",
    triggerConfig: { formId: 4 },
    status: "active",
    triggerSentence: "When someone submits a form — Offer Quiz",
    actionSentences: ["add the tag Visionary", "start them on Welcome"],
    actionTypes: ["add_tag", "subscribe_sequence"],
    actionRefs: ["tags:7", "sequences:3"],
    source: null,
  },
  {
    id: 2,
    name: "Kajabi: Bundle buyers",
    description: "When Offer purchased: Visionary Bundle Then Grant offer: Masterclass",
    triggerType: "offer_purchased",
    triggerConfig: { offerId: 12 },
    status: "paused",
    triggerSentence: "When someone buys an offer — Visionary Bundle",
    actionSentences: ["give them Masterclass"],
    actionTypes: ["grant_offer"],
    actionRefs: ["offers:15"],
    source: "kajabi",
    kajabiId: "2148000123",
  },
  {
    id: 3,
    name: "Failed payment nudge",
    description: null,
    triggerType: "payment_failed",
    triggerConfig: {},
    status: "paused",
    triggerSentence: "When a payment fails",
    actionSentences: ['send them the email "Your card"'],
    actionTypes: ["send_email"],
    source: "",
  },
  {
    // An older API: no source, no actionTypes, no actionRefs.
    id: 4,
    name: "Old rule",
    description: "",
    triggerType: "tag_added",
    triggerConfig: { tagId: "7" },
    status: "active",
    triggerSentence: "When a tag is added to someone — Visionary",
    actionSentences: [],
  },
];

function filters(overrides: Partial<AutomationFilters> = {}): AutomationFilters {
  return { ...EMPTY_AUTOMATION_FILTERS, ...overrides };
}

function ids(rows: { id: number }[]): number[] {
  return rows.map((row) => row.id);
}

describe("automation list filters", () => {
  it("shows everything, in order, when nothing is chosen", () => {
    expect(ids(filterAutomations(ROWS, filters(), TRIGGERS))).toEqual([1, 2, 3, 4]);
  });

  it("filters by trigger type, any of the chosen ones", () => {
    expect(ids(filterAutomations(ROWS, filters({ when: ["form_submitted"] })))).toEqual([1]);
    expect(
      ids(filterAutomations(ROWS, filters({ when: ["form_submitted", "payment_failed"] }))),
    ).toEqual([1, 3]);
  });

  it("filters by action type, and leaves out rows from an API that sends none", () => {
    expect(ids(filterAutomations(ROWS, filters({ then: ["add_tag"] })))).toEqual([1]);
    expect(ids(filterAutomations(ROWS, filters({ then: ["grant_offer", "send_email"] })))).toEqual([
      2, 3,
    ]);
  });

  it("filters by status", () => {
    expect(ids(filterAutomations(ROWS, filters({ status: "active" })))).toEqual([1, 4]);
    expect(ids(filterAutomations(ROWS, filters({ status: "paused" })))).toEqual([2, 3]);
  });

  it("filters by source, treating anything that is not 'kajabi' as made here", () => {
    expect(ids(filterAutomations(ROWS, filters({ source: "kajabi" })))).toEqual([2]);
    expect(ids(filterAutomations(ROWS, filters({ source: "local" })))).toEqual([1, 3, 4]);
    expect(sourceOf({ source: "Kajabi" })).toBe("kajabi");
    expect(sourceOf({})).toBe("local");
    expect(sourceOf(null)).toBe("local");
  });

  it("filters by related object — the trigger's subject or a step's target", () => {
    expect(ids(filterAutomations(ROWS, filters({ related: ["offers:12"] }), TRIGGERS))).toEqual([2]);
    expect(ids(filterAutomations(ROWS, filters({ related: ["offers:15"] }), TRIGGERS))).toEqual([2]);
    // tags:7 is a step target on row 1 and the trigger subject (stored as "7") on row 4.
    expect(ids(filterAutomations(ROWS, filters({ related: ["tags:7"] }), TRIGGERS))).toEqual([1, 4]);
    expect(relatedRefsOf(ROWS[0], TRIGGERS)).toEqual(["forms:4", "tags:7", "sequences:3"]);
    expect(relatedRefsOf(ROWS[2], TRIGGERS)).toEqual([]);
  });

  it("searches name, description and the sentences, every word in any order", () => {
    expect(ids(filterAutomations(ROWS, filters({ q: "bundle" })))).toEqual([2]);
    expect(ids(filterAutomations(ROWS, filters({ q: "MASTERCLASS grant" })))).toEqual([2]);
    expect(ids(filterAutomations(ROWS, filters({ q: "quiz visionary" })))).toEqual([1]);
    expect(ids(filterAutomations(ROWS, filters({ q: "   " })))).toEqual([1, 2, 3, 4]);
    expect(ids(filterAutomations(ROWS, filters({ q: "nothing like this" })))).toEqual([]);
  });

  it("ANDs the groups together", () => {
    expect(
      ids(
        filterAutomations(
          ROWS,
          filters({ status: "paused", source: "local", when: ["payment_failed", "offer_purchased"] }),
        ),
      ),
    ).toEqual([3]);
  });

  it("counts one per chip, not the search box", () => {
    expect(activeFilterCount(filters())).toBe(0);
    expect(activeFilterCount(filters({ q: "quiz" }))).toBe(0);
    expect(
      activeFilterCount(
        filters({
          when: ["form_submitted", "tag_added"],
          then: ["add_tag"],
          status: "paused",
          source: "kajabi",
          related: ["offers:12"],
        }),
      ),
    ).toBe(6);
  });
});

describe("automation filters in the URL", () => {
  it("round-trips, keeps ?automation= and leaves defaults out", () => {
    const chosen = filters({
      q: "quiz",
      when: ["form_submitted", "tag_added"],
      then: ["add_tag"],
      status: "paused",
      source: "kajabi",
      related: ["offers:12"],
    });
    const written = writeAutomationFilters(new URLSearchParams("automation=5"), chosen);
    expect(written.get("automation")).toBe("5");
    expect(written.get("when")).toBe("form_submitted,tag_added");
    expect(readAutomationFilters(written)).toEqual(chosen);

    const cleared = writeAutomationFilters(written, EMPTY_AUTOMATION_FILTERS);
    expect(cleared.toString()).toBe("automation=5");
  });

  it("ignores values it does not know and repeated entries", () => {
    const read = readAutomationFilters(
      new URLSearchParams("status=sometimes&source=elsewhere&when=tag_added,,tag_added"),
    );
    expect(read.status).toBe("all");
    expect(read.source).toBe("all");
    expect(read.when).toEqual(["tag_added"]);
  });
});

describe("automation filter labels and options", () => {
  it("uses Kajabi's short names, then the builder's label, then the raw type", () => {
    expect(whenLabel("form_submitted")).toBe("Form submitted");
    expect(whenLabel("brand_new", [{ type: "brand_new", label: "something new happens" }])).toBe(
      "Something new happens",
    );
    expect(whenLabel("brand_new")).toBe("Brand new");
    expect(thenLabel("subscribe_sequence")).toBe("Subscribe to sequence");
  });

  it("names a related object from the builder's lists", () => {
    const lists = { offers: [{ id: 12, name: "Visionary Bundle" }] };
    expect(relatedLabel("offers:12", lists)).toBe("Offer: Visionary Bundle");
    expect(relatedLabel("offers:99", lists)).toBe("Offer #99");
  });

  it("offers what is present plus anything already chosen, sorted by label", () => {
    expect(facetValues(["tag_added", "form_submitted", "tag_added"], ["payment_failed"], whenLabel)).toEqual([
      "form_submitted",
      "payment_failed",
      "tag_added",
    ]);
    expect(toggleValue(["a", "b"], "a")).toEqual(["b"]);
    expect(toggleValue(["a"], "b")).toEqual(["a", "b"]);
  });
});
