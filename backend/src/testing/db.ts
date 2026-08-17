import fs from "fs";
import path from "path";
import { Client } from "pg";

/**
 * Throwaway-database harness for integration tests.
 *
 * The unit suites cover the pure modules — pricing, drip, token handling — but
 * the two most dangerous files in the project are not pure: `services/access.ts`
 * decides who may open paid content, and `services/fulfillment.ts` decides who
 * has paid. Both are almost entirely SQL, so testing them without a database
 * tests nothing that matters. An `ON CONFLICT` clause that silently updates the
 * wrong column cannot be caught by a mock.
 *
 * Opt-in by design: these tests need a running Postgres and are skipped when
 * `TEST_DATABASE_URL` is absent, so `npm test` stays fast and works on a laptop
 * with nothing running. See README-TESTING.md for how to point it at one.
 */

const MIGRATIONS_DIR = path.join(__dirname, "..", "db", "migrations");
const SCHEMA_PATH = path.join(__dirname, "..", "db", "schema.sql");

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "";
export const hasTestDatabase = TEST_DATABASE_URL.length > 0;

function adminUrl(dbName: string): string {
  const url = new URL(TEST_DATABASE_URL);
  url.pathname = `/${dbName}`;
  return url.toString();
}

/**
 * Builds a database from the baseline plus every migration, in the same order
 * the server applies them.
 *
 * Deliberately not a dump of the current schema: running the real migrations is
 * what proves they still work, which is the other half of what this harness is
 * for.
 */
export async function createTestDatabase(label: string): Promise<{
  url: string;
  client: Client;
  drop: () => Promise<void>;
}> {
  if (!hasTestDatabase) {
    throw new Error("TEST_DATABASE_URL is not set");
  }

  // Postgres identifiers cannot be bind parameters, so the name is built from a
  // fixed prefix plus a strictly-filtered label rather than interpolated freely.
  const safeLabel = label.replace(/[^a-z0-9_]/gi, "").slice(0, 24).toLowerCase();
  const dbName = `bctest_${safeLabel}_${process.pid}`;

  const admin = new Client({ connectionString: adminUrl("postgres") });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();

  const client = new Client({ connectionString: adminUrl(dbName) });
  await client.connect();

  await client.query(fs.readFileSync(SCHEMA_PATH, "utf8"));

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    await client.query(fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }

  return {
    url: adminUrl(dbName),
    client,
    drop: async () => {
      await client.end().catch(() => undefined);
      const cleanup = new Client({ connectionString: adminUrl("postgres") });
      await cleanup.connect();
      // Terminate stragglers first: DROP DATABASE fails while any connection
      // remains, and a failed cleanup leaves a database behind on every run.
      await cleanup.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1`,
        [dbName]
      );
      await cleanup.query(`DROP DATABASE IF EXISTS ${dbName}`);
      await cleanup.end();
    },
  };
}

/** A member row, for tests that need somebody to own something. */
export async function insertMember(
  client: Client,
  email: string,
  overrides: { status?: string; name?: string } = {}
): Promise<number> {
  const res = await client.query<{ id: number }>(
    `INSERT INTO members (email, name, status) VALUES ($1, $2, $3) RETURNING id`,
    [email, overrides.name ?? "Test Member", overrides.status ?? "active"]
  );
  return res.rows[0].id;
}

/** A course-backed product, which is what most access checks are about. */
export async function insertCourseProduct(
  client: Client,
  slug: string
): Promise<{ courseId: number; productId: number }> {
  const course = await client.query<{ id: number }>(
    `INSERT INTO courses (slug, title, published) VALUES ($1, $2, true) RETURNING id`,
    [slug, `Course ${slug}`]
  );
  const courseId = course.rows[0].id;

  const product = await client.query<{ id: number }>(
    `INSERT INTO products (slug, title, kind, course_id, status)
     VALUES ($1, $2, 'course', $3, 'published') RETURNING id`,
    [`p-${slug}`, `Product ${slug}`, courseId]
  );

  return { courseId, productId: product.rows[0].id };
}

export async function insertOffer(
  client: Client,
  slug: string,
  productIds: number[],
  overrides: { accessExpiresAfterDays?: number | null; amountCents?: number } = {}
): Promise<number> {
  const offer = await client.query<{ id: number }>(
    `INSERT INTO offers (title, slug, status, pricing_type, amount_cents, access_expires_after_days)
     VALUES ($1, $2, 'published', 'one_time', $3, $4) RETURNING id`,
    [
      `Offer ${slug}`,
      slug,
      overrides.amountCents ?? 2700,
      overrides.accessExpiresAfterDays ?? null,
    ]
  );
  const offerId = offer.rows[0].id;

  for (const [index, productId] of productIds.entries()) {
    await client.query(
      `INSERT INTO offer_products (offer_id, product_id, sort) VALUES ($1, $2, $3)`,
      [offerId, productId, index]
    );
  }

  return offerId;
}

export async function insertOrder(
  client: Client,
  input: { offerId: number; email: string; totalCents: number; memberId?: number | null }
): Promise<number> {
  const res = await client.query<{ id: number }>(
    `INSERT INTO orders (offer_id, member_id, email, status, total_cents, amount_cents,
                         subtotal_cents, currency, stripe_session_id)
     VALUES ($1, $2, $3, 'pending', $4, $4, $4, 'usd', $5)
     RETURNING id`,
    [
      input.offerId,
      input.memberId ?? null,
      input.email,
      input.totalCents,
      `cs_test_${Math.abs(input.totalCents)}_${input.email}`,
    ]
  );
  return res.rows[0].id;
}
