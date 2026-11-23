import { beforeEach, describe, expect, it, vi } from "vitest";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../db/pool", () => ({ pool: { query } }));
vi.mock("./siteTime", () => ({ siteTimeZone: vi.fn(async () => "America/Los_Angeles") }));

import {
  OfferClosedError,
  assertOfferOpen,
  buildOfferDeadline,
  deadlinePassed,
  formatEndsLabel,
  offerCheckoutPath,
  offerClosedBody,
  offerDeadline,
  publicDeadline,
  resolveAfterCloseUrl,
  safeSitePath,
  type OfferDeadlineRow,
} from "./offerDeadline";

const LA = "America/Los_Angeles";
/** 11:59 PM PST on Friday 4 December 2026. */
const END = new Date("2026-12-04T23:59:00-08:00");
const BEFORE = new Date("2026-12-01T12:00:00-08:00");
const AFTER = new Date("2026-12-05T00:00:00-08:00");

function row(overrides: Partial<OfferDeadlineRow> = {}): OfferDeadlineRow {
  return {
    id: 10,
    slug: "black-friday-toolkit",
    title: "Black Friday Toolkit",
    status: "published",
    sales_end_at: END,
    show_countdown: true,
    after_close_path: "",
    fallback_id: null,
    fallback_slug: null,
    fallback_status: null,
    fallback_sales_end_at: null,
    ...overrides,
  };
}

describe("formatEndsLabel", () => {
  it("spells the deadline with the day, the time and the zone", () => {
    expect(formatEndsLabel(END, LA)).toBe("Friday, December 4 at 11:59 PM PST");
  });

  it("uses the summer zone label for a summer deadline", () => {
    expect(formatEndsLabel(new Date("2027-07-04T21:00:00-07:00"), LA)).toBe("Sunday, July 4 at 9:00 PM PDT");
  });

  it("shows the site's day, not the server's", () => {
    // 07:59 UTC on the 5th is still 11:59 PM on the 4th in Los Angeles.
    expect(formatEndsLabel(new Date("2026-12-05T07:59:00Z"), LA)).toBe("Friday, December 4 at 11:59 PM PST");
    expect(formatEndsLabel(new Date("2026-12-05T07:59:00Z"), "America/New_York")).toBe("Saturday, December 5 at 2:59 AM EST");
  });

  it("uses plain spaces only", () => {
    expect(/[  ]/.test(formatEndsLabel(END, LA))).toBe(false);
  });
});

describe("deadlinePassed", () => {
  it("is open before the deadline and closed from its own instant onward", () => {
    expect(deadlinePassed(END, new Date(END.getTime() - 1))).toBe(false);
    expect(deadlinePassed(END, END)).toBe(true);
    expect(deadlinePassed(END, AFTER)).toBe(true);
  });

  it("never closes an offer with no deadline or an unreadable one", () => {
    expect(deadlinePassed(null, AFTER)).toBe(false);
    expect(deadlinePassed(undefined, AFTER)).toBe(false);
    expect(deadlinePassed("not a date", AFTER)).toBe(false);
  });

  it("reads a timestamp string the way the database driver may hand it over", () => {
    expect(deadlinePassed("2026-12-05T07:59:00.000Z", AFTER)).toBe(true);
    expect(deadlinePassed("2026-12-05T07:59:00.000Z", BEFORE)).toBe(false);
  });
});

describe("safeSitePath", () => {
  it("keeps a path on this site", () => {
    expect(safeSitePath("/store")).toBe("/store");
    expect(safeSitePath(" /checkout/toolkit?option=3 ")).toBe("/checkout/toolkit?option=3");
    expect(safeSitePath("/")).toBe("/");
  });

  it("refuses anything that could leave the site", () => {
    for (const bad of ["", "store", "https://evil.example", "//evil.example", "/\\evil.example", "/a\\b", "/a b", "/a\nb", "javascript:alert(1)", null, undefined, 7]) {
      expect(safeSitePath(bad)).toBe("");
    }
    expect(safeSitePath(`/${"a".repeat(600)}`)).toBe("");
  });
});

