import { describe, expect, it } from "vitest";
import {
  afterClosePathError,
  afterCloseWarning,
  deadlineFromInputs,
  deadlinePassed,
  offerDeadlineErrors,
} from "./OfferDeadlineCard";
import { countdownPageLine, insertOnOwnLine, offerDeadlineLabel, offersWithCountdown } from "@/lib/adminCommerceApi";

const LA = "America/Los_Angeles";
const NOW = Date.parse("2026-11-23T20:00:00.000Z");
const label = (iso: string) => `<${iso}>`;

describe("sale deadline boxes", () => {
  it("stores no deadline when the date box is empty", () => {
    expect(deadlineFromInputs("", "", LA)).toBeNull();
    expect(deadlineFromInputs("", "23:59", LA)).toBeNull();
  });

  it("runs to 11:59 PM on the site's clock when only a day is chosen", () => {
    expect(deadlineFromInputs("2026-12-04", "", LA)).toBe("2026-12-05T07:59:00.000Z");
  });

  it("uses the time typed, on the site's clock", () => {
    expect(deadlineFromInputs("2026-12-04", "17:00", LA)).toBe("2026-12-05T01:00:00.000Z");
    expect(deadlineFromInputs("2026-07-04", "17:00", LA)).toBe("2026-07-05T00:00:00.000Z");
  });

  it("knows when a deadline is already behind us", () => {
    expect(deadlinePassed("2026-11-23T19:59:59.000Z", NOW)).toBe(true);
    expect(deadlinePassed("2026-11-23T20:00:01.000Z", NOW)).toBe(false);
    expect(deadlinePassed(null, NOW)).toBe(false);
    expect(deadlinePassed("not a date", NOW)).toBe(false);
  });
});

describe("the page visitors are sent to", () => {
  it("accepts a page on this site, or nothing at all", () => {
    expect(afterClosePathError("")).toBeNull();
    expect(afterClosePathError("   ")).toBeNull();
    expect(afterClosePathError("/store")).toBeNull();
    expect(afterClosePathError("/checkout/full-price?ref=sale", "early-bird")).toBeNull();
  });

  it("asks for the leading slash", () => {
    expect(afterClosePathError("store")).toMatch(/slash/);
  });

  it("refuses other websites, however they are spelled", () => {
    for (const path of [
      "https://example.com/x",
      "http://example.com",
      "//example.com/x",
      "\\\\example.com",
      "javascript:alert(1)",
      "mailto:a@b.co",
    ]) {
      expect(afterClosePathError(path), path).toMatch(/other websites/);
    }
  });

  it("refuses spaces and backslashes", () => {
    expect(afterClosePathError("/my page")).toMatch(/spaces/);
    expect(afterClosePathError("/a\\b")).toMatch(/spaces/);
  });

  it("refuses the offer's own checkout page", () => {
    expect(afterClosePathError("/checkout/early-bird", "early-bird")).toMatch(/own checkout/);
    expect(afterClosePathError("/checkout/Early-Bird/?x=1", "early-bird")).toMatch(/own checkout/);
    expect(afterClosePathError("/checkout/early-bird-2", "early-bird")).toBeNull();
  });
});

describe("what stops a save", () => {
  it("lets an offer with no deadline settings through", () => {
    expect(offerDeadlineErrors({})).toEqual({});
    expect(
      offerDeadlineErrors({ salesEndAt: null, afterCloseOfferId: null, afterClosePath: "", showCountdown: true }),
    ).toEqual({});
  });

  it("lets a complete, sound setup through", () => {
    expect(
      offerDeadlineErrors(
        { salesEndAt: "2026-12-05T07:59:00.000Z", afterCloseOfferId: 8, afterClosePath: "" },
        { id: 7, slug: "early-bird" },
      ),
    ).toEqual({});
  });

  it("names each field that is wrong", () => {
    const errors = offerDeadlineErrors(
      { salesEndAt: "soon", afterCloseOfferId: 7, afterClosePath: "store" },
      { id: 7, slug: "early-bird" },
    );
    expect(Object.keys(errors).sort()).toEqual(["afterCloseOfferId", "afterClosePath", "salesEndAt"]);
    for (const message of Object.values(errors)) expect(message.length).toBeGreaterThan(10);
  });

  it("cannot compare against itself before the offer has been saved", () => {
    expect(offerDeadlineErrors({ afterCloseOfferId: 7 }, { id: null })).toEqual({});
  });
});

