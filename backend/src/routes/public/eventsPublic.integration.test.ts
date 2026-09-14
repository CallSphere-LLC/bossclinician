import express from "express";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Client } from "pg";
import { createTestDatabase, hasTestDatabase, insertMember } from "../../testing/db";

/**
 * The events chain, end to end over HTTP: a published event's page, a
 * registration, the calendar file, and the member's own list.
 *
 * Every link in it has been verified by hand on the live site and each one has
 * broken at least once in a way no unit test saw — a calendar file without a
 * VEVENT, a session shown in the viewer's zone instead of the registrant's.
 * This is the chain as a test, including the two things lane H added to it: a
 * repeating event, which puts every session into the calendar file and onto the
 * member's page, and an in-person event, whose address is shown on the page and
 * written as LOCATION.
 *
 * Skipped when TEST_DATABASE_URL is unset, like every other suite here.
 */

const describeDb = hasTestDatabase ? describe : describe.skip;

describeDb("events: page, register, calendar, my events (integration)", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let client: Client;
  let server: Server;
  let baseUrl: string;
  let signMemberAccessToken: typeof import("../../auth/memberSession").signMemberAccessToken;

  beforeAll(async () => {
    db = await createTestDatabase("eventchain");
    client = db.client;

    // config/env reads process.env at import time, so the environment has to
    // point at the scratch database before the first dynamic import.
    process.env.DATABASE_URL = db.url;
    process.env.JWT_SECRET ??= "integration-test-secret";
    process.env.PUBLIC_SITE_URL ??= "https://example.invalid";

    const { eventsPublicRouter } = await import("./eventsPublic");
    const { memberEventsRouter } = await import("../member/events");
    const { requireMember } = await import("../../middleware/memberAuth");
    const { errorHandler } = await import("../../middleware/errorHandler");
    signMemberAccessToken = (await import("../../auth/memberSession")).signMemberAccessToken;

    const app = express();
    app.use(express.json());
    app.use("/api/member/events", requireMember, memberEventsRouter);
    app.use("/api", eventsPublicRouter);
    app.use(errorHandler);

    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 90_000);

  afterAll(async () => {
    await new Promise((resolve) => server?.close(resolve));
    const { pool } = await import("../../db/pool");
    await pool.end().catch(() => undefined);
    await db?.drop();
  });

  /* -------------------------------------------------------------- fixtures */

  // 18 June 2030 is a Tuesday; 22:00 UTC is 6:00 PM EDT and 3:00 PM PDT.
  const FIRST_SESSION = "2030-06-18T22:00:00.000Z";

  async function makeEvent(
    slug: string,
    options: {
      published?: boolean;
      roomUrl?: string;
      weeklyCount?: number;
      address?: string;
    } = {}
  ): Promise<number> {
    const res = await client.query<{ id: number }>(
      `INSERT INTO events (slug, title, kind, starts_at, duration_minutes, timezone, room_url,
                           published, recurrence_freq, recurrence_interval, recurrence_count,
                           location_type, location_address)
       VALUES ($1, $2, 'live', $3, 60, 'America/New_York', $4, $5, $6, 1, $7, $8, $9)
       RETURNING id`,
      [
        slug,
        `Event ${slug}`,
        FIRST_SESSION,
        options.roomUrl ?? "",
        options.published ?? true,
        options.weeklyCount ? "weekly" : null,
        options.weeklyCount ?? null,
        options.address ? "in_person" : "online",
        options.address ?? "",
      ]
    );
    return res.rows[0].id;
  }

  async function register(slug: string, email: string, timezone: string) {
    const res = await fetch(`${baseUrl}/api/events/${slug}/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, name: "Test Person", timezone, elapsedMs: 5000 }),
    });
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  }

  async function myEvents(email: string) {
    const memberId = await insertMember(client, email);
    const token = signMemberAccessToken({ sub: memberId, email });
    const res = await fetch(`${baseUrl}/api/member/events`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return {
      status: res.status,
      json: (await res.json()) as { upcoming: Record<string, unknown>[]; past: unknown[] },
    };
  }

  /* ----------------------------------------------------------------- tests */

  it("keeps an unpublished event off the public site", async () => {
    await makeEvent("draft-event", { published: false });
    expect((await fetch(`${baseUrl}/api/events/draft-event`)).status).toBe(404);
  });

  it("carries a single online session through the whole chain, in the member's own zone", async () => {
    await makeEvent("single-online", { roomUrl: "https://zoom.invalid/j/1" });

    const page = await fetch(`${baseUrl}/api/events/single-online`);
    expect(page.status).toBe(200);
    const pageJson = (await page.json()) as Record<string, unknown>;
    expect(pageJson.startsAt).toBe(FIRST_SESSION);
    expect(pageJson.recurrenceLabel).toBe("");
    expect(pageJson.occurrences).toEqual([]);
    expect(pageJson.locationType).toBe("online");

    const reg = await register("single-online", "pacific@test.invalid", "America/Los_Angeles");
    expect(reg.status).toBe(201);
    // The confirmation is written in the event's zone, which is what the page showed.
    expect(reg.json.sessionLabel).toBe("Tuesday, June 18 at 6:00 PM EDT");
    const token = String(reg.json.token);

    const ics = await fetch(`${baseUrl}/api/events/registrations/${encodeURIComponent(token)}/ics`);
    expect(ics.status).toBe(200);
    expect(ics.headers.get("content-type")).toContain("text/calendar");
    const body = await ics.text();
    expect(body.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(body).toContain("DTSTART:20300618T220000Z");
    expect(body).not.toContain("LOCATION:");

    // The member registered from a Pacific browser, so their own page says 3:00 PM PDT.
    const mine = await myEvents("pacific@test.invalid");
    expect(mine.status).toBe(200);
    expect(mine.json.upcoming).toHaveLength(1);
    const card = mine.json.upcoming[0];
    expect(card.sessionLabel).toBe("Tuesday, June 18 at 3:00 PM PDT");
    expect(card.startsAt).toBe(FIRST_SESSION);
    expect(String(card.icsUrl)).toContain(`/api/events/registrations/${token}/ics`);
    expect(card.state).toBe("early");
    expect(card.recurrenceLabel).toBe("");
  });

  it("gives a repeating in-person event its sessions, its address, and a VEVENT per session", async () => {
    const address = "12 Main St, Suite 4, Austin, TX 78701";
    await makeEvent("weekly-in-person", { weeklyCount: 3, address });

    const page = await fetch(`${baseUrl}/api/events/weekly-in-person`);
    expect(page.status).toBe(200);
    const pageJson = (await page.json()) as Record<string, unknown>;
    expect(pageJson.recurrenceLabel).toBe("Every week, 3 sessions");
    expect(pageJson.occurrences).toEqual([
      "2030-06-18T22:00:00.000Z",
      "2030-06-25T22:00:00.000Z",
      "2030-07-02T22:00:00.000Z",
    ]);
    expect(pageJson.locationType).toBe("in_person");
    expect(pageJson.locationAddress).toBe(address);
    expect(pageJson.hasJoinLink).toBe(false);

    const reg = await register("weekly-in-person", "series@test.invalid", "America/Los_Angeles");
    expect(reg.status).toBe(201);
    expect(reg.json.occurrences).toHaveLength(3);
    expect(reg.json.locationAddress).toBe(address);

    const ics = await fetch(
      `${baseUrl}/api/events/registrations/${encodeURIComponent(String(reg.json.token))}/ics`
    );
    expect(ics.status).toBe(200);
    const body = await ics.text();
    expect(body.match(/BEGIN:VEVENT/g)).toHaveLength(3);
    expect(body).toContain("DTSTART:20300618T220000Z");
    expect(body).toContain("DTSTART:20300625T220000Z");
    expect(body).toContain("DTSTART:20300702T220000Z");
    expect(body).toContain("LOCATION:12 Main St\\, Suite 4\\, Austin\\, TX 78701");

    const mine = await myEvents("series@test.invalid");
    const card = mine.json.upcoming[0];
    expect(card.recurrenceLabel).toBe("Every week, 3 sessions");
    expect(card.locationAddress).toBe(address);
    // No online link on an in-person event, so no room link either.
    expect(card.roomUrl).toBe("");
    const sessions = card.occurrences as { startsAt: string; label: string }[];
    expect(sessions).toHaveLength(3);
    expect(sessions[1].label).toBe("Tuesday, June 25 at 3:00 PM PDT");
  });
});
