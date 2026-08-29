# Backend growth subsystem — adversarial review

Scope: `backend/src/automations/**`, `backend/src/jobs/**`, `backend/src/email/**`,
`services/{sequences,drip,segments,contacts,broadcasts,webhooksOut,reports}`,
`routes/public/{emailWebhook,emailPrefs,subscribe}`,
`routes/admin/{contacts,segments,sequences,growth,automationsV2,subscribers,reports,tags,leads}`.

Read-only against the live system: nothing here was executed against a mail provider or a
database. Every finding below was traced through the code and, where the failure is in SQL,
against the migration that defines the table.

Verified with `npm run typecheck` + `vitest run --no-file-parallelism`: both green
(423 passed, 99 integration tests skipped as there is no database in this environment).

---

## Critical

### C1 — The "Send campaign" button bypasses the entire compliance and durability path

**File:** `backend/src/routes/admin/growth.ts:233-296` (before the fix)

`POST /api/admin/growth/campaigns/:id/send` is the endpoint the console actually calls
(`frontend/src/lib/api.ts:567`). `services/broadcasts.ts` — the Phase-5 implementation that
resolves segments, honours suppression and fans out through the queue — is **not reachable
from any admin route at all**; `startBroadcast` was only ever called by `tickBroadcasts` for
campaigns that had been *scheduled*. The button ran a separate, older code path.

Four distinct failures in one handler:

1. **Segment-targeted campaigns went to the whole subscriber list.** The handler called its
   own local `resolveAudience(campaign.audience)` (growth.ts:198-210), which never looks at
   `email_campaigns.segment_id`. Trigger: a campaign is pointed at the saved group "Bali 2027
   attendees" (42 contacts) and sent. Outcome: `SELECT email FROM subscribers` — the entire
   list.
2. **No suppression, no preferences.** Each copy went through `email/mailer.sendMail`, which
   knows nothing about `email_suppressions`, `contacts.email_marketing_status` or
   `contact_email_preferences`. Trigger: any campaign send. Outcome: addresses that had
   hard-bounced, filed a spam complaint, or clicked unsubscribe were mailed again.
3. **No unsubscribe link, no postal address, no `List-Unsubscribe` header.** The compliance
   block lives in `email/provider.sendEmail` (`complianceBlock`, provider.ts:407-431) and was
   never reached. Trigger: any campaign send. Outcome: a commercial email that is illegal
   under CAN-SPAM and that gives Gmail/Outlook no one-click opt-out, so the reader's only
   remaining button is "report spam".
4. **Detached send loop.** `void (async () => { ... })()` in the request handler — the exact
   failure `services/broadcasts.ts`'s own header comment says it was written to replace.
   Trigger: a deploy or restart part-way through a 5,000-recipient send. Outcome: the
   remaining recipients are silently dropped with the campaign still reading `sending`, and
   nothing records who was reached.

Also: no `email_messages` row was written, so no bounce or open event the provider posts back
can ever be attributed to these sends.

**Fix:** the route now delegates to `startBroadcast(campaignId)`. The three preconditions
(already sending / already sent / no subject) stay in the route so their 400s keep the wording
the console shows; everything else — segment resolution, mailability filter, per-recipient
`email_sends` rows, queued fan-out at bulk priority — comes from the service. The worker that
drains the queue is on by default (`config/env.ts:122`, `WORKER_ENABLED` unset), and
`broadcast.sendOne` is registered (`jobs/emailJobs.ts:296`).

---

## High

### H1 — `coaching.reminders` fails on every single run; no coaching reminder has ever been sent

**File:** `backend/src/jobs/coachingJobs.ts:93-97`

The claim statement is `UPDATE coaching_sessions s ... FROM due WHERE s.id = due.id RETURNING
s.id, ..., COALESCE(m.email::text, '') AS email, COALESCE(o.title, 'coaching') AS offer_title`.
Neither `m` (`members`) nor `o` (`coaching_offers`) appears in the UPDATE's `FROM` clause.

