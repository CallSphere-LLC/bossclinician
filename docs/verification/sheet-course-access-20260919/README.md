# Bugs sheet row 12: granted course missing from member library

Live reproduction used separate disposable admin/member accounts, then the actual admin Contacts detail Grant an offer dialog for Directory Makeover Audit (offer 32). The member had already opened their library. Returning to that tab after successful grant left the course missing; reloading displayed it. The entitlement was persisted correctly; the mounted library never refreshed.

Before evidence: `before.json`, `before-return.png`.

Change: `frontend/src/pages/member/Library.tsx` refreshes the library when its window regains focus, the document becomes visible, or the browser restores the page. A request sequence guard discards out-of-order responses and the effect removes listeners on unmount. Existing content remains visible while refreshing.

Validation: frontend TypeScript check passed. `verify-access.cjs` exercises admin grant and revoke against the real member library. The script uses disposable credentials outside the repository. Set `AFTER=1` to require both grant and revocation to appear on return without reloading; successful post-deploy verification creates `after.json`.

Final merged live release `20260919-sheet-merged-2246` passed grant return, reload persistence, and revocation return with zero browser page errors. The published Directory Makeover Audit lesson opened, its outline arrow moved 2px on hover, and reduced-motion disabled that translation. Evidence: `after.json`, `after-return.png`, `after-revoke.png`, `course-outline-hover.png`. Disposable member, contact, admin, audit/email records were removed; `cleanup.json` confirms zero remaining identities, grants, or sessions. The final cleanup removed the fresh verification fixtures and the full residual scan checked 96 email/member/contact/admin columns with zero matches.

# Original price-source verification

Read-only browser checks on September 19, 2026:

- `https://www.bossclinician.com/credentialwithconfidencekit` returns HTTP 200 but is a post-purchase download/thank-you page and contains no price.
- `https://www.bossclinician.com/offers/wMz5RNgn/checkout` (Therapist Niche Clarity Accelerator) returns Cloudflare HTTP 403 in the browser.
- `https://www.bossclinician.com/offers/JfvDGdjF/checkout` (Prepare to Profit journal) returns Cloudflare HTTP 403 in the browser.

Screenshots, rendered text, and response details are in this directory. The web retrieval tool could render the latter two marketing descriptions but exposed no checkout price. Therefore these checks do not independently substantiate the existing $47/$47/$17 prices. No checkout was submitted.
