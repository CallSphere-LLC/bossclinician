import type { AddressInfo } from "net";
import type http from "http";
import express, { type NextFunction, type Request, type Response } from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../config/env", () => ({ env: { publicSiteUrl: "https://example.test", nodeEnv: "test" } }));
const offerDeadline = vi.fn();
vi.mock("../../services/offerDeadline", () => ({
  offerDeadline: (...args: unknown[]) => offerDeadline(...args),
}));

import {
  COUNTDOWN_MEMO_MAX,
  cleanSlug,
  countdownGifFor,
  countdownMemoSize,
  countdownRouter,
  goPath,
  resetCountdownMemo,
  sameSitePath,
} from "./countdown";
import { ENDED_TEXT, OPEN_TEXT, renderCountdownGif, renderMessageGif } from "../../services/countdownGif";
import { rateLimitSurface } from "../../middleware/rateLimit";

const ENDED = renderMessageGif(ENDED_TEXT);
const OPEN = renderMessageGif(OPEN_TEXT);

/** An offer on sale, closing an hour from "now". */
const openOffer = (over: Record<string, unknown> = {}) => ({
  offerId: 7,
  slug: "spring-sale",
  title: "Spring Sale",
  endsAt: new Date(Date.now() + 3600_000).toISOString(),
  endsLabel: "Friday, December 4 at 11:59 PM PST",
  closed: false,
  showCountdown: true,
  checkoutUrl: "/checkout/spring-sale",
  afterCloseUrl: "/checkout/full-price",
  serverNow: new Date().toISOString(),
  ...over,
});

