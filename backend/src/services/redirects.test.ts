import { describe, it, expect } from "vitest";
import { normalizePath } from "./redirects";

/**
 * Only `normalizePath` is unit tested here: it is the pure half, and it is also
 * the half that decides whether a five-year-old Instagram link matches a row.
 * The query functions need a database and are covered by the integration pass.
 */
describe("normalizePath", () => {
  it("leaves an already-canonical path alone", () => {
    expect(normalizePath("/about")).toBe("/about");
    expect(normalizePath("/blog/some-post")).toBe("/blog/some-post");
  });

  it("lowercases, because Kajabi URLs are mixed case", () => {
    // The live site really does serve /Practice-Protection-Pack and
    // /Turn-Doctor-Referrals-Into-Ideal-Client.
    expect(normalizePath("/Practice-Protection-Pack")).toBe("/practice-protection-pack");
    expect(normalizePath("/Turn-Doctor-Referrals-Into-Ideal-Client")).toBe(
      "/turn-doctor-referrals-into-ideal-client",
    );
  });

  it("strips a trailing slash but keeps the root", () => {
    expect(normalizePath("/about/")).toBe("/about");
    expect(normalizePath("/about///")).toBe("/about");
    expect(normalizePath("/")).toBe("/");
  });

  it("drops the query string and fragment", () => {
    expect(normalizePath("/blog?tag=money-guilt")).toBe("/blog");
    expect(normalizePath("/about#team")).toBe("/about");
    expect(normalizePath("/about?a=1#b")).toBe("/about");
  });

  it("adds a missing leading slash", () => {
    expect(normalizePath("about")).toBe("/about");
  });

  it("collapses repeated slashes", () => {
    expect(normalizePath("//about//team")).toBe("/about/team");
  });

  it("extracts the path from an absolute URL", () => {
    expect(normalizePath("https://www.bossclinician.com/fullybooked")).toBe("/fullybooked");
    expect(normalizePath("http://bossclinician.com/about/")).toBe("/about");
  });

  it("survives empty and junk input without throwing", () => {
    expect(normalizePath("")).toBe("/");
    expect(normalizePath("   ")).toBe("/");
    expect(normalizePath("https://")).toBe("/https:");
  });

  it("caps absurdly long paths", () => {
    const long = `/${"a".repeat(5000)}`;
    expect(normalizePath(long).length).toBe(2000);
  });

  it("normalises both sides of a comparison identically", () => {
    // The property that matters: whatever shape a link arrives in, it lands on
    // the same key the row was stored under.
    const stored = normalizePath("/Practice-Protection-Pack");
    for (const variant of [
      "/practice-protection-pack",
      "/Practice-Protection-Pack/",
      "//PRACTICE-PROTECTION-PACK",
      "https://www.bossclinician.com/Practice-Protection-Pack?utm_source=ig",
    ]) {
      expect(normalizePath(variant)).toBe(stored);
    }
  });
});
