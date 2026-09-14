import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { Client } from "pg";
import { createTestDatabase, hasTestDatabase } from "../testing/db";

/**
 * Integration tests for event reminders.
 *
 * Almost every interesting property of this feature is a property of SQL: the
 * unique index that makes a reminder fire once, the claim that stops two
 * workers holding the same row, the `created_at` comparison that stops turning
 * on a confirmation from mailing the back catalogue, and the sweep that retires
 * a backlog rather than sending it. None of that is observable without a
 * database, and all of it is the difference between reminders and an apology.
 *
 * The mail path is stubbed rather than mocked away, because the outcomes it can
 * return are exactly what these tests are about: a send the provider accepted, a
 * send it refused, and the requirement that the second is never recorded as the
 * first. The sending account is on probation as this is written, so "refused" is
 * currently the only real answer the transport gives.
 *
 * Skipped when TEST_DATABASE_URL is unset, so `npm test` needs nothing running.
 */

const describeDb = hasTestDatabase ? describe : describe.skip;

/** Stands in for `email/provider`'s sendEmail, whose outcome each test chooses. */
const sendEmailMock = vi.fn();

vi.mock("../email/provider", async () => {
  const actual = await vi.importActual<typeof import("../email/provider")>("../email/provider");
  return {
    ...actual,
    sendEmail: (input: unknown) => sendEmailMock(input),
  };
});

