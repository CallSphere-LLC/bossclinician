import { describe, expect, it } from "vitest";
import { defaultLibraryTab, shelfGroups } from "@/pages/member/libraryShelf";

// The shape /api/member/library returned for a member who bought the Fully
// Booked Toolkit (a download) and also holds the Bali retreat (an access group).
const toolkitAndRetreat = [
  { kind: "download", label: "Downloads", items: [{ slug: "fully-booked-toolkit" }] },
  { kind: "access_group", label: "Memberships", items: [{ slug: "bali-retreat-2027" }] },
];

describe("shelfGroups", () => {
  it("keeps a purchased download on the main shelf beside other products", () => {
    const shelf = shelfGroups(toolkitAndRetreat);
    expect(shelf.map((group) => group.kind)).toEqual(["download", "access_group"]);
    expect(shelf.flatMap((group) => group.items.map((item) => item.slug))).toContain(
      "fully-booked-toolkit",
    );
  });

  it("keeps a shelf of downloads only", () => {
    expect(shelfGroups([{ kind: "download" }])).toEqual([{ kind: "download" }]);
  });
});

describe("defaultLibraryTab", () => {
  it("opens the shelf for somebody who owns a download and something else", () => {
    expect(defaultLibraryTab(null, toolkitAndRetreat)).toBe("courses");
  });

  it("opens Documents for somebody who owns only downloads", () => {
    expect(defaultLibraryTab(null, [{ kind: "download" }])).toBe("documents");
  });

  it("lets an explicit ?tab win", () => {
    expect(defaultLibraryTab("documents", toolkitAndRetreat)).toBe("documents");
    expect(defaultLibraryTab("courses", [{ kind: "download" }])).toBe("courses");
  });

  it("ignores an unknown ?tab and waits for the shelf on the main tab", () => {
    expect(defaultLibraryTab("nonsense", null)).toBe("courses");
    expect(defaultLibraryTab(null, [])).toBe("courses");
  });
});
