# Native courses and Stripe test checkout — 2026-09-19

All 14 published course cards now open native `/courses/:slug` pages. No course-card checkout redirects to the original site. Course details, offer checkout, confirmation, purchased resources, receipts and lesson playback use this app.

## Available source content

Seven prices were verified against original public landing pages; `verified-prices.json` records their sources. Original PDFs and two training videos were recovered from links in the owner's original course delivery material and imported into protected storage. `imported-assets.json` records byte lengths, hashes and video durations. `import-original-assets.py` records the import mapping.

Two offers are currently deliverable and purchasable: Fully Booked Toolkit ($67) and From Profile to Profit ($97). Credential with Confidence has two original training videos and two PDFs imported, but no verified price. The other published courses lack a verified price, deliverable materials, or both. `readiness.json` records all 14. No prices, lessons or files were invented. Five priced offers remain blocked at the server checkout until their materials exist; seven courses have no verified offer price. Consequently, full purchasing availability for all 14 courses is not complete.

## Stripe configuration

The app uses a separate Stripe test sandbox created through the official CLI. No real charges were made. Test keys and webhook signing secrets are stored in ignored environment/config files, never in this evidence directory. The sandbox must be claimed before September 26, 2026 to retain access. Test mode is shown on purchase screens, and purchase receipt/welcome/owner notification emails are suppressed; in-app receipts and access still work.

Stripe.js is deferred until checkout. Native course browsing generates zero Stripe script requests. Test-card confirmation, webhook fulfillment and signed file delivery were exercised against the deployed app, not mocked. A successful retry initially exposed a race: confirmation read the previous decline before the success webhook and stopped polling. Confirmation now continues bounded polling and only declares success from server-paid status. A separate browser regression deliberately returns two failed reads followed by paid.

## Verification

- 70 native course-card navigations: 14 courses at 320, 390, 768, 1440 and 1920 pixels, with no horizontal overflow or page errors.
- Stripe Payment Element loaded and fit all five widths. Zero Stripe scripts while browsing course pages.
- Successful Fully Booked test-card payment; purchases/library access; all three PDF downloads matched imported source SHA-256 hashes.
- Profile to Profit test card with insufficient funds, then successful valid-card retry on the same order. The final released confirmation behavior is recorded in `checkout-results.json`.
- Both original training videos played and sought to 1,200 seconds with HTTP 206 range responses. Two lesson PDFs matched source hashes. This used a temporary manual grant because the course price is unavailable; it is not a claim of purchase coverage for that course.
- Both paid order receipts rendered in the member UI and downloaded as PDFs. Anonymous library and receipt API requests returned 401; signed-out library navigation went to login.
- `fulfillment-results.json`, `payment-layout.json`, `course-navigation.json`, screenshots and scripts retain evidence. Scripts expect temporary credentials/state in `/tmp`, which are deliberately excluded from version control.
- Frontend unit suite: 378 passed. Backend unit run: 1,214 passed, with 286 database tests skipped in that run. The separate complete database integration run passed all 286 tests across 34 suites. After adding the empty-course readiness regression, the affected download-product suite passed all three tests (287 unique integration cases in total). Frontend/backend type checks and production builds passed. Three browser-asset retention tests passed.

See the sibling navigation-loading and blog-redesign directories for navigation, old-tab release recovery, 210 direct route/size checks, blog responsive evidence and the connected Figma design.

## Final release and cleanup

Final live release: `20260919202209-99df2fc`, source SHA-256 `4d89046c9bce946149d53f54e2409e19650c638fe46a276971db1cad4629c770`. The real declined-card/valid-card retry passed on final order 20, with a successful confirmation and source-matching download. Its HTML receipt and PDF also passed. The controlled failed-to-paid polling regression passed against both the local build and this live release.

All three successful sandbox payments were refunded, both other test intents canceled, and the exact sandbox customer deleted. Refund webhooks processed successfully and revoked the purchased access. The temporary member, contact, five test orders, receipts, ledger entries, progress, download logs and 36 test sessions were deleted. Both pre-existing orders were preserved. No purchase emails were sent to the temporary member. Provider test history and processed webhook deduplication records remain as audit evidence. See `provider-test-cleanup.json` and `app-test-cleanup.txt`.

The final deployed build also passed blog to header menu to native course to Stripe test checkout at 320, 390, 768, 1440 and 1920 pixels, with no page errors or horizontal overflow. The deleted test account's old refresh session returned 401. See `final-release-smoke.json`.
