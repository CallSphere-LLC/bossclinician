import { pool } from "../db/pool";
import {
  LEASE_SECONDS,
  claim,
  enqueue,
  fail,
  renewLease,
  succeed,
  workerId,
  type JobRow,
} from "./queue";

/**
 * The worker loop and the handler registry.
 *
 * Runs in the API process rather than as a separate container. That is a
 * deliberate choice for this deployment: one service to build, deploy and watch,
 * and the work is IO-bound (sending mail, calling Stripe) rather than CPU-bound,
 * so it does not compete with request handling for the thing requests actually
 * need. `WORKER_ENABLED=false` turns it off if that ever stops being true and
 * the loop needs its own container — the code does not change, only where it
 * runs.
 */

export type JobHandler = (payload: Record<string, unknown>, job: JobRow) => Promise<unknown>;

const handlers = new Map<string, JobHandler>();

/**
 * Registers a handler for a job kind.
 *
 * A kind with no handler is not silently dropped — it fails and eventually
 * lands in the dead-letter list, because "the deploy renamed a handler and
 * nobody noticed the emails stopped" is the failure this queue exists to make
 * visible.
 */
export function registerHandler(kind: string, handler: JobHandler): void {
  if (handlers.has(kind)) {
    throw new Error(`A handler for job kind "${kind}" is already registered`);
  }
  handlers.set(kind, handler);
}

export function registeredKinds(): string[] {
  return [...handlers.keys()].sort();
}

const POLL_INTERVAL_MS = 2000;
const BATCH_SIZE = 5;
/** Renewed at a third of the lease, so two renewals may be missed before it lapses. */
const RENEW_INTERVAL_MS = (LEASE_SECONDS / 3) * 1000;

let running = false;
let stopping = false;

async function runOne(job: JobRow, id: string): Promise<void> {
  const handler = handlers.get(job.kind);
  if (!handler) {
    await fail(job.id, new Error(`No handler registered for job kind "${job.kind}"`));
    return;
  }

  // A long job keeps its lease alive while it works; without this a
  // ten-minute broadcast fan-out would be reclaimed and run twice.
  const renew = setInterval(() => {
    void renewLease(job.id, id).catch(() => undefined);
  }, RENEW_INTERVAL_MS);

  try {
    const result = await handler(job.payload, job);
    await succeed(job.id, result);
  } catch (err) {
    const { dead } = await fail(job.id, err);
    const detail = err instanceof Error ? err.message : String(err);
    console.error(
      `[jobs] ${job.kind} #${job.id} ${dead ? "DEAD after" : "failed on"} attempt ${job.attempts}: ${detail}`
    );
  } finally {
    clearInterval(renew);
  }
}

/**
 * Promotes any due schedules into ordinary jobs.
 *
 * The dedupe key is the schedule plus its due minute, so two workers ticking at
 * the same second produce one job rather than two — the unique index decides,
 * not a lock.
 */
async function promoteSchedules(): Promise<void> {
  const due = await pool.query<{
    id: number;
    name: string;
    kind: string;
    payload: Record<string, unknown>;
    every_minutes: number | null;
    daily_at_minute: number | null;
    timezone: string;
  }>(
    `SELECT id, name, kind, payload, every_minutes, daily_at_minute, timezone
       FROM job_schedules
      WHERE enabled AND (next_run_at IS NULL OR next_run_at <= now())`
  );

  for (const schedule of due.rows) {
    const now = new Date();
    const slot = Math.floor(now.getTime() / 60000);

    await enqueue({
      kind: schedule.kind,
      payload: { ...schedule.payload, scheduleName: schedule.name },
      dedupeKey: `schedule:${schedule.name}:${slot}`,
    });

    const next = schedule.every_minutes
      ? new Date(now.getTime() + schedule.every_minutes * 60_000)
      : nextDailyRun(now, schedule.daily_at_minute ?? 0, schedule.timezone);

    await pool.query(
      `UPDATE job_schedules SET last_run_at = now(), next_run_at = $2, updated_at = now()
        WHERE id = $1`,
      [schedule.id, next]
    );
  }
}

/**
 * The next occurrence of a daily time in a named zone.
 *
 * Reuses the timezone maths already proven by the drip engine rather than
 * adding a second implementation — a daily digest firing an hour out for half
 * the year is the same DST bug, in a different costume.
 */
function nextDailyRun(from: Date, minuteOfDay: number, timeZone: string): Date {
  // Imported lazily to keep the queue free of a dependency on delivery code.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { zonedWallClockToUtc } = require("../services/drip") as typeof import("../services/drip");

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(from);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);

  const todayAt = zonedWallClockToUtc(get("year"), get("month"), get("day"), minuteOfDay, timeZone);
  if (todayAt.getTime() > from.getTime()) return todayAt;

  const tomorrow = new Date(Date.UTC(get("year"), get("month") - 1, get("day") + 1, 12));
  return zonedWallClockToUtc(
    tomorrow.getUTCFullYear(),
    tomorrow.getUTCMonth() + 1,
    tomorrow.getUTCDate(),
    minuteOfDay,
    timeZone
  );
}

/** Starts the loop. Idempotent — a second call is a no-op. */
export function startWorker(): void {
  if (running) return;
  running = true;
  stopping = false;

  const id = workerId();
  console.log(`[jobs] worker ${id} started with ${handlers.size} handlers`);

  const tick = async (): Promise<void> => {
    if (stopping) return;
    try {
      await promoteSchedules();
      const jobs = await claim(id, BATCH_SIZE);
      // Concurrently: these are IO-bound, and running a batch of five emails
      // one after another turns a 200ms send into a second of wall clock.
      await Promise.all(jobs.map((job) => runOne(job, id)));
    } catch (err) {
      console.error("[jobs] tick failed:", err instanceof Error ? err.message : err);
    } finally {
      if (!stopping) setTimeout(() => void tick(), POLL_INTERVAL_MS);
    }
  };

  void tick();
}

/**
 * Stops claiming new work.
 *
 * In-flight jobs are left to finish; their leases lapse and another worker
 * reclaims them if the process dies first, which is exactly the behaviour the
 * lease exists for.
 */
export function stopWorker(): void {
  stopping = true;
  running = false;
}
