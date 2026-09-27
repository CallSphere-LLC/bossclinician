import { describe, expect, it } from "vitest";
import { importErrorText } from "./Members";

describe("members import error lines", () => {
  const sent = [{ email: "sam@example.com" }, { email: "not-an-address" }];

  it("shows the reason the server gave, against the address it came from", () => {
    // The shape POST /admin/members/import actually returns.
    expect(importErrorText({ row: 2, reason: "email: Invalid email" } as never, sent)).toBe(
      "not-an-address — email: Invalid email",
    );
  });

  it("falls back to the row number when the row can't be matched", () => {
    expect(importErrorText({ row: 9, reason: "Could not be saved" } as never, sent)).toBe(
      "Line 9 — Could not be saved",
    );
  });

  it("still reads a finished sentence or a message field", () => {
    expect(importErrorText("Something odd", sent)).toBe("Something odd");
    expect(importErrorText({ email: "a@b.co", message: "Nope" }, sent)).toBe("a@b.co — Nope");
    expect(importErrorText({ row: 1 }, sent)).toBe("sam@example.com — we couldn't use this one.");
  });
});
