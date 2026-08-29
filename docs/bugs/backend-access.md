# Backend access / delivery review

Scope: the member delivery surface (`routes/member/*`), the services behind it
(`access`, `signedUrls`, `certificates`, `curriculum`, `memberProfile`,
`communityNotifications`, `coachingCalendar`, `availability`), the admin routers
that feed it (`media`, `community`, `curriculum`, `courses`, `chats`,
`availability`) and the two public catalogue routes. Everything below was traced
end to end, including what `app.ts` mounts and what redeems a signed token in
`routes/public/verify.ts`.

Four defects fixed, three recorded as cross-boundary, one follow-up.

---

## Fixed

### 1. HIGH — every course built in the admin is a one-lesson course nobody can open

`backend/src/routes/admin/curriculum.ts:193` (POST `/admin/curriculum/modules/:moduleId/lessons`)

`course_lessons.slug` is `NOT NULL DEFAULT ''` with a `UNIQUE (module_id, slug)`
index over it (`db/migrations/003_phase3_product_delivery.sql:22,43`). The insert
never supplied a slug, and `LESSON_FIELDS` does not carry one either, so every
lesson took the empty string.

Exploit / repro, with an ordinary admin session:

```
POST /api/admin/curriculum/modules/7/lessons  {"title":"Lesson one"}   -> 201
POST /api/admin/curriculum/modules/7/lessons  {"title":"Lesson two"}   -> 500
```

The second call violates `idx_course_lessons_slug`. The one lesson that did land
holds `slug = ''`, and the member player resolves a lesson by slug —
`GET /api/member/library/:productSlug/lessons/:lessonSlug`, whose `slugSchema`
(`routes/member/library.ts:68`) requires `^[A-Za-z0-9]` — so the empty slug can
never be requested and `flattenLessons(...).findIndex(l => l.slug === lessonSlug)`
can never match it. A course assembled entirely through the admin screens is
therefore unbuildable past one lesson and unplayable at zero.

The frontend confirms nothing else supplies the value:
`frontend/src/pages/admin/CourseBuilder.tsx:174` posts exactly
`{title, bodyMd, videoUrl, attachmentUrl, durationMinutes, preview, published}`.

**Fix**: added `lessonSlug(title)` and set the slug in the INSERT, disambiguated
inside the same statement (`intro`, `intro-2`, `intro-3`) so two lessons called
"Introduction" in one section behave. Not added to `LESSON_FIELDS` — the slug is
in the URL a member bookmarked.

### 2. HIGH — a CEU certificate for a video course, with no video played

`backend/src/services/certificates.ts:671` (`earnedCeuCredit`) and
`certificates.ts:682` (`loadCeuLessonRecords`)

The rule that makes a CE certificate mean something held a lesson to the watch
figure only when `content_type` was `'video'` or `'audio'`. Nothing in this
codebase can write that column: `LESSON_FIELDS` in `routes/admin/curriculum.ts`
does not list it, no other route touches it (`grep -rn "content_type" src/routes`
finds only reads), and the column defaults to `'text'`
(`003_phase3_product_delivery.sql:17`). So on every course the platform can
actually build, every lesson took the dwell branch and the watch test was inert.

Exploit, as an ordinary member holding a 6-hour CE course:

1. `GET /api/member/library/<product>/lessons/<lesson>` for each lesson — this
   writes `lesson_progress.first_viewed_at` (`library.ts:632`).
2. Wait `requiredDwellSeconds(duration_minutes)`, which is capped at 3600s, and
   the waits for all lessons run concurrently because the timestamps are
   per-lesson.
3. `POST /api/member/lessons/:id/complete` for each — writes `completed_at` and
   deliberately leaves `watched_percent` at 0.

`recomputeCourseProgress` reaches 100, `issueCertificateIfEarned` runs,
`earnedCeuCredit` passes on the dwell rule alone, and the member gets a PDF
carrying credit hours and the CE provider number, verifiable at `/verify/:code`
by a licensing board, without a second of the video having been played.

**Fix**: `loadCeuLessonRecords` now also reports whether the lesson actually
carries `video_url` or `audio_url`, and `earnedCeuCredit` applies the watch rule
to any lesson that does, whatever the label says. The label check is kept, so an
`assessment`/`embed` lesson pointing at somebody else's host is unaffected.
Pinned by two new cases in `services/certificates.test.ts`.

### 3. MEDIUM — stored XSS on the site's own origin through the media library

`backend/src/routes/admin/media.ts:190` (multer `filename`)

The stored name was `<random hex> + path.extname(originalname)`. `app.ts:69`
hands `env.uploadDir` to `express.static`, which types a response from the file
extension and never from the `mime` column we recorded.

Exploit — one multipart POST from any admin session:

