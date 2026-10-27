# BC-QA-199: Optional purchases inside a course

Implementation date: 2026-10-27 UTC. Base: production `38c34ee`.
Worktree: `/home/ubuntu/bc199-course-paywall`.
Status: implemented and tested in isolation; parent agent owns integration, deployment, Chrome verification and tracker completion.

## What changed

Course Builder > Offers now has a separate **Optional add-ons for students** panel. An administrator can choose a published offer, add a short description, set display order, edit or remove it. Up to twelve add-ons can be configured per course. This does not attach the course to the offer or grant the add-on to existing learners.

Course owners see **Optional add-ons** below the course home and each lesson. Each available item opens the existing `/checkout/<offer-slug>` flow with a **View purchase options** link. Prices, payment choices, terms and fulfillment remain owned by checkout. The component intentionally does not copy amounts into course content, so subsequent approved price or membership-policy changes do not leave stale prices here. The admin student preview shows the same section without creating member access.

Draft/archived offers and unpublished products are hidden. Offers with missing deliverable content show **Currently unavailable** and have no purchase link. A failed optional merchandising lookup returns an empty add-on list and cannot prevent owners from opening their course. Course ownership is checked before returning this content; the add-on remains inaccessible until separately purchased or otherwise legitimately granted.

Migration `170_course_addons.sql` adds the isolated configuration table and configures only these verified identities:

| Course | Offer | Existing checkout |
| --- | --- | --- |
| 52 / the-boss-move | 21 / Private Practice Protection Pack | `/checkout/private-practice-protection-pack` |
| 52 / the-boss-move | 40 / The Lounge | `/checkout/the-lounge` |

The seed checks both IDs and slugs, requires each offer to be published, preserves existing add-on descriptions/order on re-run and makes no billing, enrollment, publication or lesson changes. The Boss Move remains unpublished in the public catalog as currently configured; owners retain access.

## Paid 1:1 example

Read-only production inspection confirmed call types 3 (Profitable Practice Consultation) and 4 (The Practice Clarity Intensive) are listed but `bookable=false`. The public booking handler does not collect a payment, so a direct booking link would not be a verified paid purchase flow. Neither call was enabled, advertised as available or seeded as an add-on.

To offer a paid 1:1 through this feature, configure and verify the paid coaching product/offer and its delivery in the existing commerce/coaching system, publish the offer, then select it under the course's Optional add-ons panel. This feature accepts published coaching offers through the same checkout as other products. It does not introduce payment collection into public call booking.

## Validation

- Both backend and frontend TypeScript checks pass.
- New backend HTTP/database suite: 10 tests pass. It covers admin write permissions, rejected student writes, identity/text/order validation, published products, empty offers, the twelve-item limit, update/remove behavior, owner versus non-owner responses, no added entitlements, admin preview, missing deliverables, optional lookup failure isolation and migration re-run preservation.
- Existing course hub integration suite: 4 tests pass.
- Frontend: 4 new render tests plus 13 existing course hub tests pass. Covers empty state, separate-purchase language, canonical checkout links, unavailable/unsafe destinations and escaping administrator text.
- Client and SSR production builds pass. Existing bundle-size warnings remain.
- Impeccable detector reports no findings on the two new UI components.
- Test database was isolated in `bc199-addons-pg`; no production purchases, bookings, emails, grants, content changes or payment-provider writes were performed.
- This is not Chrome or real-payment proof. Parent must complete the checks below before marking the row live verified.

## Parent Chrome checks

1. After migration/deploy, open `/admin/courses/52?tab=offers` (or use the visible Offers tab) and confirm the separate optional-add-ons panel lists Pack and Lounge.
2. Open the course's **Preview as student**. On the home and a lesson, confirm the two optional cards are below the main content, the course outline remains usable, and links resolve to the existing checkouts. Do not submit a live purchase.
3. At desktop and 390px mobile widths, verify long titles wrap and controls remain accessible without horizontal scrolling.
4. If testing admin save/remove, use an isolated synthetic course; do not alter the owner's live configuration merely to demonstrate controls. Existing database tests already cover writes.
5. Keep the paid-call limitation explicit in the tracker response: the feature is supported; those two call types were not enabled or newly sold.

Suggested tracker comment after parent live verification: "Yes. Courses now support optional paid add-ons from Course Builder > Offers > Optional add-ons for students. Choose a published offer, description and display order; students see separate purchase cards on the course home and lessons. The Boss Move is configured with the existing Private Practice Protection Pack and Lounge checkouts, without changing purchased course access. Paid coaching offers can be added the same way once configured and verified. The two current paid call types are not online-bookable, so no unverified 1:1 purchase link was enabled."

## Changed files

- `backend/src/db/migrations/170_course_addons.sql`
- `backend/src/services/courseAddons.ts`
- `backend/src/routes/admin/courseAddons.ts`
- `backend/src/routes/admin/courseAddons.integration.test.ts`
- `backend/src/routes/admin/courseHub.ts`
- `backend/src/routes/admin/coursePreview.ts`
- `backend/src/routes/member/library.ts`
- `frontend/src/lib/libraryApi.ts`
- `frontend/src/components/player/CourseAddons.tsx`
- `frontend/src/components/player/CourseAddons.test.tsx`
- `frontend/src/pages/member/CoursePlayer.tsx`
- `frontend/src/pages/admin/course/CourseAddonsPanel.tsx`
- `frontend/src/pages/admin/course/CourseOffersTab.tsx`
- `frontend/src/pages/admin/course/courseHubApi.ts`

No edits to row 200's lesson form files or migration 169, or to Lounge billing migrations 165/171.