describe("a caution about the offer visitors are sent on to", () => {
  const open = { title: "Full price", status: "published" as const, salesEndAt: null };

  it("says nothing for an open offer with no deadline, or for no offer", () => {
    expect(afterCloseWarning(open, "2026-12-05T07:59:00.000Z", NOW, label)).toBeNull();
    expect(afterCloseWarning(undefined, "2026-12-05T07:59:00.000Z", NOW, label)).toBeNull();
  });

  it("warns when that offer is not live", () => {
    expect(afterCloseWarning({ ...open, status: "draft" }, null, NOW, label)).toMatch(/not live/);
  });

  it("warns when that offer has already ended", () => {
    const ended = { ...open, salesEndAt: "2026-11-01T00:00:00.000Z" };
    const warning = afterCloseWarning(ended, "2026-12-05T07:59:00.000Z", NOW, label);
    expect(warning).toMatch(/already ended/);
    expect(warning).toContain("<2026-11-01T00:00:00.000Z>");
  });

  it("warns when that offer ends before, or together with, this one", () => {
    const earlier = { ...open, salesEndAt: "2026-12-01T00:00:00.000Z" };
    expect(afterCloseWarning(earlier, "2026-12-05T07:59:00.000Z", NOW, label)).toMatch(/ended too/);
    const together = { ...open, salesEndAt: "2026-12-05T07:59:00.000Z" };
    expect(afterCloseWarning(together, "2026-12-05T07:59:00.000Z", NOW, label)).toMatch(/ended too/);
  });

  it("is content when that offer stays open longer, or this one has no deadline", () => {
    const later = { ...open, salesEndAt: "2026-12-31T00:00:00.000Z" };
    expect(afterCloseWarning(later, "2026-12-05T07:59:00.000Z", NOW, label)).toBeNull();
    expect(afterCloseWarning(later, null, NOW, label)).toBeNull();
  });
});

describe("countdown helpers shared with the email and funnel editors", () => {
  it("spells the page line exactly", () => {
    expect(countdownPageLine("early-bird")).toBe("{countdown early-bird}");
  });

  it("offers only live offers whose deadline is still ahead, soonest first", () => {
    const offers = [
      { id: 1, status: "published" as const, salesEndAt: "2026-12-31T00:00:00.000Z" },
      { id: 2, status: "published" as const, salesEndAt: "2026-11-01T00:00:00.000Z" },
      { id: 3, status: "draft" as const, salesEndAt: "2026-12-05T00:00:00.000Z" },
      { id: 4, status: "published" as const, salesEndAt: null },
      { id: 5, status: "published" as const },
      { id: 6, status: "published" as const, salesEndAt: "2026-12-05T00:00:00.000Z" },
      { id: 7, status: "published" as const, salesEndAt: "nonsense" },
    ];
    expect(offersWithCountdown(offers, NOW).map((offer) => offer.id)).toEqual([6, 1]);
  });

  it("takes the server's word for whether a sale has ended, over this device's clock", () => {
    const offers = [
      // The device clock says this one is over; the server says it is still on.
      { id: 1, status: "published" as const, salesEndAt: "2026-11-01T00:00:00.000Z", saleClosed: false },
      // The device clock says this one is still on; the server says it is over.
      { id: 2, status: "published" as const, salesEndAt: "2026-12-31T00:00:00.000Z", saleClosed: true },
      // "Not closed" with no deadline is still nothing to count down to.
      { id: 3, status: "published" as const, salesEndAt: null, saleClosed: false },
      { id: 4, status: "draft" as const, salesEndAt: "2026-12-05T00:00:00.000Z", saleClosed: false },
    ];
    expect(offersWithCountdown(offers, NOW).map((offer) => offer.id)).toEqual([1]);
  });

  it("uses the server's deadline wording and works it out only when the row has none", () => {
    const local = () => "worked out here";
    const salesEndAt = "2026-12-05T07:59:00.000Z";
    expect(offerDeadlineLabel({ salesEndAt, salesEndLabel: "Friday, December 4 at 11:59 PM PST" }, local)).toBe(
      "Friday, December 4 at 11:59 PM PST",
    );
    expect(offerDeadlineLabel({ salesEndAt, salesEndLabel: "" }, local)).toBe("worked out here");
    expect(offerDeadlineLabel({ salesEndAt }, local)).toBe("worked out here");
  });

  it("puts the line on its own, after the line the cursor is on", () => {
    const line = "{countdown early-bird}";
    expect(insertOnOwnLine("", 0, line)).toEqual({ value: `${line}\n`, caret: line.length });
    // Cursor in the middle of the first paragraph: the sentence is not split.
    expect(insertOnOwnLine("Doors close soon.\n\nJoin us.", 5, line).value).toBe(
      `Doors close soon.\n\n${line}\n\nJoin us.`,
    );
    // Cursor at the very end.
    const end = insertOnOwnLine("Doors close soon.", 17, line);
    expect(end.value).toBe(`Doors close soon.\n\n${line}\n`);
    expect(end.value.slice(0, end.caret).endsWith(line)).toBe(true);
    // A cursor position past the end is treated as the end.
    expect(insertOnOwnLine("Hi", 99, line).value).toBe(`Hi\n\n${line}\n`);
  });
});