describe("resolveAfterCloseUrl", () => {
  const fallback = { fallback_id: 11, fallback_slug: "toolkit", fallback_status: "published", fallback_sales_end_at: null };

  it("sends visitors to the fallback offer's checkout while it is on sale", () => {
    expect(resolveAfterCloseUrl(row(fallback), AFTER)).toBe("/checkout/toolkit");
    expect(resolveAfterCloseUrl(row({ ...fallback, after_close_path: "/store" }), AFTER)).toBe("/checkout/toolkit");
    // A fallback with a deadline of its own that has not passed yet.
    expect(resolveAfterCloseUrl(row({ ...fallback, fallback_sales_end_at: "2027-01-01T00:00:00Z" }), AFTER)).toBe("/checkout/toolkit");
  });

  it("falls back to the owner's path when the fallback offer has closed", () => {
    const closed = { ...fallback, fallback_sales_end_at: BEFORE, after_close_path: "/store" };
    expect(resolveAfterCloseUrl(row(closed), AFTER)).toBe("/store");
  });

  it("falls back to the owner's path when the fallback offer is a draft or archived", () => {
    expect(resolveAfterCloseUrl(row({ ...fallback, fallback_status: "draft", after_close_path: "/store" }), AFTER)).toBe("/store");
    expect(resolveAfterCloseUrl(row({ ...fallback, fallback_status: "archived", after_close_path: "/store" }), AFTER)).toBe("/store");
  });

  it("never sends visitors back to the offer that just closed", () => {
    const self = { fallback_id: 10, fallback_slug: "black-friday-toolkit", fallback_status: "published", fallback_sales_end_at: null };
    expect(resolveAfterCloseUrl(row(self), AFTER)).toBe("");
    expect(resolveAfterCloseUrl(row({ ...self, after_close_path: "/store" }), AFTER)).toBe("/store");
    expect(resolveAfterCloseUrl(row({ after_close_path: "/checkout/black-friday-toolkit" }), AFTER)).toBe("");
  });

  it("answers nothing when there is no usable destination", () => {
    expect(resolveAfterCloseUrl(row(), AFTER)).toBe("");
    expect(resolveAfterCloseUrl(row({ ...fallback, fallback_status: "draft" }), AFTER)).toBe("");
    expect(resolveAfterCloseUrl(row({ after_close_path: "//evil.example" }), AFTER)).toBe("");
    expect(resolveAfterCloseUrl(row({ after_close_path: "https://evil.example" }), AFTER)).toBe("");
  });

  it("escapes the fallback slug", () => {
    expect(offerCheckoutPath("a b")).toBe("/checkout/a%20b");
  });
});

describe("buildOfferDeadline", () => {
  it("describes an open sale", () => {
    expect(buildOfferDeadline(row({ fallback_id: 11, fallback_slug: "toolkit", fallback_status: "published" }), LA, BEFORE)).toEqual({
      offerId: 10,
      slug: "black-friday-toolkit",
      title: "Black Friday Toolkit",
      endsAt: "2026-12-05T07:59:00.000Z",
      endsLabel: "Friday, December 4 at 11:59 PM PST",
      closed: false,
      showCountdown: true,
      checkoutUrl: "/checkout/black-friday-toolkit",
      afterCloseUrl: "/checkout/toolkit",
      serverNow: BEFORE.toISOString(),
    });
  });

  it("marks the sale closed once the deadline has passed", () => {
    const deadline = buildOfferDeadline(row({ after_close_path: "/store" }), LA, AFTER);
    expect(deadline.closed).toBe(true);
    expect(deadline.afterCloseUrl).toBe("/store");
  });

  it("is never closed, and has no label, without a deadline", () => {
    const deadline = buildOfferDeadline(row({ sales_end_at: null, show_countdown: false }), LA, AFTER);
    expect(deadline).toMatchObject({ endsAt: null, endsLabel: "", closed: false, showCountdown: false });
  });

  it("treats a row from before the migration as an open offer with the timer on", () => {
    const deadline = buildOfferDeadline({ id: 3, slug: "old", title: "Old" }, LA, AFTER);
    expect(deadline).toMatchObject({ endsAt: null, closed: false, showCountdown: true, afterCloseUrl: "" });
  });
});

