import { describe, expect, it } from "vitest";
import type { ContactFilterOptions } from "@/lib/contactsApi";
import { decodeFilterRows, describeRow, encodeFilterRows, rowComplete } from "./ContactsFilterBar";

/** The applied filter rows live in the address bar; a refresh must bring back exactly them. */
const OPTIONS: ContactFilterOptions = {
  segments: [],
  sorts: [],
  defaultSort: "added_desc",
  categories: [
    {
      key: "tags",
      label: "Tags",
      note: "",
      conditionals: [{ key: "has", label: "has tag", value: "choice", options: "tags", unavailable: "" }],
    },
    {
      key: "contacts",
      label: "Contacts",
      note: "",
      conditionals: [
        { key: "added", label: "Contact was added", value: "date_range", options: null, unavailable: "" },
        { key: "hidden", label: "Is hidden", value: "none", options: null, unavailable: "Not on this site" },
      ],
    },
    {
      key: "custom_fields",
      label: "Custom Fields",
      note: "",
      conditionals: [{ key: "is", label: "is", value: "field_text", options: "customFields", unavailable: "" }],
    },
    {
      key: "lifetime_value",
      label: "Lifetime Value",
      note: "",
      conditionals: [{ key: "gt", label: "is greater than", value: "money", options: null, unavailable: "" }],
    },
  ],
  options: { tags: [{ value: "vip", label: "VIP" }], customFields: [{ value: "State", label: "State" }] },
  days: [],
  engagementDays: [],
  datePresets: [
    { key: "last_30_days", label: "In the last 30 days" },
    { key: "custom", label: "Between two dates…" },
  ],
  eventTypes: [],
};

describe("filter rows in the address bar", () => {
  it("round-trips", () => {
    const rows = [
      { category: "tags", op: "has", value: "vip", text: "" },
      { category: "contacts", op: "added", value: "custom", text: "2026-01-01~2026-02-01" },
    ];
    expect(decodeFilterRows(encodeFilterRows(rows))).toEqual(rows);
    expect(encodeFilterRows([])).toBeNull();
  });

  it("drops what a hand-edited link got wrong rather than breaking the page", () => {
    expect(decodeFilterRows("{nope")).toEqual([]);
    expect(decodeFilterRows(JSON.stringify({ category: "tags" }))).toEqual([]);
    expect(decodeFilterRows(JSON.stringify([{ category: "tags" }, null, 7, { category: "tags", op: "has" }]))).toEqual([
      { category: "tags", op: "has", value: "", text: "" },
    ]);
  });
});

describe("rowComplete", () => {
  it("needs a value for a choice, and text for a field comparison", () => {
    expect(rowComplete(OPTIONS, { category: "tags", op: "has", value: "", text: "" })).toBe(false);
    expect(rowComplete(OPTIONS, { category: "tags", op: "has", value: "vip", text: "" })).toBe(true);
    expect(rowComplete(OPTIONS, { category: "custom_fields", op: "is", value: "State", text: "" })).toBe(false);
    expect(rowComplete(OPTIONS, { category: "custom_fields", op: "is", value: "State", text: "NV" })).toBe(true);
  });

  it("needs both ends of a custom date range", () => {
    expect(rowComplete(OPTIONS, { category: "contacts", op: "added", value: "custom", text: "2026-01-01~" })).toBe(false);
    expect(rowComplete(OPTIONS, { category: "contacts", op: "added", value: "custom", text: "2026-01-01~2026-02-01" })).toBe(true);
    expect(rowComplete(OPTIONS, { category: "contacts", op: "added", value: "last_30_days", text: "" })).toBe(true);
  });

  it("never sends a conditional this site can't answer", () => {
    expect(rowComplete(OPTIONS, { category: "contacts", op: "hidden", value: "", text: "" })).toBe(false);
  });

  it("wants an amount of money for lifetime value", () => {
    expect(rowComplete(OPTIONS, { category: "lifetime_value", op: "gt", value: "abc", text: "" })).toBe(false);
    expect(rowComplete(OPTIONS, { category: "lifetime_value", op: "gt", value: "1,250.50", text: "" })).toBe(true);
  });
});

describe("describeRow", () => {
  it("reads an applied row back in words", () => {
    expect(describeRow(OPTIONS, { category: "tags", op: "has", value: "vip", text: "" })).toBe("Tags has tag VIP");
    expect(describeRow(OPTIONS, { category: "contacts", op: "added", value: "last_30_days", text: "" })).toBe(
      "Contacts Contact was added In the last 30 days",
    );
  });
});
