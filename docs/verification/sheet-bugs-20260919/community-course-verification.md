# Bugs sheet rows 10 and 11 — 2026-09-19

**Final result: PASS on live release `20260919-sheet-merged-2246`, verified 22:49 UTC.** Community bell persistence and admin curriculum flows were rerun successfully after the combined release. All eight fixture/scratch cleanup counts are zero. No outbound email was sent during verification.

## Community membership notices (row 10)

Reproduced before implementation with a real PostgreSQL integration test: concurrent admin membership adds both returned 201, but the recipient had zero notifications. The failing assertion expected `community_membership_added` and received `[]`.

The admin membership add now atomically inserts the membership, member-bell notification and `community.membershipWelcome` email job. Existing memberships keep the `source` that pays for them: a re-add overwrites it to `manual` only when the room is already shut to that member (`mayEnterCommunity` is false), and the role is left alone when the console sends none. Overwriting a `plan` or `purchase` membership with `manual` would have handed the member permanent access, because `services/access.ts` reads `manual` as an entitlement in its own right and so ignores the cancelled subscription or refund. Corrected 2026-09-19 after the earlier wording here recorded that overwrite as intended. The job resolves the current member/address, skips revoked/banned/inactive memberships, records delivery with the existing email provider, avoids repeating previously recorded sends and propagates provider failures to the durable retry queue. It is a transactional notice of access, separate from community digest subscriptions.

Checks:
- Backend typecheck passes.
- Full community admin PostgreSQL integration suite: 19/19 pass, including concurrent add deduplication and complete rollback if enqueueing fails.
- Welcome mail unit tests: 5/5 pass, including null CRM contact, inactive/deleted membership, completed-send retry, provider outage and malformed payload.
- Integration tests used isolated scratch databases, cleaned by the harness. No real email transport was invoked.

## Course arrow cleanup (row 11)

Browser screenshot `course-arrows-before.png` reproduces repeated reorder arrows in the admin curriculum. The updated curriculum places reorder and delete actions inside an accessible More menu. Lesson edit and unlocked member-outline links have a small trailing chevron that moves on hover/focus only when reduced motion is off. Mobile rows keep the lesson name and metadata readable above the action controls.

Local frontend with actual authenticated backend verification:
- Keyboard opening of More menu and disabled first-item Move up.
- Lesson reorder persisted in API and after page reload.
- Section reorder persisted in API and after page reload.
- Edit dialog opens from lesson control.
- Hover moves arrow; reduced-motion produces no transform.
- 390px menu works with no horizontal overflow; 1440px desktop screenshot captured.
- No browser page errors.
- Synthetic unpublished courses 43 and 44 and their sections/lessons were deleted after verification.
- Frontend typecheck passes.

Screenshots: `course-arrows-preview-1440.png`, `course-arrows-preview-390.png`.

Reusable verification scripts are `/tmp/boss-course-ui.cjs` (`LIVE=1` for deployed frontend) and `/tmp/boss-community-live.cjs` (synthetic suspended member, worker skip without outbound mail, then activate fixture to view bell; final cleanup).

## Initial live verification and concurrent deployment

On release `20260919-sheet-bugs-2240`, community membership notification was visible in the member `/community` bell, survived full reload and remained exactly one after repeated admin adds. The suspended test recipient's email job completed with an explicit skipped outcome and zero outbound emails. Fixtures member74/community11/membership34 were removed. JSON and screenshot are saved alongside this document.

The first live curriculum run passed all assertions. Concurrent admin logins invalidated the cleanup session; exact course45 was subsequently removed with an ID/slug guard. A final serialized rerun then found the More menu absent because live health had changed to an unrelated concurrent release, `20260919224326-99df2fc`. Course46 was automatically deleted. Root was notified to restore and reverify the sheet release before final completion.


## Final combined-release verification

Release `20260919-sheet-merged-2246` verified at 22:49 UTC:
- Community membership notification: exactly one after repeated adds, visible through the member bell and retained after full reload. Fixture member76/community12/membership36 removed. Worker finished with the expected skip for the suspended test recipient; no external email sent.
- Curriculum: keyboard More menu, boundary disabled state, persisted lesson/section reorder after reload, edit dialog, hover and reduced-motion arrows, 390px mobile menu/no overflow, no browser errors. Synthetic course47 removed via API.
- Member course outline arrow separately reverified by course-access agent: 2px hover translation, no transform with reduced-motion, no page errors. Evidence in `../sheet-course-access-20260919/after.json` and `course-outline-hover.png`.
- Cleanup: `community-course-cleanup.txt` reports zero synthetic courses, communities, members, contacts, mail logs, login attempts, welcome jobs and scratch databases.

Final artifacts: `community-notification-live.json`, `community-notification-live.log`, `community-notification-live.png`, `course-arrows-live.json`, `course-arrows-live.log`, `course-arrows-live-1440.png`, `course-arrows-live-390.png`.