describe("publicDeadline", () => {
  const offer = { endsAt: END.toISOString(), showCountdown: true, serverNow: BEFORE.toISOString() };

  it("is null when neither the offer nor the option closes", () => {
    expect(publicDeadline(null, null, LA, BEFORE)).toBeNull();
    expect(publicDeadline({ ...offer, endsAt: null }, undefined, LA, BEFORE)).toBeNull();
  });

  it("counts down to the offer's deadline", () => {
    expect(publicDeadline(offer, null, LA, BEFORE)).toEqual({
      endsAt: "2026-12-05T07:59:00.000Z",
      endsLabel: "Friday, December 4 at 11:59 PM PST",
      serverNow: BEFORE.toISOString(),
      showCountdown: true,
    });
  });

  it("keeps the offer's deadline when the chosen pricing option closes first", () => {
    // One clock for the whole offer: switching price options must not move it.
    const answer = publicDeadline(offer, "2026-12-03T20:00:00-08:00", LA, BEFORE);
    expect(answer?.endsAt).toBe("2026-12-05T07:59:00.000Z");
    expect(answer?.endsLabel).toBe("Friday, December 4 at 11:59 PM PST");
  });

  it("keeps the offer's deadline when the option closes later", () => {
    expect(publicDeadline(offer, "2026-12-20T20:00:00-08:00", LA, BEFORE)?.endsAt).toBe("2026-12-05T07:59:00.000Z");
  });

  it("shows no timer for an option's own window when the offer has no deadline", () => {
    expect(publicDeadline({ endsAt: null, showCountdown: true, serverNow: BEFORE.toISOString() }, END, LA, BEFORE)).toBeNull();
    expect(publicDeadline(null, END, LA, BEFORE)).toBeNull();
  });
});

describe("offerDeadline and assertOfferOpen", () => {
  beforeEach(() => {
    query.mockReset();
    vi.useRealTimers();
  });

  it("answers null for an unknown offer and for one that is not published", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect(await offerDeadline("nope")).toBeNull();
    query.mockResolvedValueOnce({ rows: [row({ status: "draft" })] });
    expect(await offerDeadline(10)).toBeNull();
    query.mockResolvedValueOnce({ rows: [row({ status: "draft" })] });
    expect(await offerDeadline(10, { anyStatus: true })).not.toBeNull();
  });

  it("looks an offer up by slug or by id", async () => {
    query.mockResolvedValue({ rows: [row({ sales_end_at: null })] });
    await offerDeadline("black-friday-toolkit");
    expect(query.mock.calls[0][0]).toContain("o.slug = $1");
    await offerDeadline(10);
    expect(query.mock.calls[1][0]).toContain("o.id = $1");
    expect(await offerDeadline(0)).toBeNull();
    expect(await offerDeadline("  ")).toBeNull();
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("lets an order start while the sale is on, and when there is no deadline", async () => {
    query.mockResolvedValueOnce({ rows: [row({ sales_end_at: new Date(Date.now() + 60_000) })] });
    await expect(assertOfferOpen(10)).resolves.toBeUndefined();
    query.mockResolvedValueOnce({ rows: [row({ sales_end_at: null })] });
    await expect(assertOfferOpen(10)).resolves.toBeUndefined();
    query.mockResolvedValueOnce({ rows: [] });
    await expect(assertOfferOpen(10)).resolves.toBeUndefined();
  });

  it("refuses a new order after the deadline with a 410 that says where to go", async () => {
    query.mockResolvedValueOnce({
      rows: [row({ sales_end_at: new Date(Date.now() - 60_000), fallback_id: 11, fallback_slug: "toolkit", fallback_status: "published" })],
    });
    const error = await assertOfferOpen(10).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(OfferClosedError);
    const closed = error as OfferClosedError;
    expect(closed.status).toBe(410);
    expect(offerClosedBody(closed)).toEqual({
      error: "This offer has ended.",
      code: "offer_closed",
      redirectTo: "/checkout/toolkit",
      details: { code: "offer_closed", redirectTo: "/checkout/toolkit" },
    });
  });

  it("can name the item in the refusal", async () => {
    query.mockResolvedValueOnce({ rows: [row({ sales_end_at: new Date(Date.now() - 60_000) })] });
    await expect(assertOfferOpen(10, "Black Friday Toolkit is no longer on sale.")).rejects.toThrow("Black Friday Toolkit is no longer on sale.");
  });
});
