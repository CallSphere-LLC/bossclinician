import crypto from "crypto";
import { pool } from "../db/pool";

/**
 * The job queue.
 *
 * Backed by Postgres and `FOR UPDATE SKIP LOCKED`, which gives a correct
 * multi-consumer queue without a second piece of infrastructure to run, secure
 * and back up. At this platform's volume — a few thousand emails on a launch
 * day — that trade is comfortably right.
 *
 * A worker holds a *lease*, not a lock: it stamps `lease_expires_at` and renews
 * it while working. If the process dies, the lease lapses and another worker
 * reclaims the job. A held database lock would instead be released the instant
 * the connection dropped, which sounds equivalent but is not — the job would be
 * picked up again immediately, while the original may still be running.
 */

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "dead" | "cancelled";

export interface EnqueueInput {
  kind: string;
  payload?: Record<string, unknown>;
  /** Higher runs first. Transactional mail is 10; bulk sending is -10. */
  priority?: number;
  runAt?: Date;
  maxAttempts?: number;
  /**
   * Collapses duplicate requests for the same work. Unique across queued and
   * running jobs only, so the same key can be enqueued again once the earlier
   * one has finished.
   */
  dedupeKey?: string;
  /** Runs inside a caller's transaction, so enqueueing is atomic with the write that caused it. */
  client?: { query: typeof pool.query };
}

export interface JobRow {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
}

/** Priorities that keep a customer's password reset ahead of a marketing blast. */
export const PRIORITY = {
  transactional: 10,
  normal: 0,
  bulk: -10,
} as const;

/**
 * Adds a job.
 *
 * Returns null when `dedupeKey` matched something already queued or running —
 * a successful outcome, not a failure: the work is already going to happen.
 */
export async function enqueue(input: EnqueueInput): Promise<string | null> {
  const db = input.client ?? pool;
  const res = await db.query<{ id: string }>(
    `INSERT INTO jobs (kind, payload, priority, run_at, max_attempts, dedupe_key)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('queued','running')
       DO NOTHING
     RETURNING id`,
    [
      input.kind,
      JSON.stringify(input.payload ?? {}),
      input.priority ?? PRIORITY.normal,
      input.runAt ?? new Date(),
      input.maxAttempts ?? 5,
      input.dedupeKey ?? null,
    ]
  );
  return res.rows[0]?.id ?? null;
}

/**
 * Rows per INSERT.
 *
 * Six bind parameters each, against Postgres's hard ceiling of 65535 per
 * statement — so the real limit is 10,922 rows and a 20,000-recipient broadcast
 * in one statement would fail outright, not merely run slowly. 1,000 keeps a
 * comfortable margin and caps the peak memory of a single query, which matters
 * on a 8GB box shared with several other applications.
 */
const INSERT_CHUNK = 1000;

