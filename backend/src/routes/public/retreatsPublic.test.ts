import type { AddressInfo } from "net";
import type http from "http";
import express, { type NextFunction, type Request, type Response } from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("../../db/pool", () => ({ pool: { query: (...args: unknown[]) => query(...args), connect: vi.fn() } }));
vi.mock("../../middleware/rateLimit", () => ({
  subscribeLimiter: (_req: Request, _res: Response, next: NextFunction) => next(),
}));
const validateCollectedEmail = vi.fn();
vi.mock("../../email/sesValidation", () => ({ validateCollectedEmail: (...a: unknown[]) => validateCollectedEmail(...a) }));
const upsertContactWithStatus = vi.fn();
const applyTags = vi.fn();
const recordActivity = vi.fn();
vi.mock("../../services/contacts", () => ({
  upsertContactWithStatus: (...a: unknown[]) => upsertContactWithStatus(...a),
  applyTags: (...a: unknown[]) => applyTags(...a),
  recordActivity: (...a: unknown[]) => recordActivity(...a),
}));
const publishDomainEvent = vi.fn();
vi.mock("../../services/domainEvents", () => ({ publishDomainEvent: (...a: unknown[]) => publishDomainEvent(...a) }));
// Never imported by the route; mocked so any future import that sends mail fails this test.
const sendMail = vi.fn();
vi.mock("../../email/mailer", () => ({ sendMail: (...a: unknown[]) => sendMail(...a) }));
const fireTriggerAsync = vi.fn();
vi.mock("../../automations/engine", () => ({ fireTriggerAsync: (...a: unknown[]) => fireTriggerAsync(...a) }));

import {
  retreatHref,
  retreatsPublicRouter,
  RETREAT_INTEREST_CONSENT,
  RETREAT_INTEREST_TAG,
  toPublicRetreat,
} from "./retreatsPublic";

const BALI_ROW = {
  slug: "bali-2027",
  title: "FlourisHealer Bali 2027",
  location: "Ubud, Bali",
  start_date: "2027-06-15",
  end_date: "2027-06-20",
  public_summary: "A six-day, five-night Bali retreat.",
  public_image: "/images/retreat-villa-aerial.webp",
  public_path: "/retreats",
  upcoming: true,
};

let server: http.Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", retreatsPublicRouter);
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
  validateCollectedEmail.mockResolvedValue({ accepted: true });
  upsertContactWithStatus.mockResolvedValue({ id: 41, created: true });
  applyTags.mockResolvedValue(1);
  recordActivity.mockResolvedValue(undefined);
  publishDomainEvent.mockResolvedValue(undefined);
});

const post = (body: unknown) =>
  fetch(`${base}/retreat-interest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("GET /api/upcoming-retreats", () => {
  it("lists only publicly listed retreats that have not ended in Pacific time, never settings", async () => {
    query.mockResolvedValueOnce({ rows: [BALI_ROW] });
    const res = await fetch(`${base}/upcoming-retreats`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { retreats: unknown[] };
    expect(body.retreats).toEqual([
      {
        slug: "bali-2027",
        title: "FlourisHealer Bali 2027",
        location: "Ubud, Bali",
        startDate: "2027-06-15",
        endDate: "2027-06-20",
        summary: "A six-day, five-night Bali retreat.",
        image: "/images/retreat-villa-aerial.webp",
        href: "/retreats",
        upcoming: true,
      },
    ]);
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain("listed_publicly = true");
    expect(sql).toContain("end_date >= (now() AT TIME ZONE 'America/Los_Angeles')::date");
    expect(sql).not.toMatch(/\bsettings\b/);
    expect(sql).not.toMatch(/\bpublished\b/);
    expect(sql).not.toContain("*");
  });

  it("answers an empty list (not null) when nothing is listed", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const body = (await (await fetch(`${base}/upcoming-retreats`)).json()) as { retreats: unknown[] };
    expect(body.retreats).toEqual([]);
  });

  it("404s an unlisted or malformed retreat slug", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect((await fetch(`${base}/upcoming-retreats/costa-rica-2028`)).status).toBe(404);
    expect((await fetch(`${base}/upcoming-retreats/Bad%20Slug`)).status).toBe(404);
    expect(query).toHaveBeenCalledTimes(1);
  });
});

describe("card links", () => {
  it("uses public_path when it is a site path or https URL, else /retreats/<slug>", () => {
    expect(retreatHref("bali-2027", "/retreats")).toBe("/retreats");
    expect(retreatHref("costa-rica-2028", null)).toBe("/retreats/costa-rica-2028");
    expect(retreatHref("x-2028", "https://example.com/x")).toBe("https://example.com/x");
    expect(retreatHref("x-2028", "//evil.example")).toBe("/retreats/x-2028");
    expect(retreatHref("x-2028", "javascript:alert(1)")).toBe("/retreats/x-2028");
    expect(retreatHref("dashboard", null)).toBe("/upcoming-retreats");
  });

  it("drops an unsafe image", () => {
    expect(toPublicRetreat({ ...BALI_ROW, public_image: "javascript:x" }).image).toBe("");
  });
});

describe("POST /api/retreat-interest", () => {
  it("stores the contact and the announcement tag, and sends nothing", async () => {
    const res = await post({ email: "guest@example.com", firstName: "Ana", consent: true, company: "", elapsedMs: 9000 });
    expect(res.status).toBe(201);
    expect(upsertContactWithStatus).toHaveBeenCalledWith(
      expect.objectContaining({ email: "guest@example.com", firstName: "Ana", consentSource: "retreat-interest" }),
    );
    expect(applyTags).toHaveBeenCalledWith(41, [RETREAT_INTEREST_TAG], "retreat-interest");
    expect(RETREAT_INTEREST_TAG).toBe("retreat-announcements");
    expect(recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({ contactId: 41, meta: expect.objectContaining({ consent: RETREAT_INTEREST_CONSENT }) }),
    );
    expect(sendMail).not.toHaveBeenCalled();
    expect(fireTriggerAsync).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it("refuses a sign-up without the consent box", async () => {
    const res = await post({ email: "guest@example.com", consent: false, elapsedMs: 9000 });
    expect(res.status).toBe(400);
    expect(upsertContactWithStatus).not.toHaveBeenCalled();
  });

  it("answers a filled honeypot or an instant submit with 201 and writes nothing", async () => {
    expect((await post({ email: "bot@example.com", consent: true, company: "Acme", elapsedMs: 9000 })).status).toBe(201);
    expect((await post({ email: "bot@example.com", consent: true, company: "", elapsedMs: 100 })).status).toBe(201);
    expect(validateCollectedEmail).not.toHaveBeenCalled();
    expect(upsertContactWithStatus).not.toHaveBeenCalled();
    expect(applyTags).not.toHaveBeenCalled();
  });

  it("refuses an address the email check rejects", async () => {
    validateCollectedEmail.mockResolvedValueOnce({ accepted: false, reason: "Please check your email address." });
    const res = await post({ email: "nobody@invalid.example", consent: true, elapsedMs: 9000 });
    expect(res.status).toBe(400);
    expect(upsertContactWithStatus).not.toHaveBeenCalled();
  });

  it("publishes contact_created only for a new contact", async () => {
    upsertContactWithStatus.mockResolvedValueOnce({ id: 7, created: false });
    await post({ email: "known@example.com", consent: true, elapsedMs: 9000 });
    expect(publishDomainEvent).not.toHaveBeenCalled();
  });
});
