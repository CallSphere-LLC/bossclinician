import { describe, expect, it } from "vitest";
import type { Campaign } from "@/types/admin";
import type { SequenceSummary } from "@/lib/marketingApi";
import {
  filterProgramme,
  mergeProgramme,
  programmeFolders,
  readProgrammeFilters,
  readSequenceStatusParam,
  sequenceSpan,
  statusOptionsFor,
  writeProgrammeFilters,
} from "./emailProgramme";

const campaign = (over: Partial<Campaign>): Campaign =>
  ({
    id: 1,
    name: "Launch",
    folder: "",
    status: "draft",
    sentAt: null,
    scheduledAt: null,
    createdAt: "2026-09-01T10:00:00Z",
    ...over,
  }) as Campaign;

const sequence = (over: Partial<SequenceSummary>): SequenceSummary => ({
  id: 1,
  name: "Welcome",
  slug: "welcome",
  description: "",
  status: "active",
  topic: "",
  emailCount: 6,
  activeCount: 3,
  completedCount: 1,
  updatedAt: "2026-09-05T10:00:00Z",
  folder: "",
  enabledEmailCount: 6,
  totalDelayMinutes: 11 * 1440,
  ...over,
});

describe("A3 — broadcasts and sequences in one list", () => {
  it("reads a sequence inline the way Kajabi does: N emails over D days", () => {
    expect(sequenceSpan(sequence({}))).toBe("6 emails over 11 days");
    expect(sequenceSpan(sequence({ enabledEmailCount: 1, totalDelayMinutes: 1440 }))).toBe("1 email over 1 day");
    expect(sequenceSpan(sequence({ enabledEmailCount: 3, totalDelayMinutes: 180 }))).toBe("3 emails over 3 hours");
    expect(sequenceSpan(sequence({ enabledEmailCount: 2, totalDelayMinutes: 0 }))).toBe("2 emails, all on day one");
    expect(sequenceSpan(sequence({ emailCount: 0, enabledEmailCount: 0, totalDelayMinutes: 0 }))).toBe("No emails yet");
    expect(sequenceSpan(sequence({ emailCount: 2, enabledEmailCount: 0 }))).toBe("2 emails, all switched off");
  });

  it("merges both kinds newest first, with one status vocabulary", () => {
    const rows = mergeProgramme(
      [
        campaign({ id: 1, name: "Old", createdAt: "2026-08-01T00:00:00Z" }),
        campaign({ id: 2, name: "Sent", status: "sent", sentAt: "2026-09-10T00:00:00Z" }),
      ],
      [sequence({ id: 9, status: "active" }), sequence({ id: 10, name: "Nurture", status: "paused", updatedAt: "2026-07-01T00:00:00Z" })],
    );
    expect(rows.map((row) => row.key)).toEqual(["broadcast:2", "sequence:9", "broadcast:1", "sequence:10"]);
    expect(rows.map((row) => row.status)).toEqual(["sent", "sending", "draft", "paused"]);
  });

  it("filters by type, status and folder together", () => {
    const rows = mergeProgramme(
      [
        campaign({ id: 1, folder: "Launch", status: "scheduled" }),
        campaign({ id: 2, folder: "", status: "sent", sentAt: "2026-09-02T00:00:00Z" }),
      ],
      [sequence({ id: 3, folder: "Launch" }), sequence({ id: 4, folder: "Onboarding", status: "draft" })],
    );
    expect(programmeFolders(rows)).toEqual(["Launch", "Onboarding"]);
    expect(filterProgramme(rows, { type: "", status: "", folder: "" })).toHaveLength(4);
    expect(filterProgramme(rows, { type: "sequence", status: "", folder: "" }).map((r) => r.key)).toEqual(["sequence:3", "sequence:4"]);
    expect(filterProgramme(rows, { type: "", status: "", folder: "Launch" }).map((r) => r.key).sort()).toEqual(["broadcast:1", "sequence:3"]);
    expect(filterProgramme(rows, { type: "broadcast", status: "scheduled", folder: "Launch" }).map((r) => r.key)).toEqual(["broadcast:1"]);
    expect(filterProgramme(rows, { type: "sequence", status: "sending", folder: "Launch" }).map((r) => r.key)).toEqual(["sequence:3"]);
  });

  it("only offers statuses a kind can be in", () => {
    expect(statusOptionsFor("sequence")).not.toContain("sent");
    expect(statusOptionsFor("broadcast")).not.toContain("paused");
    expect(statusOptionsFor("")).toContain("paused");
    expect(statusOptionsFor("")).toContain("sent");
  });

  it("round-trips filters through the URL so a deep link opens the list narrowed", () => {
    const params = new URLSearchParams("type=sequences&status=active&folder=Launch%20emails&x=1");
    const filters = readProgrammeFilters(params);
    expect(filters).toEqual({ type: "sequence", status: "sending", folder: "Launch emails" });
    expect(readProgrammeFilters(new URLSearchParams("type=campaign&status=bogus"))).toEqual({ type: "broadcast", status: "", folder: "" });
    const written = writeProgrammeFilters(params, { type: "broadcast", status: "", folder: "" });
    // The address says `campaign`, the contract the Marketing Overview links with.
    expect(written.get("type")).toBe("campaign");
    expect(written.has("status")).toBe(false);
    expect(written.has("folder")).toBe(false);
    expect(written.get("x")).toBe("1");
    expect(readProgrammeFilters(written).type).toBe("broadcast");
    expect(readProgrammeFilters(new URLSearchParams("type=campaign&status=sent"))).toEqual({ type: "broadcast", status: "sent", folder: "" });
  });

  it("lets the sequences page read the same status link", () => {
    expect(readSequenceStatusParam(new URLSearchParams("status=active"))).toBe("active");
    expect(readSequenceStatusParam(new URLSearchParams("status=sending"))).toBe("active");
    expect(readSequenceStatusParam(new URLSearchParams("status=paused"))).toBe("paused");
    expect(readSequenceStatusParam(new URLSearchParams("status=sent"))).toBe("");
  });
});
