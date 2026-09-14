# Lane 1 — Downloads (2026-09-12)

Implemented, isolated API lifecycle passed; staging deployment and browser acceptance remain for Lane V. Existing imported deliverables are blocked by missing source files.

## Reproduced before edits

- `Products.tsx` fetched only courses, communities and recurring plans; no Downloads home/count. Existing `ProductsCatalog.tsx`, commerce API `kind=download`, `product_files`, signed file delivery and member library downloads already existed. These are reused, not duplicated.
- Live Postgres contained 17 courses and 18 commerce products: 17 `course`, one `download` (ID 25, The Profitable Private Practice Boss Builders Collective).
- All 18 products had zero `product_files`. Eight media rows were unrelated uploads: two protected (video ID 6, Practice Reset worksheet ID 10), six public uploads. None are the supplied Downloads' deliverables. Four Resources have `cta_url='#'`; they are not source files.
- Buyer instructions had no product field or member display.

## Change

- `ProductsCatalog` accepts `downloadOnly`; `/admin/downloads?new=1` opens new Download directly. Root/Lane 2 integrates navigation and All Products counts.
- Download title, description, cover, status and buyer instructions persist through existing admin products API. Saving a new Download immediately opens file management.
- File manager supports uploads and searchable existing protected media-library files (100 search results); attached entries can be renamed/removed. Public files remain refused by the API.
- Buyer library includes instructions and existing signed file downloads. Existing authorization checks run both when issuing and redeeming links. Removed unsupported promise that files would trigger a future email automatically.
- New migration `051_downloads_product_home.sql` changes only exact owner-confirmed titles with no lessons. Keeps product IDs, grants, offer associations and original course rows; `legacy_course_id` preserves old public sales-page offer/access lookup. Admin Courses excludes converted records. Audit table records previous kind, source course ID, offer IDs and grant IDs.

## Conversion evidence

Migration was executed inside a live database transaction and **rolled back**; no staging conversions applied by this agent. It selected precisely six rows, with 11 Courses remaining. Final deployment must re-read persistent state.

| Product ID | Former course ID | Title | Before | After on migration | Existing offers / grants |
| --- | --- | --- | --- | --- | --- |
| 2 | 2 | FULLY BOOKED TOOLKIT | course | download | 0 / 0 |
| 7 | 10 | THERAPIST NICHE CLARITY ACCELERATOR | course | download | 0 / 0 |
| 9 | 14 | FROM PROFILE TO PROFIT | course | download | 0 / 0 |
| 14 | 7 | PROVIDER PARTNERSHIP GUIDE | course | download | 0 / 0 |
| 15 | 9 | MARKETING MASTERY FOR THERAPISTS | course | download | 0 / 0 |
| 17 | 13 | CLIENT CONSULTATION CALL SCRIPT | course | download | 0 / 0 |

`PREPARE TO PROFIT JOURNAL` (course 12/product 16) is not an exact match to supplied `Prepare to Profit`; deferred pending source confirmation. The Private Practice Planner and Supervisory Billing Documentation Packet are absent. Other course types are not inferred from naming/empty lessons. Root attempted live Kajabi site 2148299891 Products: redirected to login and Cloudflare blocked (Ray a3a0cd1c1b90a29e), so full inventory cannot be independently confirmed.

## Verification

`./backend/scripts/test-integration.sh src/routes/admin/downloadProducts.integration.test.ts` — PASS, 1 integration scenario, 2026-09-12 17:59 UTC. Real Express app plus scratch Postgres created from migrations, no Stripe key or SMTP delivery:

- Admin create Download, update instructions, fresh GET confirms persistence.
- Attach existing protected media via API; create offer, associate Download.
- Real free checkout endpoint returns 201 and creates active buyer access.
- Buyer library reload contains instructions and file; signed URL returns exact bytes twice.
- Second member receives 404 for library and file-link requests.
- Deleting purchased product returns 400; unused Download deletes and subsequent GET returns 404.
- Scratch database and file directory removed. Email sink logged only approved `sagar+zzdownload@callsphere.ai`; no sends.

Backend/frontend typechecks passed before integration test creation; backend typecheck repeated after typed test adjustments. This is isolated acceptance, not live paid-wallet validation. Runtime Stripe is live: no real charge attempted.

## Remaining boundaries

- Actual imported PDFs/ZIPs/templates must be obtained from the account owner or authenticated Kajabi export. Type correction does not make their missing content delivered. No fake files attached.
- Complete source audit and Prepare to Profit match blocked by Kajabi access.
- Lane V must verify deployed admin UI/media selection, live creation/offer/checkout/library flow and resulting migrated counts after reload.