```
POST /api/admin/media?visibility=public
  part "file": filename="notes.html", Content-Type: text/plain   <-- on ALLOWED_MIME
```

`resolveMime("text/plain", …)` accepts it, the bytes land at
`<uploadDir>/<hex>.html`, and the response hands back
`url: "/uploads/<hex>.html"`. Fetching that URL returns the attacker's markup as
`text/html` on the application's own origin, where the admin JWT and the member
session cookie live. `logo.svg` declared `image/png` does the same thing and
walks straight past the SVG exclusion the file states in its own comment.

The mount is gated on `requirePermission("website.view")`
(`routes/admin/index.ts:70`) and `media.ts` adds no per-route `manage`, so this
is also a path from the lowest-privilege admin role to the owner's session. The
same file, uploaded `visibility=protected`, is served inline by
`/api/files/:token` (community-media and coaching-file both pass `mime: ""`, so
`sendFile` types it from the extension too).

**Fix**: added `storedExtension(declared, originalName)`. An extension already on
the `EXT_TO_MIME` whitelist is kept, so an `.m4a` stays an `.m4a`; anything else
is replaced by the extension the resolved MIME type is served under, or dropped.
The uploader's name is untouched in `original_name`. Pinned by
`routes/admin/media.test.ts`.

### 4. LOW — the "paid media" guard is walked past with a snake_case key

`backend/src/routes/admin/curriculum.ts:76` (`assertPaidMedia`)

The guard read `body.videoUrl` / `body.attachmentUrl`, but what actually gets
written is decided by `buildUpdate`, which runs every body key through
`toSnake` (`utils/sqlUpdate.ts:22`) and matches against the column list.

```
PUT /api/admin/curriculum/lessons/42  {"video_url": "/uploads/course.mp4"}
```

`assertPaidMedia` sees no key it recognises, `buildUpdate` resolves `video_url`
to the whitelisted column, and the lesson now points at a permanent, unexpiring,
forwardable address on the open web — precisely the state the guard exists to
refuse, and the one it prints a sentence about.

**Fix**: the guard now resolves each body key with the same `toSnake` and matches
on the column, so both spellings are refused. Pinned by
`routes/admin/curriculum.test.ts`.

---

## Cross-boundary (outside my file ownership)

### A. HIGH — the private podcast feed publishes a storage reference, not a URL

`backend/src/routes/public/growthPublic.ts:70-80`

The RSS handler emits the raw column:

```ts
const audio = String(ep.audio_url ?? "");
const audioUrl = audio.startsWith("http") ? audio : `${site}${audio}`;
```

A private show's audio lives in the protected directory as `protected:<key>` —
that is what `loadEntitledEpisodeAudio` (`routes/member/publishing.ts:287`)
requires before it will serve a byte, and what `episodeAudioUrl`
(`publishing.ts:98`) signs for the member API. The feed therefore ships
`<enclosure url="https://site/protected:episode-12.mp3">`, which 404s in every
podcast app. The paid private podcast is undeliverable through the only channel
it is sold on, and the member-facing API is the only place it plays at all.

The mirror case is worse: a private show whose audio the admin happened to upload
as *public* yields `https://site/uploads/x.mp3` in the feed — the paid show on
the open web, no feed token required, permanently.

Fix belongs in that handler: it already looks up the matching
`podcast_feed_tokens` row and discards it, so it has the `member_id` it needs to
call `signedFileUrl({ kind: "podcast-episode", fileId: ep.id, memberId })` per
episode (two-hour links, and podcast clients re-fetch the feed).

### B. MEDIUM — the coaching calendar has no writer, so nothing sold can be booked

`backend/src/routes/admin/index.ts`

`adminAvailabilityRouter` (`routes/admin/availability.ts`) is exported and never
mounted. Nothing else in the repository writes `coach_availability` or
`coach_availability_overrides` (`grep -rn "coach_availability" src` finds only
this router and the read-side `services/coachingCalendar.ts`), and the frontend
has no availability screen (`grep -rn "admin/availability" frontend/src` is
empty).

With no rules, `ruleIntervals` returns `[]`, `computeSlots` returns `[]`, and
`GET /api/member/coaching/offers/:slug/slots` answers `slots: []` for every
window. A member who has paid for a six-session package can never book one.

Fix: `adminRouter.use("/availability", requireAuth, requirePermission("products.view"), adminAvailabilityRouter)`
plus the admin screen to drive it. The router itself reads correctly — validated
weekday/minute bounds, `endMinute > startMinute`, IANA zone checked through
`isValidTimeZone`, audit rows on every write, and a preview that goes through the
same `computeSlots` the member gets.

### C. LOW — podcast episodes have no "was this uploaded for everyone" guard

`backend/src/routes/admin/growth.ts:124` and `db/growthRepos.ts:55`

