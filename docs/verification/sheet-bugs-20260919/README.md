# Boss Clinician bug sheet and course price verification — 2026-09-19

Scope: [Bugs rows 10–14](https://docs.google.com/spreadsheets/d/13RTFcjDK5omngi_MalSxNNNgd4DQt8HumCBu0YnVdCs/edit#gid=0), plus matching course prices to [the original catalog](https://www.bossclinician.com/all-courses). The user explicitly excluded row 15 (“change the new offer”). Existing completed rows 2–9 were preserved.

## Changes

- Community membership additions atomically save an in-app notification and queue a transactional welcome email. Concurrent duplicate adds do not repeat the notice. The worker checks current access, skips removed/banned/suspended members, supports active/invited members, and retries provider failures.
- Course curriculum reorder/delete actions use a keyboard-accessible More menu. Lesson edit and unlocked member lesson links use a subtle trailing chevron that moves on hover/focus, with reduced-motion support. Narrow screens preserve readable lesson names.
- An already-open member library refreshes when its tab regains focus, becomes visible, or is restored. The actual reported admin grant was already persisted; the old screen remained stale until reload. New responses supersede older requests.
- Contacts list/profile show community names. The Everyone dropdown includes Community members, filtering active memberships on the server.
- Retained the existing route loading recovery and deployment asset retention fixes. Member navigation is verified separately, including old-tab and failed-chunk cases.
- Filled seven missing course catalog price labels and added the original Profile to Profit installment option: $50 monthly twice, $100 total, alongside $97 upfront. No real payment is submitted by this verification.

## Price sources

All prices are USD. The checked original sales pages/checkout descriptions support these 11 course prices:

| Course | Price | Original source |
| --- | --- | --- |
| Directory Makeover Audit | $67 / $97 / $147 for 1 / 2 / 3 profiles | `/offers/wCanMVm6/checkout` |
| Fully Booked Toolkit | $67 | `/fullybooked` |
| Credentialing Success Formula | $17 | `/csfgrouppractices` |
| Private Practice Starter Suite | $27 | `/startersuitecourse` |
| Ramp-Up Rate Formula | $97 | `/rampedrevenue` |
| Provider Partnership Guide | $97 | `/Turn-Doctor-Referrals-Into-Ideal-Client` |
| Private Practice Protection Pack | $97 | `/Practice-Protection-Pack` |
| Marketing Mastery | $67, regular $147 | `/offers/Jgx2ULVA/checkout` |
| Rate Negotiation Letter Template | $7 | `/offers/7n6FFEe2/checkout` |
| Client Consultation Call Script | $37 or two $24 payments | `/offers/Yhc3aisz/checkout` |
| From Profile to Profit | $97 or two monthly $50 payments | `/profiletoprofitguide` |

The existing owner-approved prices remain $47 for Credential with Confidence, $47 for Therapist Niche Clarity Accelerator, and $17 for Prepare to Profit Journal. Their original sources could not independently establish current prices: the credential link opens a thank-you/download page, and the niche/journal checkouts returned Cloudflare 403; web-readable versions omit price controls. These are explicitly not claimed as newly source-verified. Evidence is in `price-sources.json` and sibling `sheet-course-access-20260919/price-browser.json`.

Original delivery-readiness restrictions remain: a visible price does not make an offer with missing materials purchasable.

## Verification status

Live release: `20260919-sheet-merged-2246`, source SHA-256 `de2663b7663288e0ed7fb3d108db86a6d333330f23effabda1f1a3c4546f6cce`. Built in an isolated checkout from the preceding authorized price release plus this task's changes, preserving concurrent work. K3s application and AI pods are ready with zero restarts. Database backup was taken before migration, and 835 existing browser assets were retained.

- Frontend: 378 unit tests passed; backend: 1,221 unit tests passed; both typechecks and production builds passed.
- Database integration: 290 passed in the full run; two dunning-email test fixtures required correction to model live email behavior after test-mode suppression was added by the preceding release. The focused retest passed both, plus the two test-mode suppression tests. Total unique database cases covered: 292. Original failure and focused passing logs are retained.
- Live smoke checks: 23 passed.
- Member navigation: 30 link selections at 320, 390, 768, 1440 and 1920 pixels; exact destination headings, no manual refresh, no overflow/page errors. Transient missing module recovers with one automatic reload; persistent failure shows a retry screen without looping. A pre-release browser tab loaded an unvisited Events module successfully after deployment without a document reload.
- Course grant/revoke: real admin Contacts action updates the existing member library on return; reload persists the grant and revocation removes it. No page errors. See sibling `sheet-course-access-20260919/after.json`.
- Contacts: real contact 76 shows both community names in list/profile and appears under the community filter at 390/1440 pixels; no overflow/page errors. See sibling `bugs-20260919/final-merged-release/contacts-live.json`.
- Prices: all 14 catalog price labels agree with configured amounts; verified on five catalog widths, all 14 detail pages, and five monthly-checkout widths. Profile to Profit checkout shows $50 per month, two installments, $100 total. No payment submitted. `prices-live.json` records the three source-verification exceptions.

Notification, curriculum and final cleanup evidence are recorded in `community-course-verification.md`; Sheet readback is recorded in `sheet-readback.json` once complete.

The final combined release preserves the latest authorized payment/refund changes and every production fix from this task. `release-integrity.json` compares the production file hashes. After a concurrent release briefly replaced the initial build, affected Sheet statuses were returned to No until the combined release passed fresh live checks.

Final Sheet readback confirmed `Bugs!C10:C14` are all `Yes`; row 15 remains unchanged. Original status-cell formatting and neighboring data were preserved. Root and agent fixtures were removed with zero identity, session, membership, notification, welcome-job and synthetic-course residuals; cleanup readbacks are retained. Final health still reported the combined release after cleanup.