**Trigger:** the `coaching-reminders` schedule (migration 011, every 15 minutes) fires the
handler. **Outcome:** Postgres raises `ERROR: missing FROM-clause entry for table "m"`; the
job fails, retries five times, and lands in the dead-letter list. No 24-hour and no 1-hour
reminder is ever delivered for any booked session. The code's own next comment already says
"RETURNING cannot reach tables the UPDATE did not touch" and performs a second read for
exactly those columns — the columns in `RETURNING` were leftovers. The sibling implementation
in `jobs/eventJobs.ts:305-310` gets this right by putting `events e` in the `FROM`, which is
what made the contrast visible.

Neither typecheck nor the test suite can see this: the SQL is a template string and the
DB-backed tests are skipped.

**Fix:** `RETURNING s.id` — the ids are all `claimDue` uses from that statement.

### H2 — An automation action with a delay never runs, and never reports that it did not

**File:** `backend/src/automations/engineV2.ts:644-665`

`delay_minutes` is settable on any action from the builder (`routes/admin/automationsV2.ts:44`,
0–525,600 minutes; the sentence renderer at :153 says "after 3 days, ..."). For a non-`wait`
action the resume index is the *same* index (`engineV2.ts:653`).

**Trigger:** an automation whose second action is "after 3 days, send them an email".

1. First pass reaches the action, sees `delay_minutes = 4320`, enqueues
   `automation.runAction` with `dedupeKey = automation-resume:{runId}:{index}` and
   `runAt = now + 3d`, marks the run `waiting`, returns.
2. Three days later a worker claims that job. The row's status is now `running` — and the
   dedupe index (`migration 011:63`) is partial on `status IN ('queued','running')`, so the key
   is still live.
3. The handler re-enters `runAutomation` at the same index, sees `delay_minutes = 4320`
   *again*, and enqueues the identical dedupe key. `ON CONFLICT ... DO NOTHING` returns null.
4. The run is marked `waiting` and returns. The job succeeds. **No resume job now exists.**

**Outcome:** the action is never performed and every action after it is skipped. The contact
never gets the email, the run sits at `waiting` forever, and nothing appears in the
dead-letter list because the job did not fail. (Without the dedupe collapse the same code
would instead re-enqueue a fresh 3-day wait forever — both arms of this are broken.)

**Fix:** the resume payload now carries `delayServed`, set only when the resume index is the
same index (i.e. not for a `wait` action, which resumes at `index + 1` and whose successor's
own delay must still apply). `runAutomation` skips the delay for exactly that one index.
Plumbed through `jobs/emailJobs.ts:34-46` as an optional field, so jobs queued before this
change parse and resume as they did.

### H3 — Deleting a segment silently re-points its campaigns at the entire list

**Files:** `backend/src/services/broadcasts.ts:91-130`, `backend/src/routes/admin/segments.ts:244-258`,
`migration 013:184`, `db/schema.sql:564`

`email_campaigns.segment_id` is `INT REFERENCES segments(id) ON DELETE SET NULL`.
`email_campaigns.audience` is `TEXT NOT NULL DEFAULT 'all_subscribers'`, so a campaign
targeted at a segment still carries that default in its `audience` column.
`resolveAudience` uses the segment when `segment_id IS NOT NULL` and otherwise falls back to
`audience`.

**Trigger:** a campaign is pointed at a 42-contact segment and scheduled for Tuesday. On
Monday someone deletes the segment from the groups screen. **Outcome:** `segment_id` becomes
NULL, `resolveAudience` falls through to `all_subscribers`, and `tickBroadcasts` sends the
campaign to every subscriber on Tuesday with no human in the loop.

**Fix:** `DELETE /api/admin/segments/:id` now refuses (400, naming the campaigns) while any
campaign in `draft`, `scheduled` or `sending` still points at the group. Deleting a group a
*sent* campaign used stays allowed — that campaign's own record of who it reached is in
`email_sends` and does not depend on the segment.

