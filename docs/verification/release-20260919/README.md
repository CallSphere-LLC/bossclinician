# Boss Clinician release verification — 19 September 2026

Scope: the local `changes_to_dof.txt` task record, the [Boss clinician Bugs sheet](https://docs.google.com/spreadsheets/d/13RTFcjDK5omngi_MalSxNNNgd4DQt8HumCBu0YnVdCs/edit#gid=0), and the requested Club checkout destination.

## Changes

- Direct K3s deployment of backend, frontend, AI and gateway; original database and upload storage preserved. Immutable image tags, source-content manifests, database backup before migration, rollback routing and scoped image retention. Git pushes validate code; deployment does not depend on GitHub Actions.
- Role-aware spoken and streamed text assistants, guided tours, page navigation/cursor, durable transcripts, recorded calls and reviewed admin actions. Text tool results retain their original arguments, and catalog reads include both the requested editing schema and record data. Admin tools discover actual schemas for 40 operations across 14 resources; uploads, credentials, refunds and unsupported specialized actions remain in their dedicated screens.
- Private member/admin transcripts excluded from the support inbox; authenticated voice requests refresh the correct identity instead of silently becoming public. Recording playback respects the admin CSP and active recordings cannot be prematurely finalized.
- Community access groups support free, one-time, monthly and yearly prices through actual offers/checkouts. Existing grants and subscriptions remain valid when repricing; revoked grants remove protected access.
- Admin sign-in has an absolute eight-hour deadline; member sign-in has an absolute thirty-day deadline, including rotated sessions. Active screens recheck expiry.
- Community names, channels and named access groups appear in clearer navigation. Native community rooms are the default event destination, with optional external links.
- Native calls show elapsed time in full and floating views and retain personal/admin call history.
- Marketing content aligns Club with six-month coaching, Lounge with monthly membership, and Boardroom with an advanced mastermind. Retired one-to-one and reset-planner offers removed. Retreat content and imagery restored from the supplied original site.
- All seven Club join buttons link to `https://www.bossclinician.com/offers/tzgjALKU/checkout`.

## Verification evidence

The adjacent JSON files and screenshots record actual browser/API observations. Preview checks use the real K3s services and original HTTPS origins through host-preserving routing, including a streaming reverse proxy for voice; final public checks ran directly against the public origins after routing cutover.

- Full database integration: 285 tests across 34 files passed against disposable scratch databases; a subsequent focused 17-test member-community run also passed with the final call-history regression. No scratch databases remained.
- Frontend final suite: 361 tests across 36 files passed.
- Backend final unit suite: 1,214 tests across 92 files passed; database tests were run separately rather than treated as skipped passes.
- Deployment/retention checks: 109 passed. AI service: 11 passed.
- Marketing final production: nine routes at 320, 390, 768, 1440 and 1920 pixels; 45 checks, all HTTP 200, no overflow, broken images or page exceptions.
- Community browser checks: free and monthly $49 groups persisted after reload; generated checkout pages displayed the correct totals. Native and external events persisted. All seven Club buttons had the exact requested target, and a browser click navigated there.
- Real provider voice session: spoken request navigated to Retreats; fifteen recording chunks saved, transcript persisted, and the provider reported 44 seconds and the persisted end timestamp was verified. Saved S3 audio played through the actual admin recording controls (readyState 4 and advancing playback time) without CSP violations.
- Streamed public chat: navigation and page pointing worked with 39 visible progressive text updates on the final public release.
- Native video: two distinct members received live audio/video, each with two decoded 640×480 streams, visible elapsed timers, persisted end times and call history after reload.
- Private transcript regression: support received 404 for existing member/admin conversations and its list excluded those sessions.

## Boundaries

No real customer charge or external email was submitted. Payment access/refund behavior was exercised in isolated database integration tests, and checkout rendering was inspected in the browser. The original external retreat reservation checkout returned a provider/Cloudflare 403 from this environment; its existing URL is retained with a contact fallback. This does not establish successful paid checkout on that external site.

## Final release record

Release `20260919183929-f736b5f` is serving production directly from K3s. Backend, frontend, AI and gateway images share source digest `1bfe0709be4c20665d87ca8c5bde149386f65fe6180181bb60d453a41316512a`; the original database and storage remain intact. All containers were ready with zero restarts after cutover.

The eight populated task rows in `Bugs!C2:C9` were changed to `Yes` after final live verification. Readback confirmed all eight values, preserved cell formatting, and unchanged blank task rows (`sheet-update.json`).

Spoken admin approval changed the isolated test enquiry and recorded its result; member voice navigated to the account page. Real-provider generic admin create, update and delete actions each required an explicit approval click and persisted their changes. Direct production native calls decoded both participants, retained their floating timer across navigation, and preserved call history after reload.

All 28 exact QA voice/text sessions were removed through the authenticated admin API. S3 prefix readback found zero remaining recording objects for those sessions. Temporary admin/member accounts, enquiries, community fixtures and generated commerce records were removed; residual checks across 61 foreign-key references and 24 email columns were zero. Fixture and recording cleanup evidence is recorded alongside this report. Git synchronization follows the direct deployment and does not trigger a second release.
