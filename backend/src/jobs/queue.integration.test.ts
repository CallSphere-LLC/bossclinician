import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { Client } from "pg";
import { createTestDatabase, hasTestDatabase } from "../testing/db";

/**
 * The queue against a real database.
 *
 * Everything interesting here is SQL: `FOR UPDATE SKIP LOCKED`, a partial unique
 * index for dedupe, and lease reclamation expressed as a WHERE clause. None of
 * it is observable against a mock, and all of it is the kind of thing that looks
 * right and is not — a claim query that quietly hands the same job to two
 * workers sends every email twice.
 */

const describeDb = hasTestDatabase ? describe : describe.skip;

describeDb("job queue (integration)", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let client: Client;
  let queue: typeof import("./queue");

  beforeAll(async () => {
    db = await createTestDatabase("jobq");
    client = db.client;
    process.env.DATABASE_URL = db.url;
    process.env.JWT_SECRET ??= "integration-test-secret";
    queue = await import("./queue");
  }, 60_000);

  afterAll(async () => {
    const { pool } = await import("../db/pool");
    await pool.end().catch(() => undefined);
    await db?.drop();
  });

  beforeEach(async () => {
    await client.query(`DELETE FROM jobs`);
  });

  it("enqueues and claims a job", async () => {
    const id = await queue.enqueue({ kind: "test.hello", payload: { a: 1 } });
    expect(id).not.toBeNull();

    const claimed = await queue.claim("worker-1", 5);
    expect(claimed).toHaveLength(1);
    expect(claimed[0].kind).toBe("test.hello");
    expect(claimed[0].payload).toEqual({ a: 1 });
    expect(claimed[0].attempts).toBe(1);
  });

  it("does not hand the same job to two workers", async () => {
    // The property the whole design rests on. Without SKIP LOCKED both workers
    // would see the row and every queued email would be sent twice.
    await queue.enqueue({ kind: "test.once" });

    const [a, b] = await Promise.all([queue.claim("worker-a", 5), queue.claim("worker-b", 5)]);
    expect(a.length + b.length).toBe(1);
  });

  it("leaves a job scheduled for the future alone", async () => {
    await queue.enqueue({ kind: "test.later", runAt: new Date(Date.now() + 60_000) });
    expect(await queue.claim("worker-1", 5)).toHaveLength(0);
  });

  it("claims higher priority first", async () => {
    await queue.enqueue({ kind: "bulk.mail", priority: queue.PRIORITY.bulk });
    await queue.enqueue({ kind: "reset.email", priority: queue.PRIORITY.transactional });

    const claimed = await queue.claim("worker-1", 1);
    expect(claimed[0].kind).toBe("reset.email");
  });

  it("collapses a duplicate dedupe key while the first is still live", async () => {
    const first = await queue.enqueue({ kind: "seq.send", dedupeKey: "seq:1:contact:9" });
    const second = await queue.enqueue({ kind: "seq.send", dedupeKey: "seq:1:contact:9" });

    expect(first).not.toBeNull();
    expect(second).toBeNull();

    const count = await client.query<{ n: string }>(`SELECT count(*) AS n FROM jobs`);
    expect(Number(count.rows[0].n)).toBe(1);
  });

  it("allows the same dedupe key again once the first has finished", async () => {
    // The partial index is on live states only, so tomorrow's send of the same
    // sequence email is not blocked by yesterday's.
    const first = await queue.enqueue({ kind: "seq.send", dedupeKey: "seq:daily" });
    await queue.succeed(first as string);

    const second = await queue.enqueue({ kind: "seq.send", dedupeKey: "seq:daily" });
    expect(second).not.toBeNull();
  });

  it("retries a failure with backoff, then gives up into the dead letter", async () => {
    const id = (await queue.enqueue({ kind: "test.flaky", maxAttempts: 2 })) as string;

    await queue.claim("worker-1", 5);
    const firstFailure = await queue.fail(id, new Error("upstream down"));
    expect(firstFailure.dead).toBe(false);

    let row = await client.query<{ status: string; run_at: Date; last_error: string }>(
      `SELECT status, run_at, last_error FROM jobs WHERE id = $1`,
      [id]
    );
    expect(row.rows[0].status).toBe("queued");
    expect(row.rows[0].last_error).toContain("upstream down");
    // Backed off, so it is not immediately re-claimable.
    expect(row.rows[0].run_at.getTime()).toBeGreaterThan(Date.now());

    await client.query(`UPDATE jobs SET run_at = now() WHERE id = $1`, [id]);
    await queue.claim("worker-1", 5);
    const secondFailure = await queue.fail(id, new Error("still down"));
    expect(secondFailure.dead).toBe(true);

    row = await client.query(`SELECT status, run_at, last_error FROM jobs WHERE id = $1`, [id]);
    expect(row.rows[0].status).toBe("dead");
  });

  it("stops a staging recipient-guard refusal at failed: no retries, no dead letter", async () => {
    const id = (await queue.enqueue({ kind: "sequence.sendEmail", maxAttempts: 5 })) as string;
    await queue.claim("worker-1", 5);

    // Wrapped the way a handler re-throws it, so the class name is lost.
    const wrapped = new Error("This email wasn't sent", {
      cause: new Error("email guard: refused send to zz@example.com (not allow-listed in staging)"),
    });
    const outcome = await queue.fail(id, wrapped);
    expect(outcome.dead).toBe(false);

    const row = await client.query<{ status: string; finished_at: Date | null }>(
      `SELECT status, finished_at FROM jobs WHERE id = $1`,
      [id]
    );
    expect(row.rows[0].status).toBe("failed");
    expect(row.rows[0].finished_at).not.toBeNull();
    expect(await queue.claim("worker-1", 5)).toHaveLength(0);

    // Still revivable once the address has been allow-listed.
    expect(await queue.revive(id)).toBe(true);
  });

  it("backs off further on each successive failure", async () => {
    // The curve has to come from the row's own attempt count. Computing it in
    // JS would mean guessing how many times the job had already run, and a
    // constant would retry against a downed provider once a minute forever.
    const id = (await queue.enqueue({ kind: "test.backoff", maxAttempts: 6 })) as string;

    const delays: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      await client.query(`UPDATE jobs SET run_at = now() WHERE id = $1`, [id]);
      await queue.claim("worker-1", 5);
      await queue.fail(id, new Error("still failing"));
      // Measured against updated_at, not now(): fail() sets both from the same
      // now() in one UPDATE, so the difference is exactly the delay it chose.
      // A now() read in this later statement is a few microseconds on, which
      // took 60 + 0 jitter (floor(random() * 60) = 0, about 1 run in 60) to
      // 59.9999 and failed the first bound for no reason — and CI runs this
      // before every deploy.
      const row = await client.query<{ secs: string }>(
        `SELECT EXTRACT(EPOCH FROM (run_at - updated_at))::text AS secs FROM jobs WHERE id = $1`,
        [id]
      );
      delays.push(Number(row.rows[0].secs));
    }

    // Each wait is longer than the last. Asserted as growth rather than exact
    // values because of the jitter deliberately added to each: the base doubles
    // from 60s and the jitter stays under 60s, so every wait still outgrows the
    // one before.
    for (let i = 1; i < delays.length; i += 1) {
      expect(delays[i]).toBeGreaterThan(delays[i - 1]);
    }
    expect(delays[0]).toBeGreaterThanOrEqual(60);
  });

  it("reclaims a job whose worker died", async () => {
    // A crashed worker leaves a `running` row nobody will ever finish. If the
    // lease did not lapse, that job would be stuck forever with no error and no
    // sign anything was wrong.
    const id = (await queue.enqueue({ kind: "test.orphan" })) as string;
    await queue.claim("dead-worker", 5);

    expect(await queue.claim("live-worker", 5)).toHaveLength(0);

    await client.query(`UPDATE jobs SET lease_expires_at = now() - interval '1 minute' WHERE id = $1`, [id]);

    const reclaimed = await queue.claim("live-worker", 5);
    expect(reclaimed).toHaveLength(1);
    expect(reclaimed[0].attempts).toBe(2);
  });

  it("keeps a renewed lease out of another worker's reach", async () => {
    const id = (await queue.enqueue({ kind: "test.slow" })) as string;
    await queue.claim("worker-1", 5);

    await client.query(`UPDATE jobs SET lease_expires_at = now() - interval '1 minute' WHERE id = $1`, [id]);
    await queue.renewLease(id, "worker-1");

    expect(await queue.claim("worker-2", 5)).toHaveLength(0);
  });

  it("inserts more rows than one statement's parameter budget allows", async () => {
    // 6 bind parameters per row against Postgres's ceiling of 65535 means a
    // single statement tops out at 10,922 rows. This is the chunking guard.
    const jobs = Array.from({ length: 2500 }, (_, i) => ({
      kind: "bulk.send",
      payload: { i },
    }));

    const inserted = await queue.enqueueMany(jobs);
    expect(inserted).toBe(2500);

    const count = await client.query<{ n: string }>(`SELECT count(*) AS n FROM jobs`);
    expect(Number(count.rows[0].n)).toBe(2500);
  });

  it("revives a dead job and reports queue health", async () => {
    const id = (await queue.enqueue({ kind: "test.dead", maxAttempts: 1 })) as string;
    await queue.claim("worker-1", 5);
    await queue.fail(id, new Error("boom"));

    let health = await queue.stats();
    expect(health.dead).toBe(1);

    expect(await queue.revive(id)).toBe(true);
    health = await queue.stats();
    expect(health.dead).toBe(0);
    expect(health.queued).toBe(1);
  });
});