Related, fixed in the same place: `AUDIENCE_PREDICATES[campaign.audience] ??
AUDIENCE_PREDICATES.all_subscribers` treated *any* unrecognised audience string as "everyone",
and `audience` is written through a permissive CRUD route (`anySchema`,
`routes/admin/growth.ts`). The lookup is now `audiencePredicate()` — own-property only, and
`null` for anything it does not recognise, which makes `startBroadcast` refuse the send with
"Nobody in that audience can be emailed right now" instead of mailing the list. Own-property
matters on its own: `audience = "toString"` previously resolved to a function and was
interpolated into the WHERE clause.

---

## Medium

### M1 — The v1 automation engine's `send_email` bypasses suppression and the unsubscribe footer

**File:** `backend/src/automations/engine.ts:84-91`

`automations/engine.ts` is still live. Its triggers (`lead_created`, `subscriber_created`,
`order_paid`, ...) fire from four public routes: `routes/public/subscribe.ts:48`,
`routes/public/leads.ts:111`, `routes/public/growthPublic.ts:165`,
`routes/public/stripeWebhook.ts:410`. Its `send_email` action called `sendMail` directly.

**Trigger:** an automation on `lead_created` with a `send_email` action, and someone who
unsubscribed last month fills in the contact form. **Outcome:** they are mailed again, and the
message carries no opt-out link and no postal address. Secondary: the HTML was built as
`` `<p>${body.replace(/\n/g, "<br>")}</p>` `` with `body` containing `{{name}}` /
`{{message}}` rendered straight from the form submission — unescaped, so submitted markup is
rendered as markup. `notify_admin` had the same escaping hole, landing in the owner's inbox.

**Fix:** `send_email` resolves a contact with `upsertContact` and goes through
`email/provider.sendEmail` (suppression, marketing status, topic preference, compliance block,
`email_messages` row), and both actions render their HTML with `renderMarkdown`, which escapes.

### M2 — Email-webhook idempotency is off entirely for a provider that sends no event id

**File:** `backend/src/routes/public/emailWebhook.ts:163-182`, `migration 013:73`

`provider_event_id` is written as `NULLIF($2, '')` and its unique index is **partial** on
`provider_event_id IS NOT NULL`. The id is `bodyId || (svixId ? ... : "")` — so for the plain
`x-webhook-signature` scheme, with no `svix-id` header and no top-level `id` in the body, it
is `""` → NULL → the guard does not apply.

**Trigger:** such a provider redelivers a batch (every provider does, on any 5xx or timeout).
**Outcome:** each redelivery inserts a fresh `email_events` row and re-runs the side effects —
`email_messages.open_count` and `email_campaigns.opened_count` climb every time the provider's
queue hiccups, so the reported open rate drifts upward without bound; a redelivered `bounced`
re-runs `suppress()`.

**Fix:** when the provider supplies no id, one is derived — `derived:` plus a SHA-256 over
(kind, provider message id, recipient, `created_at`, click link). A redelivery of the same
event hashes to the same key and collapses on the unique index; two genuinely different events
do not.

### M3 — Newsletter issues are sent with no suppression and no unsubscribe link

**File:** `backend/src/routes/admin/growth.ts:139-193`

`POST /api/admin/growth/issues/:id/send` selected addresses straight out of `subscribers` (or
`subscriptions` for a paid newsletter) and posted each through `sendMail`. Same shape as C1.2
and C1.3: **trigger** — pressing "send issue"; **outcome** — a commercial email to people who
have unsubscribed or hard-bounced, with no opt-out link and no postal address.

**Fix:** each copy resolves a contact and goes through `sendEmail` with
`sourceType: "broadcast"`, `topic: "marketing"`. The send loop is still detached in the
request (see Residual R1).

---

## Where I looked hard and found nothing

