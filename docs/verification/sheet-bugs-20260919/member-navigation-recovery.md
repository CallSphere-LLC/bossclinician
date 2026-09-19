# Bugs sheet row 14: member navigation

Existing route recovery implementation was tested live with fresh isolated member sessions. No additional product change was required for these fault scenarios.

`verify-member-chunk-recovery.cjs` injects browser-local 404 responses for the previously unvisited Events lazy module. It changes no production data:

- Transient missing module: one blocked JS request; exactly one automatic document reload; `Your events` rendered. No browser page errors.
- Persistent missing module: two blocked JS requests (initial + automatic retry); exactly one automatic document reload; usable `This page couldn’t load` screen with `Try again`. No automatic reload loop during observation. Once the fault was removed, clicking `Try again` loaded `Your events`. No browser page errors.

Results and screenshots: `member-chunk-recovery.json`, `member-persistent-chunk-error.png`, `member-chunk-transient-recovered.png`, `member-chunk-persistent-recovered.png`.

An initial attempt reused another context's saved member refresh cookie. Its automatic reload was unable to authenticate; that harness attempt is excluded from product conclusions. All passing checks use a fresh independent login.

The root's responsive navigation suite covers 30 link clicks across widths 320/390/768/1440/1920 (`member-navigation.json`). A separate browser tab was opened before deployment, on Library, with the Events module confirmed unrequested. `verify-member-old-tab.cjs` retains this exact document until the release-ready signal, then checks that an Events link click fetches the old lazy module successfully and renders the page. Final across-release evidence is written only after that test actually completes.

Across-release verification passed at 22:43:03 UTC after release `20260919-sheet-bugs-2240`. The tab opened at 22:41:17 retained its old `index-Diuqn3Ku.js` document; current server HTML references `index-BFuhoBVq.js`. Clicking the previously unvisited Events route fetched `Events-xUYaIMF1.js` with HTTP 200, rendered `Your events`, and produced no page errors. The document was unchanged (no user or automatic reload). See `member-old-tab-after-release.json` and `member-old-tab-after-release.png`.
