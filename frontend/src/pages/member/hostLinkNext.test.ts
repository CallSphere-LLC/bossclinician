import { describe, expect, it } from "vitest";
import { safeNext } from "@/pages/member/hostLinkNext";

describe("safeNext", () => {
  it("accepts a community path", () => {
    expect(safeNext("/community/the-lounge/live")).toBe("/community/the-lounge/live");
    expect(safeNext("/community/the-lounge")).toBe("/community/the-lounge");
  });

  it("keeps the query string and hash of a community path", () => {
    expect(safeNext("/community/the-lounge/live?camera=off")).toBe(
      "/community/the-lounge/live?camera=off",
    );
    expect(safeNext("/community/the-lounge/live?camera=off#top")).toBe(
      "/community/the-lounge/live?camera=off#top",
    );
  });

  it("falls back to the community home when there is nothing usable", () => {
    expect(safeNext(null)).toBe("/community");
    expect(safeNext("")).toBe("/community");
    expect(safeNext("community/the-lounge/live")).toBe("/community");
  });

  it("refuses another origin, however it is written", () => {
    expect(safeNext("//evil.com")).toBe("/community");
    expect(safeNext("//evil.com/community/x")).toBe("/community");
    expect(safeNext("https://evil.com")).toBe("/community");
    expect(safeNext("https://evil.com/community/x")).toBe("/community");
    expect(safeNext("javascript:alert(1)")).toBe("/community");
  });

  it("refuses backslash tricks", () => {
    expect(safeNext("/\\evil.com")).toBe("/community");
    expect(safeNext("\\evil.com")).toBe("/community");
    expect(safeNext("/community/\\evil.com")).toBe("/community");
    expect(safeNext("/community/%5Cevil.com")).toBe("/community");
  });

  it("refuses paths outside the community", () => {
    expect(safeNext("/account")).toBe("/community");
    expect(safeNext("/admin")).toBe("/community");
    expect(safeNext("/communityx/live")).toBe("/community");
    expect(safeNext("/community/../account")).toBe("/community");
    expect(safeNext("/community//evil.com")).toBe("/community");
  });

  it("leaves a URL inside the query string alone", () => {
    // A scheme is only dangerous at the front; inside a query it is just text.
    expect(safeNext("/community/the-lounge?ref=https://x.example")).toBe(
      "/community/the-lounge?ref=https://x.example",
    );
  });
});
