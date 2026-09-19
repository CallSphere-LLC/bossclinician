# Owner-approved prices and seven-day installments — September 19, 2026

These prices were supplied directly by the owner in this conversation and supersede the missing-price status in the earlier native-courses report. Currency: USD.

| Course | Configured price |
|---|---|
| Directory Makeover Audit | One profile $67; two $97; three $147 |
| Credential with Confidence | $47 |
| Marketing Mastery for Therapists | $67, regular price $147 |
| Therapist Niche Clarity Accelerator | $47 |
| Rate Negotiation Letter Template | $7 |
| Prepare to Profit Journal | $17 |
| Client Consultation Call Script | $37 outright, or $24 now and $24 after seven days; $48 total |

Migrations 070 and 071 record the prices and option. The monthly draft was canceled before deployment when the owner specified seven days. The installment option uses `interval=week`, `interval_count=1`, `installment_count=2`. Checkout and course text disclose the total and timing. The pay-in-full price remains $37.

Credential with Confidence and Client Consultation Call Script are now purchasable using their recovered original materials. Along with Fully Booked Toolkit and From Profile to Profit, four courses are ready. The other ten still lack original materials or fulfillment setup. Directory Audit has only a pre-existing test lesson; its approved tiers are saved and public prices displayed, but the offer remains draft until its real audit fulfillment is configured. No source materials were invented or pre-existing test lessons changed.

## Bugs found and fixed through verification

- The billing webhook read the base offer's schedule even when the buyer chose an alternative installment option. It now reads the pricing option linked to the order. A database-backed regression failed before the fix and passed after: two $24 installments seven days apart, completed after the second invoice, with no double credit from a replay.
- The server-rendered course loader lacked offer readiness and legacy download associations. Direct URLs could omit Buy buttons even though client navigation worked. Both now use `loadPublicCourseOffers`, with integration coverage comparing API and SSR results for ready downloads, empty courses, and published courses.
- Sandbox purchase email suppression did not cover installment-completion email. One completion message to the temporary `example.test` address was accepted by SES during testing. Stripe webhook email and marketing side effects now share a test-mode guard. Unit tests confirm sandbox suppression and unchanged live-mode delivery behavior. The app remains in Stripe test mode.
- A transient preview-service timeout caused an automatic release rollback. Cutover health checks now retry transient network errors while still requiring the exact release ID.

## Verification evidence

- Real sandbox card payments succeeded for Credential with Confidence ($47), Client Consultation Call Script ($37), and its first installment ($24). Purchased library access was verified.
- Stripe's actual subscription price was $24/week, the next payment was exactly 604,800 seconds later, and a cancellation timestamp bounded the plan to two installments. The app's persisted schedule also had precisely seven days between due dates.
- The sandbox key cannot create test clocks (HTTP 403). Resetting this test subscription's billing anchor did not generate another invoice. A separate $24 invoice attached to the exact test subscription was paid early to exercise real Stripe invoice webhook fulfillment. The app completed the plan at two payments/$48. This does not claim seven real days elapsed or an automatically timed renewal was observed. See `weekly-renewal.json`.
- 35 direct course page checks passed: seven prices at 320, 390, 768, 1440 and 1920px. Five additional checkout widths passed with the seven-day option selected. Ready courses had Buy buttons; incomplete courses did not; no horizontal overflow or page errors. See `prices-responsive.json` and screenshots.
- Fourteen affected integration cases passed (eleven Stripe webhook, three download/course readiness), including direct-load/API parity. Three SSR unit tests and two sandbox-side-effect unit tests passed. Backend production build/type checking passed.

The verification scripts require a temporary test identity in `/tmp`. Credentials, session cookies, secret keys and client secrets are excluded from this directory.

Installment refund cleanup exposed another mapping issue: Stripe's invoice webhook omitted its unexpanded payment list, leaving ledger payment IDs empty. Invoice settlement now resolves the paid invoice payment IDs through Stripe before writing the ledger. Refund reconciliation also repairs older installment rows using their exact invoice/transaction relationship. The integration regression covers real-ID storage, legacy lookup and refund replay idempotency.

When Stripe omits its itemized refund list, reconciliation now subtracts refunds already recorded for the specific payment transaction, rather than the whole order. The regression refunds both equal-value installments and replays an event: the order records exactly $48 refunded. This prevents a refund on installment one from hiding the equal refund on installment two.

The member billing page was checked in a freshly authenticated browser: it showed the plan paid in full after the second test payment, and the order receipt downloaded as a valid PDF. All four test charges were refunded at Stripe, the test subscription was canceled, and its exact test customer deleted. No new billing email was recorded after the sandbox side-effect guard was deployed.

## Final release and cleanup

Release `20260919224537-99df2fc` is live, source SHA-256 `aad91bb4c25f137a9916ff21e715e594535171f2f0104fcb969b27e1622881c6`. It was built from an isolated worktree to exclude concurrent contacts/community/library work. See `release-scope.json`.

The final deployed release passed the direct course Buy-button and seven-day checkout flow at all five widths, with no page errors or overflow. See `final-release.json`. Both real sandbox installment refund events were replayed successfully: the app recorded exactly $48 refunded and the order became refunded. No additional billing email was created by those replays.

The temporary member, contact, three orders, one plan and its installments, invoices, transactions, refunds, access grants, test sessions and related job records were removed. All four sandbox charges were refunded, the subscription canceled and its customer deleted. Both pre-existing orders were preserved. See `app-cleanup.txt`, `provider-cleanup.json` and `installment-refund-reconciliation.json`.
