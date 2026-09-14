import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { Client } from "pg";
import type { AddressInfo } from "net";
import { createTestDatabase, hasTestDatabase } from "../../testing/db";

/**
 * Integration tests for the Marketing → Overview aggregation.
 *
 * Every figure on that page is a SQL definition — which statuses count as a
 * send, which runs count as "had problems", which enrolments count as "in a
 * sequence" — and each one has to agree with the list screen the tile links to.
 * The fixtures below put rows on both sides of every boundary (inside and
 * outside the thirty-day window, practice runs, archived sequences, draft and
 * past events) so a definition that drifts shows up as a wrong number here.
 *
 * Skipped when TEST_DATABASE_URL is unset, so `npm test` needs nothing running.
 */

const describeDb = hasTestDatabase ? describe : describe.skip;

describeDb("marketing overview (integration)", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let client: Client;
  let overview: typeof import("./marketingOverview");

  beforeAll(async () => {
    db = await createTestDatabase("mktoverview");
    client = db.client;
    process.env.DATABASE_URL = db.url;
    process.env.JWT_SECRET ??= "integration-test-secret";
    overview = await import("./marketingOverview");
  }, 90_000);

  afterAll(async () => {
    const { pool } = await import("../../db/pool");
    await pool.end().catch(() => undefined);
    await db?.drop();
  });

  beforeEach(async () => {
    await client.query(
      `TRUNCATE email_messages, email_campaigns, sequence_subscriptions, email_sequences,
                form_submissions, forms, automation_runs, automations,
                event_registrations, events, community_events, communities, contacts
        RESTART IDENTITY CASCADE`
    );
  });

  async function contact(email: string): Promise<number> {
    const res = await client.query<{ id: number }>(
      `INSERT INTO contacts (email) VALUES ($1) RETURNING id`,
      [email]
    );
    return res.rows[0].id;
  }

  type Overview = Awaited<ReturnType<typeof overview.readMarketingOverview>>;
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

  /**
   * Every headline on the page that has a breakdown must equal the sum of that
   * breakdown. The page once printed "Didn't send 9" over "6 from campaigns,
   * 5 from sequences, 0 from automations", which was the split of the 11 sent,
   * so this is asserted on every fixture below: a query that splits a figure
   * over a different window, status set or row set fails here by name.
   * Top-N lists only have to add up when every item is listed.
   */
  function expectBreakdownsAddUp(result: Overview) {
    const { emails, sequences, forms, automations, events } = result;
    expect(sum(Object.values(emails.bySource)), "emails.sent = sum(bySource)").toBe(emails.sent);
    expect(sum(Object.values(emails.notSentBySource)), "emails.notSent = sum(notSentBySource)").toBe(emails.notSent);
    expect(emails.broadcastUnlisted, "unlisted campaign emails within campaign emails").toBeLessThanOrEqual(
      emails.bySource.broadcast
    );
    expect(emails.opened, "opened within sent").toBeLessThanOrEqual(emails.sent);
    expect(emails.clicked, "clicked within sent").toBeLessThanOrEqual(emails.sent);
    expect(emails.notSentEmails, "distinct emails within attempts").toBeLessThanOrEqual(emails.notSent);
    expect(emails.notSentPeople, "people within distinct emails").toBeLessThanOrEqual(emails.notSentEmails);
    expect(emails.notSentLaterSent, "later-sent within distinct emails").toBeLessThanOrEqual(emails.notSentEmails);

    expect(sequences.people, "people within enrolments").toBeLessThanOrEqual(sequences.enrolled);
    if (sequences.top.length === sequences.active) {
      expect(sum(sequences.top.map((row) => row.enrolled)), "sequences.enrolled = sum(top)").toBe(sequences.enrolled);
    }

    if (forms.top.length === forms.formsWithReplies) {
      expect(sum(forms.top.map((row) => row.replies)), "forms.replies = sum(top)").toBe(forms.replies);
    }

    expect(automations.failedRuns, "failed within problem runs").toBeLessThanOrEqual(automations.problemRuns);
    expect(automations.problemRuns, "problem runs within runs").toBeLessThanOrEqual(automations.runs);
    expect(automations.withProblems, "automations with problems within those that ran").toBeLessThanOrEqual(
      automations.ran
    );
    if (automations.problemAutomations.length === automations.withProblems) {
      expect(
        sum(automations.problemAutomations.map((row) => row.problemRuns)),
        "automations.problemRuns = sum(problemAutomations)"
      ).toBe(automations.problemRuns);
    }

    expect(events.upcomingPublished + events.upcomingDrafts, "upcoming = published + drafts").toBe(events.upcoming);
    if (events.next.length === events.upcoming) {
      expect(sum(events.next.map((row) => row.registrations)), "events.registrations = sum(next)").toBe(
        events.registrations
      );
    }
  }

  it("reports zeros and null rates on an empty database", async () => {
    const result = await overview.readMarketingOverview();
    expectBreakdownsAddUp(result);
    expect(result.windowDays).toBe(30);
    expect(result.emails).toMatchObject({
      sent: 0,
      opened: 0,
      clicked: 0,
      openRate: null,
      clickRate: null,
      notSent: 0,
      trackingSeen: false,
    });
    expect(result.sequences).toMatchObject({ active: 0, enrolled: 0, people: 0, top: [] });
    expect(result.forms).toMatchObject({ replies: 0, formsWithReplies: 0, top: [] });
    expect(result.automations).toMatchObject({ ran: 0, runs: 0, problemRuns: 0, withProblems: 0 });
    expect(result.events).toMatchObject({ upcoming: 0, registrations: 0, next: [] });
  });

  it("counts marketing emails sent in the window, with open and click rates over sends", async () => {
    const campaignRows = await client.query<{ id: number }>(
      `INSERT INTO email_campaigns (name, status, sent_at) VALUES
         ('ZZ sent recently', 'sent', now() - interval '2 days'),
         ('ZZ sent long ago', 'sent', now() - interval '40 days')
       RETURNING id`
    );
    const recentCampaign = campaignRows.rows[0].id;
    await client.query(
      `INSERT INTO email_campaigns (name, status, scheduled_at) VALUES
         ('ZZ scheduled', 'scheduled', now() + interval '2 days'),
         ('ZZ draft', 'draft', NULL)`
    );
    // Four sends inside the window, from all three marketing sources. zz2's
    // campaign (id 9999) has since been deleted from the campaigns list.
    await client.query(
      `INSERT INTO email_messages (to_email, source_type, source_id, status, sent_at, first_opened_at, first_clicked_at) VALUES
         ('zz1@example.invalid', 'broadcast',  $1,   'delivered', now() - interval '1 day',  now(), now()),
         ('zz2@example.invalid', 'broadcast',  9999, 'sent',      now() - interval '2 days', now(), NULL),
         ('zz3@example.invalid', 'sequence',   1,    'bounced',   now() - interval '3 days', NULL,  NULL),
         ('zz4@example.invalid', 'automation', NULL, 'delivered', now() - interval '4 days', NULL,  NULL)`,
      [recentCampaign]
    );
    // Never left: counted as not sent, not in the rates.
    await client.query(
      `INSERT INTO email_messages (to_email, source_type, status, created_at) VALUES
         ('zz5@example.invalid', 'sequence',  'failed',     now() - interval '1 day'),
         ('zz6@example.invalid', 'broadcast', 'suppressed', now() - interval '1 day')`
    );
    // The live case behind this test: a sequence step that fails is retried on
    // the next tick and writes a new row each time. Three failed tries at one
    // email to zz10, then it went out. And zz11 got the email two days ago but
    // a later try failed, which is not "went out on a later try".
    await client.query(
      `INSERT INTO email_messages (to_email, source_type, source_id, subject, status, created_at, sent_at) VALUES
         ('zz10@example.invalid', 'sequence', 7, 'ZZ Welcome 1', 'failed',    now() - interval '3 hours',  NULL),
         ('zz10@example.invalid', 'sequence', 7, 'ZZ Welcome 1', 'failed',    now() - interval '2 hours',  NULL),
         ('zz10@example.invalid', 'sequence', 7, 'ZZ Welcome 1', 'failed',    now() - interval '1 hour',   NULL),
         ('ZZ10@example.invalid', 'sequence', 7, 'ZZ Welcome 1', 'delivered', now() - interval '30 minutes', now() - interval '30 minutes'),
         ('zz11@example.invalid', 'sequence', 7, 'ZZ Welcome 1', 'delivered', now() - interval '2 days',   now() - interval '2 days'),
         ('zz11@example.invalid', 'sequence', 7, 'ZZ Welcome 1', 'failed',    now() - interval '1 hour',   NULL)`
    );
    // Outside the window, or transactional: none of these count anywhere.
    await client.query(
      `INSERT INTO email_messages (to_email, source_type, status, sent_at, first_opened_at) VALUES
         ('zz7@example.invalid', 'broadcast',     'delivered', now() - interval '31 days', now()),
         ('zz8@example.invalid', 'transactional', 'delivered', now() - interval '1 day',   now()),
         ('zz12@example.invalid', 'sequence',     'failed',    now() - interval '31 days', NULL)`
    );
    // Still queued: neither sent nor not sent.
    await client.query(
      `INSERT INTO email_messages (to_email, source_type, status) VALUES
         ('zz9@example.invalid', 'broadcast', 'queued')`
    );

    const result = await overview.readMarketingOverview();
    expectBreakdownsAddUp(result);
    const { emails } = result;
    expect(emails.sent).toBe(6);
    expect(emails.bySource).toEqual({ broadcast: 2, sequence: 3, automation: 1 });
    expect(emails.broadcastUnlisted).toBe(1);
    expect(emails.opened).toBe(2);
    expect(emails.clicked).toBe(1);
    expect(emails.openRate).toBe(33.3);
    expect(emails.clickRate).toBe(16.7);
    expect(emails.notSent).toBe(6); // every attempt is a delivery-log row
    expect(emails.notSentBySource).toEqual({ broadcast: 1, sequence: 5, automation: 0 });
    expect(emails.notSentPeople).toBe(4); // zz5, zz6, zz10, zz11
    expect(emails.notSentEmails).toBe(4);
    expect(emails.notSentLaterSent).toBe(1); // zz10 only
    expect(emails.queued).toBe(1);
    expect(emails.campaignsSent).toBe(1);
    expect(emails.campaignsScheduled).toBe(1);
    expect(emails.trackingSeen).toBe(true);

    // Sent, not sent and queued partition the marketing rows in the window:
    // counted independently here, over the delivery log itself.
    const logged = await client.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM email_messages
        WHERE source_type IN ('broadcast', 'sequence', 'automation')
          AND COALESCE(sent_at, created_at) >= now() - interval '30 days'`
    );
    expect(emails.sent + emails.notSent + emails.queued).toBe(Number(logged.rows[0].count));
  });

  it("counts people in active sequences only, the way the Sequences list does", async () => {
    const [a, b, c] = await Promise.all([
      contact("zz-a@example.invalid"),
      contact("zz-b@example.invalid"),
      contact("zz-c@example.invalid"),
    ]);
    const seq = await client.query<{ id: number }>(
      `INSERT INTO email_sequences (name, slug, status) VALUES
         ('ZZ Welcome', 'zz-welcome', 'active'),
         ('ZZ Nurture', 'zz-nurture', 'active'),
         ('ZZ Paused',  'zz-paused',  'paused'),
         ('ZZ Old',     'zz-old',     'archived')
       RETURNING id`
    );
    const [welcome, nurture, paused] = seq.rows.map((row) => row.id);
    await client.query(
      `INSERT INTO sequence_subscriptions (sequence_id, contact_id, status) VALUES
         ($1, $4, 'active'), ($1, $5, 'active'), ($1, $6, 'completed'),
         ($2, $4, 'active'),
         ($3, $6, 'active')`,
      [welcome, nurture, paused, a, b, c]
    );

    const result = await overview.readMarketingOverview();
    expectBreakdownsAddUp(result);
    const { sequences } = result;
    expect(sequences.active).toBe(2);
    expect(sequences.total).toBe(3); // archived is not counted
    expect(sequences.enrolled).toBe(3); // a+b in Welcome, a in Nurture; paused sequence ignored
    expect(sequences.people).toBe(2); // a counted once
    expect(sequences.top[0]).toEqual({ id: welcome, name: "ZZ Welcome", enrolled: 2 });
    expect(sequences.top.map((row) => row.id)).toEqual([welcome, nurture]);
  });

  it("counts form replies in the last 30 days and the 30 before", async () => {
    const formRows = await client.query<{ id: number }>(
      `INSERT INTO forms (slug, name) VALUES ('zz-apply', 'ZZ Apply'), ('zz-quiet', 'ZZ Quiet')
       RETURNING id`
    );
    const [apply, quiet] = formRows.rows.map((row) => row.id);
    await client.query(
      `INSERT INTO form_submissions (form_id, email, created_at) VALUES
         ($1, 'zz1@example.invalid', now() - interval '1 day'),
         ($1, 'zz2@example.invalid', now() - interval '29 days'),
         ($2, 'zz3@example.invalid', now() - interval '5 days'),
         ($1, 'zz4@example.invalid', now() - interval '45 days'),
         ($2, 'zz5@example.invalid', now() - interval '90 days')`,
      [apply, quiet]
    );

    const result = await overview.readMarketingOverview();
    expectBreakdownsAddUp(result);
    const { forms } = result;
    expect(forms.replies).toBe(3);
    expect(forms.previousReplies).toBe(1);
    expect(forms.formsWithReplies).toBe(2);
    expect(forms.top).toEqual([
      { id: apply, name: "ZZ Apply", replies: 2 },
      { id: quiet, name: "ZZ Quiet", replies: 1 },
    ]);
  });

  it("counts automations that ran and the runs that had problems, ignoring practice runs", async () => {
    const autoRows = await client.query<{ id: number }>(
      `INSERT INTO automations (name, trigger_type, status) VALUES
         ('ZZ Tag buyers', 'order_paid', 'active'),
         ('ZZ Welcome',    'lead_created', 'active'),
         ('ZZ Paused',     'lead_created', 'paused')
       RETURNING id`
    );
    const [buyers, welcome, pausedAuto] = autoRows.rows.map((row) => row.id);
    await client.query(
      `INSERT INTO automation_runs (automation_id, status, log, is_test, created_at) VALUES
         ($1, 'success', '["Tag added"]',                      false, now() - interval '1 day'),
         ($1, 'partial', '["Tag added","Email failed"]',       false, now() - interval '2 days'),
         ($1, 'success', '["Sequence: blocked, no account"]',  false, now() - interval '3 days'),
         ($2, 'failed',  '["Offer no longer exists"]',         false, now() - interval '4 days'),
         ($2, 'success', '["Enrolled"]',                       false, now() - interval '5 days'),
         ($2, 'skipped', '["Only-if did not match"]',          false, now() - interval '5 days'),
         ($2, 'failed',  '["practice"]',                       true,  now() - interval '1 day'),
         ($3, 'failed',  '["too old"]',                        false, now() - interval '60 days')`,
      [buyers, welcome, pausedAuto]
    );

    const result = await overview.readMarketingOverview();
    expectBreakdownsAddUp(result);
    const { automations } = result;
    expect(automations.active).toBe(2);
    expect(automations.ran).toBe(2);
    expect(automations.runs).toBe(5); // skipped, practice and out-of-window runs excluded
    expect(automations.problemRuns).toBe(3); // partial + blocked success + failed
    expect(automations.failedRuns).toBe(1);
    expect(automations.withProblems).toBe(2);
    expect(automations.skippedRuns).toBe(1);
    expect(automations.problemAutomations).toEqual([
      { id: buyers, name: "ZZ Tag buyers", problemRuns: 2 },
      { id: welcome, name: "ZZ Welcome", problemRuns: 1 },
    ]);
  });

  it("lists upcoming live events soonest first, with drafts flagged", async () => {
    const eventRows = await client.query<{ id: number }>(
      `INSERT INTO events (slug, title, kind, starts_at, published) VALUES
         ('zz-later',  'ZZ Later',  'live', now() + interval '10 days', true),
         ('zz-soon',   'ZZ Soon',   'live', now() + interval '1 day',   false),
         ('zz-past',   'ZZ Past',   'live', now() - interval '1 day',   true)
       RETURNING id`
    );
    const [later, soon, past] = eventRows.rows.map((row) => row.id);
    const evergreenRows = await client.query<{ id: number }>(
      `INSERT INTO events (slug, title, kind, evergreen_interval_minutes, published) VALUES
         ('zz-evergreen', 'ZZ Evergreen', 'evergreen', 60, true)
       RETURNING id`
    );
    const evergreen = evergreenRows.rows[0].id;
    // zz5 registered for ZZ Later before it was moved, so their session_at is
    // the old, past date: still a registration for an upcoming event, and the
    // Events list counts it. The two always-on registrations have sessions
    // ahead but belong to no upcoming live event. Counting by session_at (the
    // old definition) gives 2 + 1 + 2 = 5 against rows that add up to 4.
    await client.query(
      `INSERT INTO event_registrations (event_id, email, session_at) VALUES
         ($1, 'zz1@example.invalid', now() + interval '10 days'),
         ($1, 'zz2@example.invalid', now() + interval '10 days'),
         ($1, 'zz5@example.invalid', now() - interval '6 days'),
         ($2, 'zz3@example.invalid', now() + interval '1 day'),
         ($3, 'zz4@example.invalid', now() - interval '1 day'),
         ($4, 'zz6@example.invalid', now() + interval '2 hours'),
         ($4, 'zz7@example.invalid', now() + interval '3 hours')`,
      [later, soon, past, evergreen]
    );
    const community = await client.query<{ id: number }>(
      `INSERT INTO communities (slug, name) VALUES ('zz-community', 'ZZ Community') RETURNING id`
    );
    await client.query(
      `INSERT INTO community_events (community_id, title, starts_at, published) VALUES
         ($1, 'ZZ Office hours', now() + interval '3 days', true),
         ($1, 'ZZ Hidden',       now() + interval '3 days', false),
         ($1, 'ZZ Done',         now() - interval '3 days', true)`,
      [community.rows[0].id]
    );

    const result = await overview.readMarketingOverview();
    expectBreakdownsAddUp(result);
    const { events } = result;
    expect(events.upcoming).toBe(2);
    expect(events.upcomingPublished).toBe(1);
    expect(events.upcomingDrafts).toBe(1);
    expect(events.alwaysOn).toBe(1);
    expect(events.registrations).toBe(4);
    expect(events.communityUpcoming).toBe(1);
    expect(events.next.map((row) => [row.id, row.published, row.registrations])).toEqual([
      [soon, false, 1],
      [later, true, 3],
    ]);
  });

  it("serves the same figures over HTTP as JSON", async () => {
    const express = (await import("express")).default;
    const app = express();
    app.use("/marketing-overview", overview.adminMarketingOverviewRouter);
    const server = app.listen(0);
    try {
      const { port } = server.address() as AddressInfo;
      const res = await fetch(`http://127.0.0.1:${port}/marketing-overview`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { windowDays: number; emails: { sent: number } };
      expect(body.windowDays).toBe(30);
      expect(body.emails.sent).toBe(0);
    } finally {
      server.close();
    }
  });

  it("percentOf rounds to one decimal and refuses to divide by zero", () => {
    expect(overview.percentOf(1, 3)).toBe(33.3);
    expect(overview.percentOf(0, 0)).toBeNull();
  });
});