/** Enqueues many jobs — a broadcast fans out thousands. */
export async function enqueueMany(
  jobs: EnqueueInput[],
  client?: { query: typeof pool.query }
): Promise<number> {
  if (jobs.length === 0) return 0;
  const db = client ?? pool;

  let inserted = 0;

  // Multi-row INSERTs rather than N round trips: a 5,000-recipient broadcast is
  // otherwise 5,000 sequential statements, which takes minutes and holds a
  // connection for all of it. Chunked rather than one giant statement, for the
  // parameter ceiling above.
  for (let start = 0; start < jobs.length; start += INSERT_CHUNK) {
    const chunk = jobs.slice(start, start + INSERT_CHUNK);
    const values: unknown[] = [];
    const tuples = chunk.map((job, i) => {
      const base = i * 6;
      values.push(
        job.kind,
        JSON.stringify(job.payload ?? {}),
        job.priority ?? PRIORITY.normal,
        job.runAt ?? new Date(),
        job.maxAttempts ?? 5,
        job.dedupeKey ?? null
      );
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`;
    });

    const res = await db.query(
      `INSERT INTO jobs (kind, payload, priority, run_at, max_attempts, dedupe_key)
       VALUES ${tuples.join(", ")}
       ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('queued','running')
         DO NOTHING`,
      values
    );
    inserted += res.rowCount ?? 0;
  }

  return inserted;
}

export const LEASE_SECONDS = 300;

/**
 * Claims up to `limit` ready jobs for this worker.
 *
 * `SKIP LOCKED` is what makes several workers safe: each skips rows another has
 * already locked in its own transaction rather than queueing behind them, so
 * throughput scales with workers instead of serialising on the head of the
 * queue.
 *
 * The `status = 'running'` arm of the WHERE is lease reclamation — a job whose
 * worker died leaves a `running` row with an expired lease, and it must come
 * back rather than sit there forever.
 */
export async function claim(workerId: string, limit = 5): Promise<JobRow[]> {
  const res = await pool.query<{
    id: string;
    kind: string;
    payload: Record<string, unknown>;
    attempts: number;
    max_attempts: number;
  }>(
    `WITH ready AS (
       SELECT id FROM jobs
        WHERE (
                (status = 'queued' AND run_at <= now())
             OR (status = 'running' AND lease_expires_at < now())
              )
        ORDER BY priority DESC, run_at, id
        LIMIT $2
        FOR UPDATE SKIP LOCKED
     )
     UPDATE jobs j
        SET status           = 'running',
            attempts         = j.attempts + 1,
            locked_by        = $1,
            locked_at        = now(),
            lease_expires_at = now() + make_interval(secs => $3),
            started_at       = COALESCE(j.started_at, now()),
            updated_at       = now()
       FROM ready
      WHERE j.id = ready.id
      RETURNING j.id, j.kind, j.payload, j.attempts, j.max_attempts`,
    [workerId, limit, LEASE_SECONDS]
  );

  return res.rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    payload: r.payload ?? {},
    attempts: r.attempts,
    maxAttempts: r.max_attempts,
  }));
}

/** Extends the lease on a job still being worked, so a slow one is not reclaimed under it. */
export async function renewLease(jobId: string, workerId: string): Promise<void> {
  await pool.query(
    `UPDATE jobs
        SET lease_expires_at = now() + make_interval(secs => $3), updated_at = now()
      WHERE id = $1 AND locked_by = $2 AND status = 'running'`,
    [jobId, workerId, LEASE_SECONDS]
  );
}

export async function succeed(jobId: string, result?: unknown): Promise<void> {
  await pool.query(
    `UPDATE jobs
        SET status = 'succeeded', result = $2, finished_at = now(),
            locked_by = NULL, lease_expires_at = NULL, last_error = '', updated_at = now()
      WHERE id = $1`,
    [jobId, result === undefined ? null : JSON.stringify(result)]
  );
}

/**
 * Exponential backoff with jitter: 1m, 2m, 4m, 8m, 16m, capped at an hour.
 *
 * The jitter matters more than the curve. Five hundred emails failing together
 * because a provider is down would otherwise all retry at the same instant and
 * knock it over again the moment it recovers.
 */
export function backoffSeconds(attempts: number): number {
  const base = Math.min(60 * 2 ** Math.max(0, attempts - 1), 3600);
  const jitter = Math.floor(Math.random() * Math.min(base, 60));
  return base + jitter;
}

/**
 * Records a failure and either schedules a retry or gives up.
 *
 * A job that has exhausted its attempts becomes `dead` rather than being
 * deleted: the dead-letter list is the only place anyone will find out that an
 * email never went, and a queue that silently drops work is worse than one that
 * visibly stalls.
 */
export async function fail(jobId: string, error: unknown): Promise<{ dead: boolean }> {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 2000);

  // The delay is computed in SQL from the row's own attempt count. Passing a
  // number from here would have to guess it — the caller does not know how many
  // times this job has already run — and a constant would flatten the curve to
  // a fixed retry, which is the failure mode this backs off to avoid: a job
  // failing against a downed provider would hammer it once a minute forever.
  const res = await pool.query<{ status: string }>(
    `UPDATE jobs
        SET last_error = $2,
            status     = CASE WHEN attempts >= max_attempts THEN 'dead' ELSE 'queued' END,
            run_at     = CASE
                           WHEN attempts >= max_attempts THEN run_at
                           ELSE now() + make_interval(secs =>
                                  LEAST(3600, 60 * power(2, GREATEST(attempts - 1, 0)))
                                  -- Jitter, so a batch that failed together does
                                  -- not retry in lockstep and knock the provider
                                  -- over again the moment it recovers.
                                  + floor(random() * 60)
                                )
                         END,
            finished_at = CASE WHEN attempts >= max_attempts THEN now() ELSE NULL END,
            locked_by = NULL, locked_at = NULL, lease_expires_at = NULL,
            updated_at = now()
      WHERE id = $1
      RETURNING status`,
    [jobId, message]
  );

  return { dead: res.rows[0]?.status === "dead" };
}

/** Puts a dead job back on the queue — the "retry" button on the dead-letter view. */
export async function revive(jobId: string): Promise<boolean> {
  const res = await pool.query(
    `UPDATE jobs
        SET status = 'queued', attempts = 0, run_at = now(),
            finished_at = NULL, last_error = '', updated_at = now()
      WHERE id = $1 AND status IN ('dead', 'failed', 'cancelled')`,
    [jobId]
  );
  return (res.rowCount ?? 0) > 0;
}

export async function cancel(jobId: string): Promise<boolean> {
  const res = await pool.query(
    `UPDATE jobs SET status = 'cancelled', finished_at = now(), updated_at = now()
      WHERE id = $1 AND status IN ('queued', 'failed')`,
    [jobId]
  );
  return (res.rowCount ?? 0) > 0;
}

export interface QueueStats {
  queued: number;
  running: number;
  dead: number;
  succeededLastHour: number;
  oldestQueuedSeconds: number | null;
}

/** Powers the admin's queue health panel and the deploy smoke test. */
export async function stats(): Promise<QueueStats> {
  const res = await pool.query<{
    queued: string;
    running: string;
    dead: string;
    succeeded_last_hour: string;
    oldest_queued_seconds: string | null;
  }>(
    `SELECT
       count(*) FILTER (WHERE status = 'queued')  AS queued,
       count(*) FILTER (WHERE status = 'running') AS running,
       count(*) FILTER (WHERE status = 'dead')    AS dead,
       count(*) FILTER (WHERE status = 'succeeded'
                          AND finished_at > now() - interval '1 hour') AS succeeded_last_hour,
       -- FILTER belongs to the aggregate, not to the expression wrapping it.
       -- Attaching it to the EXTRACT is a syntax error, because EXTRACT is not
       -- an aggregate function.
       EXTRACT(EPOCH FROM (
         now() - min(run_at) FILTER (WHERE status = 'queued' AND run_at <= now())
       ))                                                              AS oldest_queued_seconds
     FROM jobs`
  );

  const row = res.rows[0];
  return {
    queued: Number(row?.queued ?? 0),
    running: Number(row?.running ?? 0),
    dead: Number(row?.dead ?? 0),
    succeededLastHour: Number(row?.succeeded_last_hour ?? 0),
    oldestQueuedSeconds:
      row?.oldest_queued_seconds === null || row?.oldest_queued_seconds === undefined
        ? null
        : Math.round(Number(row.oldest_queued_seconds)),
  };
}

/** A stable-ish id for this process, so a lease can be attributed to a worker. */
export function workerId(): string {
  return `${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
}