- **`jobs/queue.ts` claim/lease/dedupe.** `FOR UPDATE SKIP LOCKED` over a partial index that
  matches the WHERE; the `status='running' AND lease_expires_at < now()` arm is genuine lease
  reclamation, not a duplicate-claim hole; `renewLease` runs at a third of the lease from
  `worker.ts:65`. `ON CONFLICT (dedupe_key) WHERE ...` repeats the index predicate exactly
  (migration 011:63), so inference resolves. Backoff is capped at an hour with jitter on both
  the JS and the SQL side, and a failing job gets a future `run_at`, so it cannot block the
  head of the queue. Dead jobs are kept out of the retention sweep on purpose.
- **`services/sequences.ts` scheduling.** `nextSendAt` only ever moves the candidate forward
  (the weekend and window branches both target a strictly later instant), the 32-pass bound is
  unreachable, and both branches route through `zonedWallClockToUtc`, which resolves the
  offset in two passes and lands nonexistent spring-forward times on the following hour. The
  send step holds `FOR UPDATE` on the subscription across the send, so two workers cannot both
  send email 3, and the tick's dedupe key carries the position so an overlapping tick cannot
  re-queue one.
- **`services/segments.ts` compilation.** No user string ever reaches SQL: fields are looked up
  by own-property in a fixed table, operators against that field's own allowlist, values bind
  as parameters, `LIKE` metacharacters are escaped. The `any` join is fully parenthesised per
  clause, and every caller uses the result as a whole `WHERE`, never AND-ed with something
  else — so the "match=any silently returns everyone" precedence trap is not reachable.
  An empty rule set returning `TRUE` is deliberate and only ever seen by the preview.
- **`emailPrefs` unsubscribe surface.** Tokens are HMAC-SHA256 over the contact id under an
  HKDF-separated key, compared in constant time after a length check — not guessable and not
  interchangeable with a download token, so one contact cannot unsubscribe another. GET never
  acts (Safe Links / scanners), POST is the RFC 8058 one-click path, and re-subscribing clears
  only `unsubscribe`/`manual` suppressions, leaving bounces and complaints in place.
- **SNS/SES webhook.** `certUrlAllowed` is applied before the fetch and again to `SubscribeURL`,
  the cert cache cannot be poisoned or grown without bound, the signed-string construction
  matches AWS's field order, and `SES_SNS_TOPIC_ARN` is set in this deployment, so a stranger's
  topic cannot enlist the endpoint.
- **`jobs/contactRollup.ts` and `services/reports/rollup.ts`.** Both are full recomputes, not
  increments, which is what makes a retried webhook harmless. The rollup runs under a
  transaction-scoped advisory lock and sweeps only rows it did not stamp in the same
  transaction, so two overlapping rebuilds cannot delete each other's work. Refunds are read
  from `refunds` only and subtracted in `net_revenue`; `CLEARED`'s `kind = 'payment'` filter is
  what stops them being counted as income as well — I checked that no metric widens it.
  `orders`/`order_count` deliberately keep a refunded order as a sale while removing its money,
  which is stated and consistent between `contactRollup` and `rollup`.
- **`services/webhooksOut.ts`.** Retry scheduling belongs to the delivery, not the queue (the
  handler deliberately does not throw on a 4xx/5xx from the receiver), attempts are capped at
  5, the sweeper and the scheduled retry share one dedupe key so both noticing a due delivery
  produces one POST, and every outbound request has an `AbortSignal.timeout`.
- **`email/provider.ts` suppression gate.** Checked on every marketing path ahead of the
  transport, keyed on the address rather than the contact so it survives a delete-and-reimport,
  and a marketing send with no contact is refused rather than sent without an opt-out.
  `renderMarkdown` escapes before applying its own inline rules, so a `<script>` in a body
  arrives as text.
