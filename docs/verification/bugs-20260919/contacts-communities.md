# Bugs sheet row 13: Contacts community visibility

Reproduced against live admin at 390px and 1440px: contact 76 had no communities property in its API response and no communities column. Read-only database inspection confirmed member 64 belongs to both `unicorn community` and `The Boss`, with neither membership banned.

Implemented membership details on contact list and profile, including member/moderator/admin, banned, and inactive-account labels. Added Everyone / Community members dropdown. Its filter uses the same account association rules as the returned membership records, combines with existing search/status/tag filters, and includes legacy email-only account links without attaching accounts already linked to someone else. Filtering does not duplicate contacts for multiple memberships. Membership labels describe recorded membership, not paid entitlement.

Validation:
- Backend and frontend TypeScript checks passed.
- Isolated PostgreSQL integration suite passed 2/2 tests: list/detail memberships, explicit link despite changed email, multiple memberships counted once, legacy email links, banned memberships excluded from the community filter, search composition and invalid-query rejection.
- Playwright fixture browser tests passed at 390px and 1440px: both names visible in list/profile, dropdown issues the community filter and preserves it in the URL, no page errors or document overflow.
- Before screenshots and fixture screenshots/JSON are in this directory.

Live verification after deployment (GET/browser reads only):

```sh
BOSS_CONTACTS_LIVE=1 node scripts/verify-contact-communities.mjs
```

Defaults to `/tmp/boss-sheet-admin-state.json`; override with `BOSS_ADMIN_STATE` if needed. This live check asserts contact 76 appears after filtering and both actual community names remain visible in its profile. A passing fixture check alone is not a deployed verification.

Live release verification completed 2026-09-19 after release `20260919-sheet-bugs-2240`. Fresh independent admin logins at 390px and 1440px confirmed actual contact 76 shows `unicorn community` and `The Boss` in the list and profile. The Community members filter returned contact 76. No page errors or document overflow. Evidence: `contacts-live.json`, `contacts-live-390.png`, `contacts-live-1440.png`, `contact-detail-live-390.png`, `contact-detail-live-1440.png`.

Final merged release readback: health returned exact `20260919-sheet-merged-2246` at 22:48:25 UTC. Fresh independent admin browser sessions reverified both actual community names, Community members filtering, and profile membership display at 390px/1440px, without page errors or document overflow. Evidence is preserved separately under `final-merged-release/contacts-live.json` and its screenshots. Credentials were preserved and browser contexts closed.