describeDb("event reminders (integration)", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let client: Client;
  let reminders: typeof import("./eventReminders");

  beforeAll(async () => {
    db = await createTestDatabase("evremind");
    client = db.client;

    process.env.DATABASE_URL = db.url;
    process.env.JWT_SECRET ??= "integration-test-secret";
    process.env.PUBLIC_SITE_URL ??= "https://example.invalid";
    reminders = await import("./eventReminders");
  }, 90_000);

  afterAll(async () => {
    const { pool } = await import("../db/pool");
    await pool.end().catch(() => undefined);
    await db?.drop();
  });

  beforeEach(async () => {
    await client.query(
      `TRUNCATE event_reminder_sends, event_reminders, event_registrations, events,
                email_messages, email_suppressions, jobs RESTART IDENTITY CASCADE`
    );
    sendEmailMock.mockReset();
    // The default: the provider accepted it and wrote a delivery-log row, which
    // is where the provider's own message id lives.
    sendEmailMock.mockImplementation(async (input: { to: string; subject: string }) => {
      const res = await client.query<{ id: string }>(
        `INSERT INTO email_messages
           (to_email, source_type, topic, subject, provider, provider_message_id, status, sent_at)
         VALUES ($1, 'transactional', 'events', $2, 'smtp', $3, 'sent', now())
         RETURNING id`,
        [input.to, input.subject, `ses-${Math.random().toString(16).slice(2)}`]
      );
      return {
        messageId: Number(res.rows[0].id),
        outcome: "sent",
        providerMessageId: "ses-test",
        suppressedReason: "",
      };
    });
  });

  /* ----------------------------------------------------------------- setup */

  async function makeEvent(
    startsAt: Date,
    overrides: { timezone?: string; durationMinutes?: number; published?: boolean } = {}
  ): Promise<number> {
    const res = await client.query<{ id: number }>(
      `INSERT INTO events (slug, title, kind, starts_at, duration_minutes, timezone,
                           room_url, published)
       VALUES ($1, $2, 'live', $3, $4, $5, 'https://zoom.invalid/j/1', $6)
       RETURNING id`,
      [
        `ev-${Math.random().toString(16).slice(2)}`,
        "A webinar",
        startsAt,
        overrides.durationMinutes ?? 60,
        overrides.timezone ?? "America/New_York",
        overrides.published ?? true,
      ]
    );
    return res.rows[0].id;
  }

  async function register(
    eventId: number,
    sessionAt: Date,
    overrides: { email?: string; createdAt?: Date } = {}
  ): Promise<number> {
    const res = await client.query<{ id: string }>(
      `INSERT INTO event_registrations (event_id, email, name, session_at, created_at)
       VALUES ($1, $2, 'Test Person', $3, $4)
       RETURNING id`,
      [
        eventId,
        overrides.email ?? `reg-${Math.random().toString(16).slice(2)}@test.invalid`,
        sessionAt,
        overrides.createdAt ?? new Date(),
      ]
    );
    return Number(res.rows[0].id);
  }

  async function addReminder(
    eventId: number,
    kind: "registration" | "before",
    offsetMinutes: number,
    createdAt?: Date
  ): Promise<number> {
    const res = await client.query<{ id: number }>(
      `INSERT INTO event_reminders (event_id, kind, offset_minutes, created_at)
       VALUES ($1, $2, $3, COALESCE($4, now()))
       RETURNING id`,
      [eventId, kind, offsetMinutes, createdAt ?? null]
    );
    return res.rows[0].id;
  }

  async function sends(): Promise<
    { reminder_id: number; status: string; detail: string; scheduled_for: Date; email_message_id: string | null }[]
  > {
    const res = await client.query(
      `SELECT reminder_id, status, detail, scheduled_for, email_message_id
         FROM event_reminder_sends ORDER BY scheduled_for, reminder_id`
    );
    return res.rows;
  }

  const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000);

  /* -------------------------------------------------------- configuration */

  it("gives a new event the default reminder set", async () => {
    const eventId = await makeEvent(hoursFromNow(72));
    await reminders.seedDefaultReminders(eventId);

    const list = await reminders.listReminders(eventId);
    expect(list.map((r) => r.label)).toEqual([
      "as soon as they sign up",
      "1 day before",
      "1 hour before",
      "when it starts",
    ]);
  });

  it("refuses a second reminder in the same slot", async () => {
    const eventId = await makeEvent(hoursFromNow(72));
    expect(await reminders.createReminder(eventId, { kind: "before", offsetMinutes: 120 })).not
      .toBeNull();
    // Null rather than a thrown constraint error: the route turns it into a
    // sentence about the event, and a duplicate reminder would mail twice.
    expect(await reminders.createReminder(eventId, { kind: "before", offsetMinutes: 120 })).toBeNull();
  });

  /* ------------------------------------------------------------- planning */

  it("plans a reminder in the future and skips one whose moment has gone", async () => {
    const eventId = await makeEvent(hoursFromNow(48));
    await register(eventId, hoursFromNow(48));

    const soon = await addReminder(eventId, "before", 60); // 47 hours away
    const gone = await addReminder(eventId, "before", 7 * 1440); // five days ago

    const planned = await reminders.materializeReminderSends();
    expect(planned).toEqual({ queued: 1, skipped: 1 });

    const rows = await sends();
    expect(rows.find((r) => r.reminder_id === soon)?.status).toBe("queued");
    const skipped = rows.find((r) => r.reminder_id === gone);
    expect(skipped?.status).toBe("skipped");
    expect(skipped?.detail).toBe("its moment had already passed when it was scheduled");
  });

  it("plans nothing twice, however many times it runs", async () => {
    const eventId = await makeEvent(hoursFromNow(48));
    await register(eventId, hoursFromNow(48));
    await addReminder(eventId, "before", 60);

    expect((await reminders.materializeReminderSends()).queued).toBe(1);
    expect((await reminders.materializeReminderSends()).queued).toBe(0);
    expect((await reminders.materializeReminderSends()).queued).toBe(0);
    expect(await sends()).toHaveLength(1);
  });

  it("plans nothing for a session that is already over", async () => {
    const eventId = await makeEvent(hoursFromNow(-5));
    await register(eventId, hoursFromNow(-5));
    await addReminder(eventId, "before", 60);
    await addReminder(eventId, "registration", 0);

    expect(await reminders.materializeReminderSends()).toEqual({ queued: 0, skipped: 0 });
    expect(await sends()).toHaveLength(0);
  });

  it("never sends a confirmation to somebody who registered before it was configured", async () => {
    /*
     * The backlog blast, defused structurally. This is the exact failure the
     * tester quoted from elsewhere in the platform — "'upon registration' would
     * have blasted the backlog" — and it is why migration 036 seeds the
     * confirmation as a default without mailing a single existing registrant:
     * every registration that predates the reminder row is invisible to the
     * planner.
     */
    const eventId = await makeEvent(hoursFromNow(240));
    const oldRegistration = await register(eventId, hoursFromNow(240), {
      createdAt: new Date(Date.now() - 30 * 86_400_000),
    });
    await addReminder(eventId, "registration", 0);
    const newRegistration = await register(eventId, hoursFromNow(240));

    await reminders.materializeReminderSends();

    const planned = await client.query<{ registration_id: string }>(
      `SELECT registration_id FROM event_reminder_sends`
    );
    expect(planned.rows.map((r) => Number(r.registration_id))).toEqual([newRegistration]);
    expect(planned.rows.map((r) => Number(r.registration_id))).not.toContain(oldRegistration);
  });

  it("gives a registrant who signs up again for a later session a fresh set", async () => {
    // The unique index is (reminder, registration, session), not (reminder,
    // registration): an evergreen registrant who missed one session and booked
    // another must be reminded about the new one.
    const eventId = await makeEvent(hoursFromNow(48));
    const registrationId = await register(eventId, hoursFromNow(48));
    await addReminder(eventId, "before", 60);

    expect((await reminders.materializeReminderSends()).queued).toBe(1);

    await client.query(`UPDATE event_registrations SET session_at = $2 WHERE id = $1`, [
      registrationId,
      hoursFromNow(96),
    ]);

    expect((await reminders.materializeReminderSends()).queued).toBe(1);
    expect(await sends()).toHaveLength(2);
  });

  /* -------------------------------------------------------------- sending */

  it("sends a due reminder once and records the delivery-log row", async () => {
    const eventId = await makeEvent(hoursFromNow(2));
    await register(eventId, hoursFromNow(2));
    await addReminder(eventId, "before", 1440); // due five hours ago… so:
    // Re-point it at something genuinely due-now rather than long past.
    await client.query(`UPDATE event_reminders SET offset_minutes = 150`);

    await reminders.materializeReminderSends();
    // 150 minutes before a session two hours away is thirty minutes ago: due,
    // and inside the lateness cap.
    const delivered = await reminders.deliverDueReminders();
    expect(delivered).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(sendEmailMock).toHaveBeenCalledTimes(1);

    const [row] = await sends();
    expect(row.status).toBe("sent");
    expect(row.email_message_id).not.toBeNull();

    // And again: nothing left to claim, so nothing is sent twice.
    expect(await reminders.deliverDueReminders()).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });

  it("records a refused send as failed, never as sent", async () => {
    /*
     * The honesty requirement. With the sending account on probation the
     * transport refuses everything, and a scheduler that stamped 'sent' the
     * moment it tried would report a hundred percent delivery of nothing.
     */
    sendEmailMock.mockRejectedValue(
      new Error("Email address is not verified. The following identities failed the check")
    );

    const eventId = await makeEvent(hoursFromNow(2));
    await register(eventId, hoursFromNow(2));
    await addReminder(eventId, "before", 150);

    await reminders.materializeReminderSends();
    expect(await reminders.deliverDueReminders()).toEqual({ sent: 0, failed: 1, skipped: 0 });

    const [row] = await sends();
    expect(row.status).toBe("failed");
    expect(row.detail).toContain("not verified");
    expect(row.email_message_id).toBeNull();
  });

  it("retries a failed reminder, then leaves it alone", async () => {
    sendEmailMock.mockRejectedValue(new Error("provider is down"));

    const eventId = await makeEvent(hoursFromNow(2));
    await register(eventId, hoursFromNow(2));
    await addReminder(eventId, "before", 150);
    await reminders.materializeReminderSends();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await reminders.deliverDueReminders();
    }
    // Three attempts, then the row sits on 'failed' with the provider's words
    // on it rather than being retried forever.
    expect(sendEmailMock).toHaveBeenCalledTimes(3);
    const attempts = await client.query<{ attempts: number; status: string }>(
      `SELECT attempts, status FROM event_reminder_sends`
    );
    expect(attempts.rows[0]).toMatchObject({ attempts: 3, status: "failed" });

    // The admin's retry button puts it back.
    const [reminderRow] = (await reminders.listReminders(eventId)).map((r) => r.id);
    expect(await reminders.retryFailedReminders(eventId, reminderRow)).toBe(1);
    expect(
      (await client.query<{ status: string }>(`SELECT status FROM event_reminder_sends`)).rows[0]
        .status
    ).toBe("queued");
  });

  it("does not mail an address on the suppression list", async () => {
    const eventId = await makeEvent(hoursFromNow(2));
    await register(eventId, hoursFromNow(2), { email: "bounced@test.invalid" });
    await client.query(
      `INSERT INTO email_suppressions (email, reason) VALUES ('bounced@test.invalid', 'bounce')`
    );
    await addReminder(eventId, "before", 150);

    await reminders.materializeReminderSends();
    expect(await reminders.deliverDueReminders()).toEqual({ sent: 0, failed: 0, skipped: 1 });
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect((await sends())[0].detail).toBe("this address is on the suppression list");
  });

  /* ------------------------------------------------------- backlog safety */

  it("retires a backlog rather than sending it when the scheduler comes back", async () => {
    /*
     * The scenario that matters most on a first deploy, and the one the tester
     * flagged: a queue full of reminders whose moment passed while nothing was
     * running. Every one of them is retired with a reason; the transport is
     * never called.
     *
     * Rows are written directly here because that is the state a restart finds —
     * the planner would never create them, which is itself the first line of
     * defence.
     */
    const eventId = await makeEvent(hoursFromNow(-30));
    const registrationId = await register(eventId, hoursFromNow(-30));
    const dayBefore = await addReminder(eventId, "before", 1440);
    const hourBefore = await addReminder(eventId, "before", 60);
    const atStart = await addReminder(eventId, "before", 0);

    for (const [reminderId, offset] of [
      [dayBefore, 1440],
      [hourBefore, 60],
      [atStart, 0],
    ] as const) {
      await client.query(
        `INSERT INTO event_reminder_sends
           (reminder_id, registration_id, event_id, session_at, scheduled_for, status)
         VALUES ($1, $2, $3, $4::timestamptz, $4::timestamptz - make_interval(mins => $5::int), 'queued')`,
        [reminderId, registrationId, eventId, hoursFromNow(-30), offset]
      );
    }

    expect(await reminders.sweepUnsendable()).toBe(3);
    expect(await reminders.deliverDueReminders()).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(sendEmailMock).not.toHaveBeenCalled();

    const rows = await sends();
    expect(rows.map((r) => r.status)).toEqual(["skipped", "skipped", "skipped"]);
    expect(rows.every((r) => r.detail === "the session was already over")).toBe(true);
  });

  it("skips a before-it-starts reminder for a session that has begun, and keeps the live one", async () => {
    // The session started ten minutes ago and runs for an hour. "An hour before"
    // is a lie now; "we're live, come on in" is still true.
    const sessionAt = new Date(Date.now() - 10 * 60_000);
    const eventId = await makeEvent(sessionAt);
    const registrationId = await register(eventId, sessionAt);
    const hourBefore = await addReminder(eventId, "before", 60);
    const atStart = await addReminder(eventId, "before", 0);

    for (const [reminderId, offset] of [
      [hourBefore, 60],
      [atStart, 0],
    ] as const) {
      await client.query(
        `INSERT INTO event_reminder_sends
           (reminder_id, registration_id, event_id, session_at, scheduled_for, status)
         VALUES ($1, $2, $3, $4::timestamptz, $4::timestamptz - make_interval(mins => $5::int), 'queued')`,
        [reminderId, registrationId, eventId, sessionAt, offset]
      );
    }

    expect(await reminders.sweepUnsendable()).toBe(1);
    expect(await reminders.deliverDueReminders()).toEqual({ sent: 1, failed: 0, skipped: 0 });

    const byReminder = new Map((await sends()).map((r) => [r.reminder_id, r]));
    expect(byReminder.get(hourBefore)?.status).toBe("skipped");
    expect(byReminder.get(hourBefore)?.detail).toBe("the session had already started");
    expect(byReminder.get(atStart)?.status).toBe("sent");
  });

  it("marks a reminder a dead worker left mid-send as failed rather than resending it", async () => {
    const sessionAt = hoursFromNow(2);
    const eventId = await makeEvent(sessionAt);
    const registrationId = await register(eventId, sessionAt);
    const reminderId = await addReminder(eventId, "before", 150);

    await client.query(
      `INSERT INTO event_reminder_sends
         (reminder_id, registration_id, event_id, session_at, scheduled_for, status,
          attempts, updated_at)
       VALUES ($1, $2, $3, $4, now() - interval '30 minutes', 'sending', 1,
               now() - interval '30 minutes')`,
      [reminderId, registrationId, eventId, sessionAt]
    );

    expect(await reminders.reclaimStuckSends()).toBe(1);
    // Failed with its attempts spent: the email may well have gone out before
    // the process died, and a duplicate reminder is worse than a visible failure.
    expect(await reminders.deliverDueReminders()).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect((await sends())[0].status).toBe("failed");
  });

  it("runs a whole tick in the safe order", async () => {
    // Two events: one finished yesterday with a queued backlog, one two hours
    // out with a reminder that has just come due. Exactly one email goes.
    const stale = await makeEvent(hoursFromNow(-30));
    const staleRegistration = await register(stale, hoursFromNow(-30));
    const staleReminder = await addReminder(stale, "before", 60);
    await client.query(
      `INSERT INTO event_reminder_sends
         (reminder_id, registration_id, event_id, session_at, scheduled_for, status)
       VALUES ($1, $2, $3, $4::timestamptz, $4::timestamptz - interval '60 minutes', 'queued')`,
      [staleReminder, staleRegistration, stale, hoursFromNow(-30)]
    );

    const live = await makeEvent(hoursFromNow(2));
    await register(live, hoursFromNow(2));
    await addReminder(live, "before", 150);

    const result = await reminders.runReminderTick();
    expect(result.retired).toBe(1);
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(0);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });

  /* ---------------------------------------------------------------- status */

  it("reports queued, sent and failed separately, and the delivery log beside them", async () => {
    const eventId = await makeEvent(hoursFromNow(2));
    await register(eventId, hoursFromNow(2), { email: "one@test.invalid" });
    await register(eventId, hoursFromNow(2), { email: "two@test.invalid" });
    const reminderId = await addReminder(eventId, "before", 150);
    await addReminder(eventId, "before", 30); // still ahead

    await reminders.materializeReminderSends();
    await reminders.deliverDueReminders();

    // The provider later says one arrived and one bounced.
    await client.query(`UPDATE email_messages SET status = 'delivered' WHERE to_email = $1`, [
      "one@test.invalid",
    ]);
    await client.query(`UPDATE email_messages SET status = 'bounced' WHERE to_email = $1`, [
      "two@test.invalid",
    ]);

    const stats = await reminders.reminderStats(eventId);
    const due = stats.find((s) => s.reminderId === reminderId);
    expect(due).toMatchObject({ sent: 2, failed: 0, skipped: 0, delivered: 1, bounced: 1 });

    const ahead = stats.find((s) => s.reminderId !== reminderId);
    expect(ahead?.queued).toBe(2);
    expect(ahead?.nextAt).not.toBeNull();
  });

  it("tells a registrant what is still coming", async () => {
    const eventId = await makeEvent(hoursFromNow(48));
    const registrationId = await register(eventId, hoursFromNow(48));
    await addReminder(eventId, "before", 1440);
    await addReminder(eventId, "before", 60);
    await reminders.materializeReminderSends();

    const plan = await reminders.remindersForRegistrations([registrationId]);
    expect(plan.get(registrationId)?.map((r) => r.label)).toEqual([
      "1 day before",
      "1 hour before",
    ]);
    expect(plan.get(registrationId)?.every((r) => r.status === "queued")).toBe(true);
  });

  /* ------------------------------------------------------------ migration */

  it("names the reminders the public page may promise, and nothing more", async () => {
    const eventId = await makeEvent(hoursFromNow(72));

    // No reminders configured: the page says nothing about them rather than
    // promising one, which is the bug this whole change is about.
    expect(await reminders.reminderPromise(eventId)).toEqual([]);

    await reminders.seedDefaultReminders(eventId);
    // The confirmation is not a "reminder before we start", so it is not in the
    // promise; the three before-the-session ones are, furthest out first.
    expect(await reminders.reminderPromise(eventId)).toEqual([
      "1 day before",
      "1 hour before",
      "when it starts",
    ]);

    // A reminder switched off is not promised either.
    const dayBefore = (await reminders.listReminders(eventId)).find(
      (r) => r.label === "1 day before"
    );
    await reminders.updateReminder(eventId, dayBefore!.id, { enabled: false });
    expect(await reminders.reminderPromise(eventId)).toEqual([
      "1 hour before",
      "when it starts",
    ]);
  });

  it("writes each step's own words, and fills in the tokens", () => {
    const sessionAt = new Date("2026-09-15T22:00:00.000Z");
    const ctx = {
      title: "Pricing without apology",
      sessionAt,
      timezone: "America/New_York",
      name: "Madhav Iyer",
      joinLink: "https://example.invalid/events/x/room?ticket=abc",
    };

    const confirmation = reminders.renderReminder(
      { kind: "registration", offsetMinutes: 0, subject: "", bodyMd: "" },
      ctx
    );
    expect(confirmation.subject).toBe("You're in: Pricing without apology");
    expect(confirmation.text).toContain("Hi Madhav,");
    // The session time is written in the event's zone, with the zone named —
    // 6:00 PM Eastern, not 10:00 PM UTC and not the server's idea of local.
    expect(confirmation.text).toContain("6:00 PM EDT");
    expect(confirmation.text).toContain(ctx.joinLink);

    const atStart = reminders.renderReminder(
      { kind: "before", offsetMinutes: 0, subject: "", bodyMd: "" },
      ctx
    );
    expect(atStart.subject).toBe("We're live: Pricing without apology");

    const dayBefore = reminders.renderReminder(
      { kind: "before", offsetMinutes: 1440, subject: "", bodyMd: "" },
      ctx
    );
    expect(dayBefore.subject).toBe("Tomorrow: Pricing without apology");

    // Custom copy wins, and gets the same tokens.
    const custom = reminders.renderReminder(
      {
        kind: "before",
        offsetMinutes: 60,
        subject: "{{eventTitle}} — {{whenRelative}}",
        bodyMd: "{{firstName}}, we start at {{sessionLabel}}. [Join]({{joinLink}})",
      },
      ctx
    );
    expect(custom.subject).toBe("Pricing without apology — 1 hour before");
    expect(custom.text).toBe(
      "Madhav, we start at Tuesday, September 15 at 6:00 PM EDT. " +
        `[Join](${ctx.joinLink})`
    );
    expect(custom.html).toContain(`<a href="${ctx.joinLink}">Join</a>`);
  });

  it("ticks every five minutes, as the migration set it to", async () => {
    // A quarter of an hour was the old cadence, and an "at the start" reminder
    // that can be fifteen minutes late is not a reminder about the start.
    const schedule = await client.query<{ every_minutes: number }>(
      `SELECT every_minutes FROM job_schedules WHERE name = 'event-reminders'`
    );
    expect(schedule.rows[0].every_minutes).toBe(5);
  });

  it("seeds the defaults onto events that already existed, and no send rows", async () => {
    /*
     * Migration 036 runs against a database with events and registrants already
     * in it — including, on the live site, one real registrant for a webinar
     * eleven days out. It must give that event its reminders without mailing
     * anybody, so the seeding statement is run here against exactly that shape.
     *
     * Its deliberate omission is `event_reminder_sends` rows: creating them in a
     * migration is the one way to make a deploy fire a backlog.
     */
    const fs = await import("fs");
    const path = await import("path");
    const migration = fs.readFileSync(
      path.join(__dirname, "..", "db", "migrations", "036_event_reminders.sql"),
      "utf8"
    );
    const seedStatement = migration.slice(
      migration.indexOf("INSERT INTO event_reminders"),
      migration.indexOf(";", migration.indexOf("INSERT INTO event_reminders")) + 1
    );
    expect(seedStatement).toContain("ON CONFLICT");

    const eventId = await makeEvent(hoursFromNow(11 * 24));
    await register(eventId, hoursFromNow(11 * 24), {
      createdAt: new Date(Date.now() - 3 * 86_400_000),
    });

    await client.query(seedStatement);

    const seeded = await client.query<{ kind: string; offset_minutes: number }>(
      `SELECT kind, offset_minutes FROM event_reminders
        ORDER BY (kind = 'registration') DESC, offset_minutes DESC`
    );
    expect(seeded.rows).toEqual([
      { kind: "registration", offset_minutes: 0 },
      { kind: "before", offset_minutes: 1440 },
      { kind: "before", offset_minutes: 60 },
      { kind: "before", offset_minutes: 0 },
    ]);

    // Nothing planned by the migration itself.
    expect(
      (await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM event_reminder_sends`))
        .rows[0].n
    ).toBe(0);

    // And the first tick after the deploy: the three before-reminders are all
    // still ahead, so they are queued; the confirmation is not planned at all,
    // because that registrant signed up before the reminder existed. Nothing is
    // sent, because nothing is due yet.
    const tick = await reminders.runReminderTick();
    expect(tick).toMatchObject({ planned: 3, plannedSkipped: 0, sent: 0, failed: 0 });
    expect(sendEmailMock).not.toHaveBeenCalled();

    // Running it a second time changes nothing at all.
    expect(await reminders.runReminderTick()).toMatchObject({ planned: 0, sent: 0 });
  });

  /* ------------------------------------------------------ repeating events */

  it("reminds a series registrant about each session in turn, and each only once", async () => {
    /*
     * A weekly series of three. The first session was three days ago and is the
     * one stored on the registration; the second is four days out. The
     * day-before reminder must follow the series — planned for the second
     * session now, the third once the second is over, and nothing after the
     * last — and never twice for the same session.
     */
    const { occurrencesFor } = await import("./events");
    const first = hoursFromNow(-72);
    const eventId = await makeEvent(first);
    await client.query(
      `UPDATE events SET recurrence_freq = 'weekly', recurrence_interval = 1, recurrence_count = 3
        WHERE id = $1`,
      [eventId]
    );
    await register(eventId, first, { createdAt: hoursFromNow(-24 * 10) });
    await addReminder(eventId, "before", 1440, hoursFromNow(-24 * 20));

    const sessions = occurrencesFor(first, "America/New_York", {
      freq: "weekly",
      interval: 1,
      until: null,
      count: 3,
    });
    const plannedSessions = async () =>
      (
        await client.query<{ session_at: Date; status: string }>(
          `SELECT session_at, status FROM event_reminder_sends ORDER BY session_at`
        )
      ).rows.map((row) => `${row.session_at.toISOString()} ${row.status}`);

    expect((await reminders.materializeReminderSends()).queued).toBe(1);
    expect(await plannedSessions()).toEqual([`${sessions[1].toISOString()} queued`]);

    // Planning again changes nothing.
    expect(await reminders.materializeReminderSends()).toEqual({ queued: 0, skipped: 0 });

    // Once the second session is over, the third is planned; the second is not
    // planned a second time.
    const afterSecond = new Date(sessions[1].getTime() + 2 * 3_600_000);
    expect((await reminders.materializeReminderSends(afterSecond)).queued).toBe(1);
    expect(await reminders.materializeReminderSends(afterSecond)).toEqual({ queued: 0, skipped: 0 });
    expect(await plannedSessions()).toEqual([
      `${sessions[1].toISOString()} queued`,
      `${sessions[2].toISOString()} queued`,
    ]);

    // After the last session there is nothing left to plan.
    const afterThird = new Date(sessions[2].getTime() + 2 * 3_600_000);
    expect(await reminders.materializeReminderSends(afterThird)).toEqual({ queued: 0, skipped: 0 });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("names only the reminders that are switched on, and the address, in the confirmation", async () => {
    /*
     * The confirmation used to say "I'll email you the day before and again an
     * hour before" whatever the editor said. With the day-before switched off it
     * must promise the hour-before alone — and an in-person event's
     * confirmation gives the address and the calendar file, not a room link.
     */
    const sessionAt = hoursFromNow(72);
    const eventId = await makeEvent(sessionAt);
    await client.query(
      `UPDATE events SET location_type = 'in_person', location_address = '12 Main St, Austin, TX'
        WHERE id = $1`,
      [eventId]
    );
    await addReminder(eventId, "registration", 0, hoursFromNow(-1));
    await addReminder(eventId, "before", 60, hoursFromNow(-1));
    const dayBefore = await addReminder(eventId, "before", 1440, hoursFromNow(-1));
    await client.query(`UPDATE event_reminders SET enabled = false WHERE id = $1`, [dayBefore]);
    await register(eventId, sessionAt);

    await reminders.materializeReminderSends();
    expect(await reminders.deliverDueReminders()).toEqual({ sent: 1, failed: 0, skipped: 0 });

    const { subject, text } = sendEmailMock.mock.calls[0][0] as { subject: string; text: string };
    expect(subject).toBe("You're in: A webinar");
    expect(text).toContain("I'll email you 1 hour before, so there is nothing to remember.");
    expect(text).not.toContain("1 day before");
    expect(text).toContain("It's in person, at **12 Main St, Austin, TX**.");
    expect(text).toContain("/api/events/registrations/");
    expect(text).not.toContain("/room?ticket=");
  });

  it("describes a series and every configured reminder in the confirmation", () => {
    const rendered = reminders.renderReminder(
      { kind: "registration", offsetMinutes: 0, subject: "", bodyMd: "" },
      {
        title: "Office hours",
        sessionAt: new Date("2026-09-15T22:00:00.000Z"),
        timezone: "America/New_York",
        name: "Madhav Iyer",
        joinLink: "https://example.invalid/events/x/room?ticket=abc",
        reminderLabels: ["1 day before", "1 hour before", "when it starts"],
        recurrenceLabel: "Every week, 6 sessions",
      }
    );
    expect(rendered.text).toContain("It repeats (every week, 6 sessions)");
    expect(rendered.text).toContain("the first one is **Tuesday, September 15 at 6:00 PM EDT**");
    expect(rendered.text).toContain(
      "I'll email you 1 day before, 1 hour before and when it starts, so there is nothing to remember."
    );
    // Online: the joining link, and the doors-open line.
    expect(rendered.text).toContain("room?ticket=abc");
    expect(rendered.text).toContain("The doors open 10 minutes early");
  });
});
