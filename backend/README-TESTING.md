# Backend tests

```bash
cd backend
npm test           # vitest run — one pass, what CI runs
npm run test:watch # vitest — re-runs on save
npx vitest run src/auth/password.test.ts   # a single file
```

No database, no server and no environment variables are needed. `npm test` is
safe to run against a laptop with nothing else started.

Config lives in `vitest.config.ts`: node environment, everything matching
`src/**/*.test.ts`, forked processes, and a 20s per-test timeout because bcrypt
at cost 12 takes roughly 300ms per round and several tests run a few of them.

## What is covered

| File | Module | What it pins |
| --- | --- | --- |
| `src/auth/password.test.ts` | `auth/password.ts` | Length and common-password policy including both boundaries, the bcrypt cost-12 prefix, salting, verify round-trip, and the null-hash path returning false without throwing *and without skipping bcrypt*. |
| `src/auth/tokens.test.ts` | `auth/tokens.ts` | base64url output (no `+`, `/`, `=`), 256 bits by default, 1000 distinct tokens in 1000 calls, SHA-256 stability and shape, `safeEqual` returning false on a length mismatch instead of throwing, `expiresIn` treating its argument as seconds. |
| `src/utils/case.test.ts` | `utils/case.ts` | snake ↔ camel round trip across the real member column set, value and falsy-value preservation, no mutation of the input row. |
| `src/utils/sqlUpdate.test.ts` | `utils/sqlUpdate.ts` | The allowlist. Keys outside it are dropped, placeholders stay contiguous from `$1` when keys are dropped, values bind positionally in clause order, and a key crafted as `id = 1; DROP TABLE leads; --` never reaches the SQL. |

Two tests deserve a note because their assertions look loose on purpose.

**The bcrypt timing assertions** (`still spends real bcrypt time when the hash is
null`) assert a 20ms floor rather than attempting to prove constant time.
Comparing two timing distributions tightly enough to prove that property is the
kind of test that goes red on a noisy shared runner for reasons unrelated to the
code. The floor still catches the regression that matters: `bcrypt.compare`
returns `false` in well under a millisecond for a hash string it cannot parse,
and it does so silently — no throw, no warning. A single typo in `DUMMY_HASH`
would therefore delete the account-enumeration defence with no other symptom.
Verified by mutation: corrupting that constant drops the null path from ~300ms
to 0.07ms and both tests fail.

**`assigns the same column twice when the body supplies both spellings`** pins
current behaviour rather than desired behaviour; see the note below.

## What is not covered, and why

**Anything that touches Postgres.** `auth/memberSession.ts`, the
`/api/auth/*` and `/api/member/*` routes, and `middleware/memberAuth.ts` all
read and write real tables — sessions, refresh-token rotation and reuse
detection, password-reset and magic-link consumption are defined by what the row
looks like after the call, so a mocked `pg` would only assert that the mock was
called. These need a throwaway Postgres (testcontainers or a
`bossclinician_test` database migrated from `src/db/migrations/`) and a
`globalSetup` that migrates and truncates between files. That is the next piece
of test infrastructure to build, and the highest-value one: refresh-token
rotation and the "reused token revokes the family" path are the parts of Phase 1
most likely to break silently.

**Modules that import `config/env`.** `config/env.ts` throws at import time
without `JWT_SECRET`, which transitively affects anything reaching `db/pool`.
The four modules tested here are pure and import cleanly with an empty
environment, which is why they were chosen to go first. The existing
`src/auth/tokenSeparation.test.ts` shows the alternative for modules that cannot
avoid it: set the variables in `beforeAll` and `await import()` the module
inside each test so the assignment happens before module evaluation. Prefer that
over mocking `config/env`.

**HTTP-level behaviour.** Status codes, zod rejection shapes, the generic
responses that hide whether an email is registered, cookie flags on the refresh
cookie. These want supertest against the assembled app, which needs the database
above.

## Known issues found while writing these tests

Reported, not fixed — none of these files belong to this suite.

1. **`utils/sqlUpdate.ts` can emit a duplicate assignment.** A body carrying
   both spellings of one column (`{ sortOrder: 1, sort_order: 2 }`) produces
   `sort_order = $1, sort_order = $2`. Postgres rejects that with 42701 and the
   route returns a 500 where a 400 is correct. Every caller passes `req.body`
   through unfiltered, so it is reachable — admin-authenticated only, and no
   data is at risk. Fix is to key the accumulator by column and let the last
   value win, or reject the collision. Pinned by the last test in
   `sqlUpdate.test.ts`.

2. **Most of `COMMON_PASSWORDS` in `auth/password.ts` is unreachable.** The
   minimum length of 10 runs first, and 17 of the 18 entries are 8 or 9
   characters — only `password123` can ever reach the guessability check. The
   list reads like a working defence and is one entry deep. Either lengthen the
   entries to things that pass the length rule (`password1234`,
   `qwerty123456`, `iloveyou123`) or check a normalised prefix.

3. **`utils/case.ts` cannot round-trip a column with a digit segment.**
   `toCamel` uppercases the character after the underscore, and `"1"` uppercases
   to `"1"`, so the separator is lost: `reminder_1h_sent_at` → `reminder1hSentAt`
   → `reminder1h_sent_at`. `coaching_sessions.reminder_1h_sent_at` and
   `reminder_24h_sent_at` are real columns. Nothing reads them through these
   helpers today, so this is latent — but the failure mode when it lands is
   `buildUpdate` silently dropping the field rather than erroring. Pinned by
   `case.test.ts` so it is visible rather than surprising.
