import http from "http";
import type { AddressInfo } from "net";
import express from "express";
import { rateLimit } from "express-rate-limit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { API_REQUESTS_PER_MINUTE, apiLimiterOptions, rateLimitSurface } from "./rateLimit";

/**
 * The site-wide backstop. In production every visitor shares one address
 * (app.ts, `trust proxy`), so what matters is not "one client is limited" but
 * that the buckets are the ones the sizing comment describes: separate per
 * surface, and never in front of the health check the deploy gate polls.
 */

describe("rateLimitSurface", () => {
  it("puts each part of the site in its own bucket", () => {
    expect(rateLimitSurface("/api/admin/contacts")).toBe("admin");
    expect(rateLimitSurface("/api/admin")).toBe("admin");
    expect(rateLimitSurface("/api/member/community/x")).toBe("member");
    expect(rateLimitSurface("/api/auth/refresh")).toBe("member");
    expect(rateLimitSurface("/account/purchases/1/receipt.pdf")).toBe("member");
    expect(rateLimitSurface("/api/v1/contacts")).toBe("integrations");
    expect(rateLimitSurface("/api/stripe/webhook")).toBe("webhooks");
    expect(rateLimitSurface("/api/email/webhook/ses")).toBe("webhooks");
    expect(rateLimitSurface("/api/blog")).toBe("public");
    expect(rateLimitSurface("/blog/a-post")).toBe("public");
    expect(rateLimitSurface("/sitemap.xml")).toBe("public");
  });

  it("matches whole path segments, not prefixes of names", () => {
    expect(rateLimitSurface("/api/administrator")).toBe("public");
    expect(rateLimitSurface("/api/authors")).toBe("public");
    expect(rateLimitSurface("/accounts")).toBe("public");
  });

  it("leaves the health check and static uploads alone", () => {
    expect(rateLimitSurface("/api/health")).toBeNull();
    expect(rateLimitSurface("/uploads/abc.png")).toBeNull();
  });

  it("is sized well above the busiest minute measured in production (523)", () => {
    expect(API_REQUESTS_PER_MINUTE).toBeGreaterThanOrEqual(10 * 523);
  });
});

describe("the limiter, with a ceiling small enough to reach", () => {
  let server: http.Server;
  let port: number;

  const get = (path: string): Promise<{ status: number; body: string; limit?: string }> =>
    new Promise((resolve, reject) => {
      http
        .get({ host: "127.0.0.1", port, path }, (response) => {
          let body = "";
          response.on("data", (chunk) => (body += chunk));
          response.on("end", () =>
            resolve({
              status: response.statusCode ?? 0,
              body,
              limit: response.headers["ratelimit-limit"] as string | undefined,
            })
          );
        })
        .on("error", reject);
    });

  beforeAll(async () => {
    const app = express();
    app.use(rateLimit(apiLimiterOptions(3)));
    app.use((_req, res) => res.json({ ok: true }));
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("refuses the request over the ceiling with the API's JSON error shape", async () => {
    for (let i = 0; i < 3; i += 1) expect((await get("/api/blog")).status).toBe(200);
    const refused = await get("/api/blog");
    expect(refused.status).toBe(429);
    expect(JSON.parse(refused.body)).toEqual({ error: "Too many requests. Please try again later." });
  });

  it("keeps the admin's bucket separate from a flooded public one", async () => {
    // The public bucket is already spent by the test above.
    expect((await get("/api/blog")).status).toBe(429);
    const admin = await get("/api/admin/contacts");
    expect(admin.status).toBe(200);
    expect(admin.limit).toBe("3");
  });

  it("never limits the health check", async () => {
    for (let i = 0; i < 10; i += 1) {
      const health = await get("/api/health");
      expect(health.status).toBe(200);
      expect(health.limit).toBeUndefined();
    }
  });
});