- **`jobs/eventJobs.ts`, `jobs/affiliateJobs.ts`.** Reminder claims are single-statement
  `UPDATE ... RETURNING` with `SKIP LOCKED` (correct, unlike H1), each window has a floor as
  well as a ceiling so a late registrant cannot collect all three reminders at once, and the
  affiliate sweeps are idempotent recomputes guarded by `NOT EXISTS` on the commission ledger.

---

## Residual, not fixed

- **R1 — newsletter issues still send from a detached promise** in the request handler
  (`routes/admin/growth.ts:178-204`). A restart part-way through loses the remainder. Fixing
  properly means a `newsletter.sendOne` job kind and a handler, which is a new feature rather
  than the smallest correct change; the compliance defect (M3) is fixed in place. Worth doing
  next time newsletters are touched.
- **R2 — `GET /campaigns/audience/:audience`** (growth.ts:214) still previews counts using the
  file-local `resolveAudience`, which counts silo rows rather than mailable contacts and does
  not know about segments. It is a preview of a raw audience key, so it is not wrong, but the
  number it shows no longer matches what a campaign will actually send. `services/broadcasts.
  audienceSize` is the function that agrees with the send path.
- **R3 — open and click counts are totals, not uniques**, both on `email_campaigns.opened_count`
  (emailWebhook.ts:275) and in the `email_opens` rollup metric. A reader who opens an email
  four times counts four times, so an open rate can exceed 100%. This is a reporting
  convention rather than a bug, but it is not the convention the word "open rate" implies.
- **R4 — Svix signature verification does not check the timestamp window**
  (emailWebhook.ts:35-56). A captured, valid request can be replayed indefinitely. The
  idempotency guard is what limits the damage to nothing, which is now true for every provider
  after M2 — but the timestamp check is the belt to that pair of braces.
- **R5 — `tickBroadcasts`'s close-off query can mark a campaign `sent` early.**
  `startBroadcast` sets `status = 'sending'` before it has inserted any `email_sends` rows; a
  concurrent tick landing in that window sees no `queued` sends and flips the campaign to
  `sent`. Cosmetic (the sends still go out), needs two ticks overlapping a large fan-out.
- **R6 — `sendDueEmail` calls `sendEmail` on the pool while holding a transaction open** on the
  subscription row (`services/sequences.ts:536`). Correct for de-duplication, but it holds a
  row lock across an outbound HTTP call, and a failure between the send and the COMMIT rolls
  the position back and re-sends on retry. At-least-once, inherent to send-then-record; noted
  rather than changed because the alternative (record-then-send) drops emails instead.

---

## Cross-boundary — outside my file ownership, not changed

- **`frontend/src/lib/api.ts:567`** — `sendCampaign` expects `{ ok, queued }`. The response now
  also carries `recipients`; the extra field is additive and the existing type still holds, so
  nothing breaks. If the console wants to show "queued to 42 people" rather than the old
  `queued` count, that is a frontend change.
- **`frontend`** — the campaign editor should stop offering the legacy audience dropdown and
  the segment picker as independent fields, since a segment now always wins and an unrecognised
  audience string is refused rather than silently meaning "everybody". Worth surfacing which
  of the two a campaign is actually using.
- **`backend/src/routes/public/growthPublic.ts:165`, `routes/public/leads.ts:111`,
  `routes/public/stripeWebhook.ts:410`** — these still fire the v1 engine
  (`automations/engine.ts`). M1 makes that path compliant, but the v1 engine has no delays, no
  loop guard and no per-contact run ceiling. Repointing them at `automations/engineV2`
  (`fireTriggerAsync` from engineV2, mapping `lead_created` → `form_submitted` /
  `contact_created` and `order_paid` → `offer_purchased`) is the real fix and is a decision
  about those routes, not about the engine.
- **`backend/src/db/schema.sql:564`** — `email_campaigns.audience DEFAULT 'all_subscribers'` is
  what makes H3 dangerous: a campaign pointed at a segment still carries "everybody" in its
  fallback column. A default of `''` would make the fallback fail closed on its own. Changing
  a schema default is a migration and outside this review's files.