let server: http.Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use("/api", countdownRouter);
  app.use((err: { status?: number; message?: string }, _req: Request, res: Response, _next: NextFunction) => {
    res.status(err.status ?? 500).json({ error: err.message });
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  vi.clearAllMocks();
  // Reset, not just clear: one test below makes the lookup throw, and that must not leak.
  offerDeadline.mockReset();
  resetCountdownMemo();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

const bytes = async (res: { arrayBuffer(): Promise<ArrayBuffer> }): Promise<Buffer> =>
  Buffer.from(await res.arrayBuffer());

describe("cleanSlug", () => {
  it("accepts what the offer editor accepts and nothing else", () => {
    expect(cleanSlug("fully-booked-toolkit")).toBe("fully-booked-toolkit");
    expect(cleanSlug("club_2027")).toBe("club_2027");
    for (const bad of ["", "Spring-Sale", "a--b", "-a", "a-", "a.b", "a/b", "a b", "../etc", "a%20b", "x".repeat(201), 5, null]) {
      expect(cleanSlug(bad)).toBeNull();
    }
  });
});

describe("GET /api/countdown/:slug.gif", () => {
  it("serves the timer at both addresses, uncacheable and with no cookie", async () => {
    offerDeadline.mockResolvedValue(openOffer());
    for (const path of ["/countdown/spring-sale.gif", "/countdown/spring-sale"]) {
      const res = await fetch(`${base}${path}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/gif");
      expect(res.headers.get("cache-control")).toBe("no-store, max-age=0");
      expect(res.headers.get("set-cookie")).toBeNull();
      expect(res.headers.get("etag")).toBeNull();
      const body = await bytes(res);
      expect(res.headers.get("content-length")).toBe(String(body.length));
      expect(body.subarray(0, 6).toString("latin1")).toBe("GIF89a");
      expect(body[body.length - 1]).toBe(0x3b);
      // An animated timer, not either of the stills.
      expect(body.length).toBeGreaterThan(ENDED.length);
      expect(body.equals(ENDED)).toBe(false);
    }
    expect(offerDeadline).toHaveBeenCalledWith("spring-sale");
  });

  it("answers an unknown offer with the ended picture and a 200, never a broken image", async () => {
    offerDeadline.mockResolvedValue(null);
    const res = await fetch(`${base}/countdown/no-such-offer.gif`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/gif");
    expect((await bytes(res)).equals(ENDED)).toBe(true);
  });

  it("answers a malformed address the same way without asking the database", async () => {
    for (const path of ["/countdown/Not%20A%20Slug.gif", "/countdown/a..b.gif", "/countdown/.gif", "/countdown/a--b"]) {
      const res = await fetch(`${base}${path}`);
      expect(res.status).toBe(200);
      expect((await bytes(res)).equals(ENDED)).toBe(true);
    }
    expect(offerDeadline).not.toHaveBeenCalled();
  });

  it("serves the ended picture once the sale has closed", async () => {
    offerDeadline.mockResolvedValue(openOffer({ closed: true, endsAt: new Date(Date.now() - 1000).toISOString() }));
    expect((await bytes(await fetch(`${base}/countdown/spring-sale.gif`))).equals(ENDED)).toBe(true);
  });

  it("serves a neutral still, not 'ended', for an offer with no deadline", async () => {
    offerDeadline.mockResolvedValue(openOffer({ endsAt: null, endsLabel: "" }));
    expect((await bytes(await fetch(`${base}/countdown/spring-sale.gif`))).equals(OPEN)).toBe(true);
  });

  it("still serves a picture when the lookup fails", async () => {
    offerDeadline.mockRejectedValue(new Error("database is down"));
    const res = await fetch(`${base}/countdown/spring-sale.gif`);
    expect(res.status).toBe(200);
    expect((await bytes(res)).equals(ENDED)).toBe(true);

    resetCountdownMemo();
    offerDeadline.mockImplementation(() => {
      throw new Error("thrown, not rejected");
    });
    const again = await fetch(`${base}/countdown/spring-sale.gif`);
    expect(again.status).toBe(200);
    expect((await bytes(again)).equals(ENDED)).toBe(true);
  });
});

describe("countdownGifFor", () => {
  const NOW = Date.UTC(2026, 10, 23, 20, 0, 0);

  it("counts down from the time left, rounded up to a whole second", async () => {
    offerDeadline.mockResolvedValue(openOffer({ endsAt: new Date(NOW + 90_400).toISOString() }));
    expect((await countdownGifFor("spring-sale", NOW)).equals(renderCountdownGif(91))).toBe(true);
  });

  it("draws once for everyone who opens in the same second", async () => {
    offerDeadline.mockResolvedValue(openOffer({ endsAt: new Date(NOW + 600_000).toISOString() }));
    const [a, b, c] = await Promise.all([
      countdownGifFor("spring-sale", NOW),
      countdownGifFor("spring-sale", NOW + 300),
      countdownGifFor("spring-sale", NOW + 999),
    ]);
    expect(offerDeadline).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(b).toBe(c);

    const later = await countdownGifFor("spring-sale", NOW + 1000);
    expect(offerDeadline).toHaveBeenCalledTimes(2);
    expect(later.equals(a)).toBe(false);
    expect(countdownMemoSize()).toBe(1);
  });

  it("remembers an unknown offer for the second too", async () => {
    offerDeadline.mockResolvedValue(null);
    await Promise.all([countdownGifFor("nope", NOW), countdownGifFor("nope", NOW + 1)]);
    expect(offerDeadline).toHaveBeenCalledTimes(1);
  });

  it("never grows past its ceiling", async () => {
    offerDeadline.mockResolvedValue(null);
    for (let i = 0; i < COUNTDOWN_MEMO_MAX + 50; i += 1) await countdownGifFor(`offer-${i}`, NOW);
    expect(countdownMemoSize()).toBeLessThanOrEqual(COUNTDOWN_MEMO_MAX);
    await countdownGifFor("a-new-second", NOW + 5000);
    expect(countdownMemoSize()).toBeLessThanOrEqual(COUNTDOWN_MEMO_MAX);
  });

  it("treats an unreadable deadline as ended", async () => {
    offerDeadline.mockResolvedValue(openOffer({ endsAt: "not a date" }));
    expect((await countdownGifFor("spring-sale", NOW)).equals(ENDED)).toBe(true);
  });
});

describe("GET /api/countdown/:slug/status", () => {
  it("returns exactly the fields the on-page timer needs", async () => {
    const offer = openOffer();
    offerDeadline.mockResolvedValue(offer);
    const res = await fetch(`${base}/countdown/spring-sale/status`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      endsAt: offer.endsAt,
      endsLabel: offer.endsLabel,
      closed: false,
      showCountdown: true,
      checkoutUrl: "/checkout/spring-sale",
      afterCloseUrl: "/checkout/full-price",
      serverNow: offer.serverNow,
    });
  });

  it("is a 404 for an unknown or malformed offer", async () => {
    offerDeadline.mockResolvedValue(null);
    expect((await fetch(`${base}/countdown/no-such-offer/status`)).status).toBe(404);
    offerDeadline.mockClear();
    expect((await fetch(`${base}/countdown/Bad%20Slug/status`)).status).toBe(404);
    expect(offerDeadline).not.toHaveBeenCalled();
  });
});

describe("GET /api/countdown/:slug/go", () => {
  const go = (slug: string) => fetch(`${base}/countdown/${slug}/go`, { redirect: "manual" });

  it("sends an open sale to its checkout", async () => {
    offerDeadline.mockResolvedValue(openOffer());
    const res = await go("spring-sale");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://example.test/checkout/spring-sale");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("sends a closed sale to the page the owner chose", async () => {
    offerDeadline.mockResolvedValue(openOffer({ closed: true }));
    expect((await go("spring-sale")).headers.get("location")).toBe("https://example.test/checkout/full-price");
  });

  it("sends a closed sale with nowhere chosen to the store", async () => {
    offerDeadline.mockResolvedValue(openOffer({ closed: true, afterCloseUrl: "" }));
    expect((await go("spring-sale")).headers.get("location")).toBe("https://example.test/store");
  });

  it("sends an unknown or malformed link to the home page", async () => {
    offerDeadline.mockResolvedValue(null);
    expect((await go("no-such-offer")).headers.get("location")).toBe("https://example.test/");
    offerDeadline.mockClear();
    const bad = await go("Bad%20Slug");
    expect(bad.status).toBe(302);
    expect(bad.headers.get("location")).toBe("https://example.test/");
    expect(offerDeadline).not.toHaveBeenCalled();
  });

  it("sends the visitor home rather than showing an error when the lookup fails", async () => {
    offerDeadline.mockRejectedValue(new Error("database is down"));
    const res = await go("spring-sale");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://example.test/");
  });

  it("never leaves the site, whatever the stored destination says", async () => {
    for (const evil of ["//evil.example/x", "https://evil.example", "/\\evil.example", "javascript:alert(1)", "/a\r\nSet-Cookie: x=1", "/api/countdown/spring-sale/go"]) {
      offerDeadline.mockResolvedValue(openOffer({ closed: true, afterCloseUrl: evil }));
      expect((await go("spring-sale")).headers.get("location")).toBe("https://example.test/store");
      offerDeadline.mockResolvedValue(openOffer({ checkoutUrl: evil }));
      expect((await go("spring-sale")).headers.get("location")).toBe("https://example.test/");
    }
  });
});

describe("goPath and sameSitePath", () => {
  it("only ever returns a path on this site", () => {
    expect(sameSitePath("/checkout/full-price?x=1")).toBe("/checkout/full-price?x=1");
    expect(sameSitePath("  /store  ")).toBe("/store");
    for (const bad of ["", "store", "//x", "/\\x", "http://x", "/a\tb", "/a\nb", 3, null, undefined]) {
      expect(sameSitePath(bad)).toBeNull();
    }
    expect(goPath(null)).toBe("/");
  });
});

describe("the site-wide rate limiter", () => {
  it("leaves the email picture alone and still counts the JSON and the link", () => {
    expect(rateLimitSurface("/api/countdown/spring-sale.gif")).toBeNull();
    expect(rateLimitSurface("/api/countdown/spring-sale")).toBeNull();
    expect(rateLimitSurface("/api/countdown/spring-sale/status")).toBe("public");
    expect(rateLimitSurface("/api/countdown/spring-sale/go")).toBe("public");
    expect(rateLimitSurface("/api/countdown")).toBe("public");
    expect(rateLimitSurface("/api/offers/spring-sale")).toBe("public");
  });
});