Episodes are written through the generic CRUD repo with `anySchema`, so
`audio_url` accepts anything. `routes/admin/products.ts:488` and
`routes/admin/curriculum.ts` both refuse a bare `/uploads/...` reference for the
thing that was sold; the podcast path has no equivalent, which is how finding A's
mirror case arises.

---

## Follow-up (not a defect on its own)

`LESSON_FIELDS` in `routes/admin/curriculum.ts` covers only the eight columns
that existed before Phase 3. `drip_days`, `drip_date`, `content_type`,
`audio_url`, `captions_url`, `embed_html`, `transcript`,
`video_duration_seconds`, `comments_enabled` and `notes_enabled` have no writer
anywhere in the admin. The security consequence — the CEU watch rule going inert
— is fixed above at the reading end, so it no longer depends on the label. What
remains is a feature gap: drip schedules cannot be configured at all, so every
lesson opens the moment access is granted, and `video_duration_seconds` stays 0
so `creditWatchedPercent` falls back to the author's estimate. Widening the
whitelist needs matching admin UI, so it is recorded rather than done.

---

## Looked hard, found nothing

- **Signed-URL design** (`services/signedUrls.ts`). The HMAC covers version,
  kind, file id, member id and expiry; the key is HKDF-derived under its own
  `info` string, so a download token, an admin-preview token and a session token
  are not interchangeable; comparison is `timingSafeEqual` behind a length
  pre-check; expiry is enforced on verify; `uploadPath` resolves before testing
  containment (so `%2e%2e` and post-normalisation escapes both fail) and
  `resolveStoredFile` realpaths to catch a planted symlink. `config/env.ts:37`
  refuses at boot to run with the protected directory nested inside the one
  `express.static` serves. No token reuse across members, files or kinds found.
- **`/api/files/:token`** (`routes/public/verify.ts`). Signature, then the
  requester if a session is present, then account status, then entitlement
  re-checked through the owning module for all seven stream kinds and both
  download kinds, then path resolution, then bytes. Range is answered by
  `sendFile` rather than a hand-rolled parser. `Content-Disposition` filenames
  are basenamed and stripped of control characters and quotes.
- **IDOR sweep** over every `:id` on the member surface: lesson progress, notes,
  lesson comments, certificates, coaching sessions and session files, community
  posts, comments, reactions, poll votes, reports, RSVPs and challenge entries,
  podcast feed rotation, newsletter subscription. Every one resolves the id back
  to the member — or to the community, through `mayEnterCommunity` — inside the
  WHERE clause rather than comparing after the read, and refuses with 404 rather
  than 403.
- **Progress forgery.** `creditWatchedPercent` derives the percentage from the
  reported position wherever a media duration is on record, credits at most 2.5
  seconds of lesson per second of wall clock, caps a single report's gap at 120
  seconds, and refuses "90% at second zero". `PROGRESS_UPSERT_SQL` takes
  `GREATEST` of stored and incoming, so a hundred concurrent pings earn what one
  earns, and `completed_at` never re-arms after a deliberate un-tick.
- **Coaching races.** Booking and rescheduling both take
  `pg_advisory_xact_lock(8241, 0)` and only then re-run `isSlotBookable` — the
  same function the slot list is built from — inside the transaction; credits are
  read `FOR UPDATE`; cancel re-reads the session `FOR UPDATE OF s`, so a second
  concurrent cancel sees `status = 'cancelled'` and cannot refund the credit
  twice. `loadBusySessions` is not scoped to the member, so one member's booking
  blocks another's.
- **DST.** `services/availability.ts` expands each weekly rule per calendar day
  through `zonedWallClockToUtc` rather than freezing an offset, and drops a
  window whose end lands at or before its start — the hour that does not exist on
  a spring-forward morning. Checked 2026-03-08 and 2026-11-01 in
  America/New_York by hand: a 09:00 rule resolves to 13:00Z and 14:00Z either
  side of the transition, and a 01:00–04:00 window keeps its real two hours.
- **Stored XSS in member-authored content.** Community posts, comments, challenge
  notes, the member directory search term and lesson comments all go through
  `utils/plainText` on the way in (tags removed rather than escaped, plus a
  second pass for an unterminated opener); member-supplied links are parsed with
  `URL` and restricted to http/https; reactions are a fixed enum.
- **Community paywall.** `mayEnterCommunity` and `listEnterableCommunityIds`
  decide from `access_grants`, plus manual/automation/plan memberships where a
  plan-sourced one still has a live subscription — never from the membership row
  alone, which survives a refund on purpose. The listing, the room, the feed and
  `loadEntitledPostMedia` all ask the same question, and a ban is checked in each.
  Auto-join runs only after entry has already been allowed and writes a `source`
  computed in SQL from the same predicate `access.ts` reads back.