---

# Follow-up fixes (verify pass)

Six items from the verify pass landed on the growth side. Each was re-confirmed
against the code before anything was changed.

## G1 — a delayed action after a `wait` never ran (HIGH, pre-existing)

`automations/engineV2.ts`.

**Confirmed.** The `delayServed` flag added earlier in this session covers a bare
per-action delay, and only that. For the pairing `wait` step → action with its own
`delay_minutes`, the `wait` enqueues `{fromIndex: i+1, delayServed: false}` under
the key `automation-resume:<run>:<i+1>`. The job that then resumes at `i + 1`
finds a delay on that action and has to enqueue a *second* resumption for the
same index — under the identical key, which the job itself is still holding.
`enqueue` collapses it ("the work is already going to happen"), the run is set to
`waiting`, and nothing ever comes back for it: no error, no dead-letter row, the
email simply never sends. Reachable from the builder, which accepts
`delayMinutes` on every step type (`routes/admin/automationsV2.ts:44`).

**Fixed.** The key now names which of the two pieces of work it is —
`resumeDedupeKey(runId, index, delayServed)` appends `:step` or `:action`. The two
resumptions are genuinely different work ("arrive at step i+1" versus "step i+1's
own delay has now been served"), so they no longer collide, while a genuine
duplicate of either still collapses exactly as before. Unit-tested in
`automations/engineV2.test.ts`.

## G2 — a delayed send could email the same person up to five times (MEDIUM-HIGH, regression)

`automations/engineV2.ts`.

**Confirmed.** A resume job's payload is fixed at the moment the delay was
scheduled. `evaluateConditions` and the trailing `appendLog` / status update sat
outside the try/catch, so a database blip after a delayed `send_email` had
already reached the provider failed the job — which went back on the queue with
`delayServed` still true, walked the same action again and sent the same message
again, up to `maxAttempts` (5). A SIGKILL or a lapsed 300s lease does the same
thing.

**Fixed** with a persisted per-`(run, action)` claim rather than by trying to make
the job not fail. `claimAction` takes the permit *before* the action runs, in one
atomic `UPDATE … WHERE NOT (marker @> id) RETURNING` — the row lock makes it a
real claim, so two workers racing on the same run leave exactly one with a row
returned. A retry finds the mark and skips the action.

The supporting changes: `evaluateConditions` moved inside the try (a condition is
a database read, and a blip on one used to fail the whole job), and log lines are
now written as they happen instead of in one batch at the end, so a run that did
send an email no longer shows an empty log if it dies before the final write.

**Trade made deliberately.** The claim is taken before the send and never
released, so a crash in the window between claiming and sending loses that one
email. At-most-once is the correct side to fail on: a duplicate mailshot cannot
be recovered, a missing one can be re-sent.

**Deliberately left / follow-up.** The mark lives in
`automation_runs.trigger_payload` under the reserved key `_performedActionIds`,
because that column is written once and read nowhere — no screen shows it, no
query filters on it — and this pass had no migration slot for growth. A dedicated
`automation_action_receipts (run_id, action_id)` table with a primary key on the
pair is the better home and should replace it in the next schema change; the
helper is a single function, so the swap is local.

## G3 — newsletter opens and clicks were credited to a stranger's campaign (MEDIUM, regression)

`routes/admin/growth.ts`.

**Confirmed.** Newsletter issues now go through `sendEmail` (correctly — they are
commercial mail and need the suppression list, the topic preference and the
unsubscribe footer), but they were sent as `sourceType: "broadcast", sourceId:
issue.newsletter_id`. Everything downstream reads that pair as one key naming a
row in `email_campaigns`: `routes/public/emailWebhook.ts` adds every open, click,
bounce and unsubscribe to the campaign with that id, and
`services/reports/rollup.ts` dimensions it as `broadcast:<id>`. Newsletter ids
come from a different sequence entirely, so a newsletter's engagement was being
added to whichever campaign happened to share the number — an email Yvette may
never have sent — with no way to unpick the two afterwards. New, because
newsletters previously bypassed `email_messages` altogether.

**Fixed as far as the file boundary allows.** `sourceId` is now `null`, which
stops the misattribution dead: the webhook's campaign update is guarded on
`source_id !== null`, and the rollup's per-id dimension on the same. The messages
still land in `email_messages`, still count in the `type:broadcast` total, and
still carry their compliance footer. Anonymous is wrong; misattributed is worse.

**Not fixed, and why.** A newsletter source type carried end to end needs four
files that are not this pass's to touch: the CHECK on
`email_messages.source_type` (a migration), `EmailSourceType` in
`email/provider.ts`, both `source_type IN ('broadcast','sequence')` lists in
`services/reports/rollup.ts`, and `SOURCE_TYPE_LABEL` in
`services/reports/queries.ts`. Until that lands, per-issue newsletter engagement
is not reportable — it was not reportable before this session either, so nothing
has been lost. Reusing the existing `digest` value was considered and rejected:
it is the community digest's, it carries that label in the reports, and the
rollup gives it no per-id dimension either.

## G4 — a Postgres error shown to the owner as her mistake, and a campaign stuck on "Sending now" (MEDIUM, regression)

`routes/admin/growth.ts` and `services/broadcasts.ts`.

**Confirmed, both halves.** `POST /campaigns/:id/send` re-threw every
`startBroadcast` failure as `badRequest(err.message)`, and the console prints any
short 400 verbatim (`frontend/src/pages/admin/ui/friendly.ts:186-196`) — so a raw
`duplicate key value violates unique constraint …` was presented to Yvette as
though she had filled a form in wrong. Worse, `startBroadcast` set
`status = 'sending'` before inserting the recipient rows, and nothing reset it: a
failure after that point left the campaign reading "Sending now" for good, since
`/send` refuses that status and the finish sweep only closes a campaign whose
sends have all left.

**Fixed.** `BroadcastRefusal` now marks the four sentences that are genuinely the
sender's to act on ("Add a subject line before sending", "Nobody in that audience
can be emailed right now", and the two already-sending / already-sent refusals).
The route shows those and only those; anything else is logged in full and
answered with a 500, which the console renders as "Something went wrong on our
end." Everything after the `sending` claim is wrapped, and a failure puts the
campaign into `failed` — a state the Send button is offered from again.

The retry path was made real while there: the fan-out no longer relies on the ids
the INSERT returned (`ON CONFLICT DO NOTHING` returns nothing for rows a first
attempt already wrote, so those people would have been skipped for good) and
instead re-reads every `email_sends` row still `queued`. Anyone already sent to is
no longer `queued`, and the per-send dedupe key collapses a job that is still
pending — so a retry reaches the people who were missed and cannot double-send
the rest.

**Deliberately left.** The `sending` claim itself stays *before* the inserts: it
is the lock that stops a second click, or the scheduled tick landing on top of a
manual send, from fanning the same campaign out twice.

## G5 — deleting a segment could mail the entire list (HIGH, currently inert)

`routes/admin/segments.ts`.

**Confirmed.** The delete guard listed `('draft', 'scheduled', 'sending')` and
omitted `failed`, which `services/broadcasts.ts` writes whenever a send cannot
start and for which the console still shows a Send button. `email_campaigns.
segment_id` is `ON DELETE SET NULL`, so deleting the segment leaves the campaign
pointed at the legacy `audience` column, which defaults to `all_subscribers` —
and the next Send goes to everybody.

**Fixed, and not by adding one word.** The check is now `status <> 'sent'`.
`email_campaigns.status` has no CHECK constraint behind it and is writable through
the generic campaigns CRUD route (`anySchema`), so *any* enumerated list of
blocking states is a list that can be walked around — a campaign with a status
nothing recognises would have passed the old guard too. `sent` is the only state
from which the segment genuinely stops mattering, because such a campaign never
resolves an audience again.

**Still inert, as before.** Nothing in the codebase currently sets
`email_campaigns.segment_id`, so no campaign can point at a segment yet. The
guard is now correct for when one can.

## G6 — the private podcast feed shipped audio URLs that do not work (HIGH)

`routes/public/growthPublic.ts`.

**Confirmed.** The RSS enclosure emitted `audio_url` verbatim. A paid show's audio
lives in the protected upload directory, which no web server serves, so the feed
shipped `https://site/protected:episode-12.mp3` — a 404 in every podcast app, for
the people paying for the show.

**Fixed.** The handler already loads the feed-token row; it now reads `member_id`
from it and signs each protected episode reference through the existing
`services/signedUrls.ts` (`signDownload`, kind `podcast-episode`), emitting an
absolute `/api/files/<token>` URL. Entitlement is re-proved on every hit by
`routes/public/verify.ts`, so a revoked feed token or a cancelled membership stops
the audio on the next request rather than at the end of the link's life. The feed
is sent `Cache-Control: private, no-store`, and episode identity is unaffected
because the `<guid>` is `episode-<id>` and `isPermaLink="false"` — a rotating
enclosure URL does not duplicate episodes in anyone's library.

**Expiry: seven days.** A podcast app is not a browser. It refreshes the feed on
its own schedule — every few hours at best, not at all while the phone is asleep
or the app is closed — then keeps the enclosure URL and uses it when the listener
presses play, which may be days later. The two hours a `podcast-episode` link
normally carries is right for a `<video>` element on a page somebody is looking
at and quite wrong here: the show would work for two hours after each refresh and
404 for the rest of the day. A week covers a client that has not refreshed since
last Thursday, and a link forwarded out of a paid feed still dies on its own.

**Deliberately left, two cases.**

- A private show whose audio was uploaded to the *public* directory still ships a
  permanent anonymous URL. It cannot be signed: `loadEntitledEpisodeAudio`
  (`routes/member/publishing.ts:303`) serves protected references only, so a
  signed link to a public file would 404. The real fix is that paid audio belongs
  in the protected directory, which is a decision made at upload time in
  `routes/admin/media.ts` / the episode form, outside this pass.
- A private feed token issued with no `member_id` (the admin route allows it)
  cannot be signed to anybody. Those feeds keep the old, broken URL rather than
  gaining a working anonymous one: better a link that fails than a link that
  hands paid audio to any fetch. Making `member_id` required on that route is the
  follow-up.

## G7 — repeat opens and clicks discarded as replays (LOW)

`routes/public/emailWebhook.ts`.

**Confirmed as already fixed, with a gap on one path.** `derivedEventId` — the
stable id synthesised for a provider that sends none — already includes
`event.created_at`, which is the field that distinguishes a reader's second open
from a redelivery of their first. The queue item was written against an earlier
state of the file.

**What was still wrong:** the SES/SNS path built its event through
`fromSesNotification`, which set no `created_at` at all. That path currently
supplies the SNS `MessageId` as the provider event id, so the derived id is
unused — but if it ever were used, every SES open by one reader would hash
identically and all but the first would be dropped.

**Fixed.** `fromSesNotification` now carries the event's *own* timestamp
(`open.timestamp`, `click.timestamp`, `bounce.timestamp`, `complaint.timestamp`,
`delivery.timestamp`), falling back to `mail.timestamp` only if none is present.
`mail.timestamp` deliberately last: it is when the message was *sent* and is
identical on every event about it, so leaning on it would reintroduce the bug.
The same value is now also what lands in `email_events.occurred_at`, which
previously recorded when we happened to process the notification.

**Deliberately left.** Two genuine opens by the same reader inside the same
timestamp granularity still collapse into one. Distinguishing them would need
something that varies per delivery, which is exactly what would break the
redelivery-stability the key exists for.
