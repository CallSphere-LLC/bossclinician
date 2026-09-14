# Products and Checkout — staging verification

Verified on **12 September 2026**, at **https://bossclinician.callsphere.site**. Lanes ran in parallel within the available agent slots; the final verification ran alone. The implementation is deployed and healthy. **This is not a claim that the whole catalogue migration or real-money payment acceptance is complete.**

The remaining dependencies are the imported download files, confirmation of one ambiguous product match, an authenticated Kajabi session, and a wallet-equipped device/payment test environment. The connected Stripe account is live; no real charge was made.

## Acceptance results

| Lane / test | Result | Evidence and limits |
| --- | --- | --- |
| 1 — Download administration | **PASS** | Created a download through `/admin/downloads`, selected an existing protected media file, edited instructions, selected a cover, saved and reloaded. An unused download was deleted through the UI and its absence checked after reload. [Editor](verification/products-checkout-20260912/download-admin-edited.png), [cover](verification/products-checkout-20260912/download-cover.png). |
| 1 — Offer → purchase → buyer delivery | **PASS for free checkout; charged checkout BLOCKED** | New download product 30 attached to offer 8; actual checkout created paid $0 order 10. Buyer saw instructions after reload, retrieved the exact 28-byte file twice with HTTP 200; another member received 404. [Buyer library](verification/products-checkout-20260912/download-library.png). Paid processing was exercised in isolated integration tests with Stripe mocked. |
| 1 — Imported catalogue correction | **PARTIAL / BLOCKED for full migration** | Six exact matches converted in place; details below. Seven downloads now appear in Products and eleven courses remain. Imported source files are absent. [Clean Downloads page](verification/products-checkout-20260912/downloads-clean.png). |
| 2 — New product entry point | **PASS** | All six cards opened their creation flow on the deployed site: Course, Community, Coaching, Podcast, Newsletter and Download. Picker checked at 1280px and 1440px; zero browser errors. [Results](verification/products-checkout-20260912/lane2-live-results.json). |
| 3 — Capture and reminder delivery | **PASS** | Entered an approved email on the actual ZZ checkout and blurred the field. Aged only that test cart, then ran the real worker. Reminder arrived in Gmail; message ID `1a096d1ddfc7aac4`. Config is **global**, with editable recipients, subjects, bodies and delays; defaults are 1/6/10/24 hours. |
| 3 — Stop and recovered revenue | **PASS for controlled settlement; real paid acceptance BLOCKED** | Followed the received signed link: HTTP 303 to checkout. A controlled $27 settlement called normal fulfillment, attributed order 12 to reminder 1, set `stop_reason=purchased`, and rejected the next reminder as “already bought or stopped.” Report displayed **$27 / one recovered cart** after reload. This was not a Stripe payment. [Report screenshot](verification/products-checkout-20260912/recovery-report.png), [report data](verification/products-checkout-20260912/customizer-result.json). |
| 3 — Unsubscribes and suppression | **PASS** | Separate live approved-address fixtures produced `suppressed`; both retained `emails_sent=0`, with reasons `contact is opted_out` and `suppressed (manual)`. [Results](verification/products-checkout-20260912/suppression-result.json). |
| 4 — Lesson quiz and survey | **PASS** | Native member form: wrong answer scored 0%, kept the next lesson locked; correct answer scored 100% and unlocked it. Both attempts persisted after reload. Survey exercised single choice, multiple choice, scale and text, with no pass mark. Admin viewed saved answers after reload. Also created a quiz and survey from the course lesson editor, saved and reloaded their links, and changed the quiz pass mark to 80 with persistence confirmed. [Authoring evidence](verification/products-checkout-20260912/authoring-result.json). [Failed quiz](verification/products-checkout-20260912/lesson-fail.png), [survey](verification/products-checkout-20260912/lesson-survey.png), [admin results](verification/products-checkout-20260912/lesson-admin-result.json). |
| 4 — Automation actions and access rules | **PASS** | Actual worker ran the completion automation twice and pass automation once, all `success`; the buyer received `zz-lane4-completed` and `zz-lane4-passed` tags. Database tests also exercised missing/draft assessments, stranger access, manual-completion bypass refusal and surveys producing no pass event. |
| 5a — Wallet setup | **Configuration PASS; wallet transaction BLOCKED** | Stripe domain `pmd_1UEvEzFXM7aVDtPLgBxJpe1f` reports Apple Pay and Google Pay active. Express Checkout renders. Fixed the live `payment=()` header; browser now reports payment allowed for this site and Stripe frames. [Browser evidence](verification/products-checkout-20260912/wallet-browser.json). No configured Apple/Google wallet was available. Klarna, Afterpay and PayPal were not separately enabled or tested. |
| 5b — Multiple offers, coupon and add-on | **PASS for $0 checkout; charged cart BLOCKED** | Added $27/$47/$97 offers, reloaded the three-item basket, added a $10 bump: **$181 subtotal**. A 100% code produced $0 and actual order 11 with four lines, no PaymentIntent, and four recipient grants. Server tests also verified a $10 fixed discount applies once, resulting in $161, and refused forged totals, mixed currencies and duplicate selections. [Cart](verification/products-checkout-20260912/cart-discount.png), [order](verification/products-checkout-20260912/cart-result.json). |
| 5b — Upsell retained | **PASS for free upsell; card charge BLOCKED** | Found and fixed a $0 upsell incorrectly requiring a saved card. After deployment, accepting it created paid order 15 under cart order 11 and granted the gift recipient access. Repeat-click idempotency passed in database tests. [Result](verification/products-checkout-20260912/upsell-result.json). |
| 6a — Checkout customizer | **PASS** | Saved background, label colour, outline and 24px radius; reload retained them. Both previews and actual Cart/Checkout used the same styles. Changing the radius to 32px updated both previews immediately without saving. Original settings restored. [Preview](verification/products-checkout-20260912/checkout-customizer.png). |
| 6b — Gifting | **PASS for $0 purchase** | Order 11 belongs to payer member 56; four grants belong to recipient 58. Payer received 404 for those recipient-only downloads. Gift instructions survived reload; the later upsell also went to recipient 58. Gift email delivered with the optional message, but **Gmail classified it as Spam**. Message ID `1a096d29a9182ebe`. [Recipient library](verification/products-checkout-20260912/gift-library.png), [access checks](verification/products-checkout-20260912/gift-access.json). |
| 6c — Offer editor hang | **ALREADY FIXED under tested conditions / not reproduced** | Before changes: six same-tab loads 440/62/54/50/55/54ms, full catalogue and six tabs. After cleanup: 61/56/54/53/54/51ms, all six tabs and 18 picker options. No renderer freeze. No speculative virtualization was introduced. These runs cannot rule out every intermittent cause. [Final timings](verification/products-checkout-20260912/post-clean.json). |

Cart supports up to 20 distinct one-time/free offers. Recurring, installment and pay-what-you-want offers keep their individual checkout. A cart uses its first offer’s upsell sequence, excluding items already in the basket. These are explicit current boundaries.

Stripe only displays wallet buttons when the browser, device and account qualify; domain registration alone does not prove a wallet payment. [Stripe Express Checkout documentation](https://docs.stripe.com/elements/express-checkout-element).

## Exact migration

The owner-supplied Kajabi list was the classification evidence; no Kajabi records were written. Each row retains its **original product ID**. `course_id` becomes null and its old value is retained in `legacy_course_id`; legacy course rows remain. `product_type_migration_audit` records the before/after state and relationships.

| Product ID | Title | Before | After | Retained legacy course ID |
| --- | --- | --- | --- | --- |
| 2 | FULLY BOOKED TOOLKIT | Course | Download | 2 |
| 7 | THERAPIST NICHE CLARITY ACCELERATOR | Course | Download | 10 |
| 9 | FROM PROFILE TO PROFIT | Course | Download | 14 |
| 14 | PROVIDER PARTNERSHIP GUIDE | Course | Download | 7 |
| 15 | MARKETING MASTERY FOR THERAPISTS | Course | Download | 9 |
| 17 | CLIENT CONSULTATION CALL SCRIPT | Course | Download | 13 |

All six had **zero attached offers and zero access grants before conversion**, and still do. There were no purchases on those six records to exercise preservation against; identity and relationship preservation were checked, and the existing receipt regression passed. No purchases were moved or recreated.

**Deferred:** product 16/course 12 is named “PREPARE TO PROFIT JOURNAL,” which is not an exact match to “Prepare to Profit.” **Absent:** “The Private Practice Planner” and “Supervisory Billing Documentation Packet.” All 18 pre-existing products had zero attached product files; the media library did not contain the imported download source assets. Those assets must be supplied or accessed before imported delivery can be called complete.

## Lane 7 — status only

| Item | Current status |
| --- | --- |
| Example.com fixtures | No matches in seed code, scripts or migrations. Remaining test references exercise refusal or mocked transport. Staging send guard is active. The live suppression table was empty at baseline: **neither `zz-final@example.com` nor `zz-turn@example.com` remains**. No Lane 7 fix was made. |
| Messages empty state | **ALREADY FIXED**, exercised with an open thread containing no messages. The selected conversation appeared on the left; no contradictory “No conversations yet.” Reload retained the correct state. [Screenshot](verification/products-checkout-20260912/dm-empty-verified.png). |
| Funnel blueprints | **ALREADY FIXED**, all four actual blueprint endpoints exercised and re-read: opt-in 3 stages/1 email, webinar 4/3, sales 3/1, launch 4/4. Each created form/tag/sequence links. Unpublished ZZ fixtures were removed; nothing was enrolled or sent. |
| Global custom-field library | **Still missing.** Form definitions and offer custom fields remain separate JSON; segments do not expose a reusable field-definition library. |
| Kajabi global Form settings | **BLOCKED for fresh comparison.** Site 2148299891 redirected to login and Cloudflare blocked access, Ray `a3a0cd1c1b90a29e`. Historical repository audit records standard identity/address/business fields and about 45 reusable custom fields. That is historical, not current verified Kajabi evidence. The app has Settings → Forms for honeypot/Turnstile configuration, but lacks that reusable field library. |

## Regression and final environment

- **Email:** explicitly sent and opened “Your email settings are working” to `sagar+zz-products-mail@callsphere.ai`. Gmail message `1a096d2c6685b77e` confirms **SPF, DKIM and DMARC pass**, from `Yvette at Boss Clinician <yvette@bossclinician.callsphere.site>`. [Headers and body](verification/products-checkout-20260912/mail-regression.json).
- **Receipt 9:** HTTP 200, `application/pdf`, `%PDF-`, 2,560 bytes, `Content-Disposition: attachment; filename="receipt-R-2026-00009.pdf"`. Another authenticated member received 404. Owner access still passed after cleanup.
- **Payments settings:** billing portal, Stripe retry/dunning copy, trial and payment reminders remain visible. Cancellation editor retains stable report keys `too_expensive`, `not_using`, `found_alternative`, `other`.
- **Offer tabs:** What you’re selling, Price, Order form, Order bumps, Upsells, After purchase all remain.
- **Marketing:** headline equals source breakdown; final clean state is 3 sent = 1 broadcast + 2 sequence + 0 automation, and 0 not sent = 0 + 0 + 0.
- **DM:** two distinct members exchanged messages; both APIs returned both messages and the browser displayed the reply after reload. [Regression evidence](verification/products-checkout-20260912/regression.json).
- **Width regression:** initial sweep reproduced overflow on eight destinations. Fixed shared table sizing, long-content wrapping and action layout. Final **44 destinations × 2 real viewports = 88 passes**, no controls outside the viewport and no browser errors. [Before](verification/products-checkout-20260912/admin-lists-before.json), [after](verification/products-checkout-20260912/admin-lists.json).
- **Checks:** both TypeScript checks; 928 backend tests and 182 frontend tests; 90 database integration checks; 16 affected database checks re-run after the free-upsell fix; 21/21 deployment smoke checks. Tests that mock Stripe are not payment-provider acceptance evidence.
- **Release:** backend image `190478a782f607204a189fd3eb653eff03d752e8bd51e686daf554cbff29389a`; frontend `6830727f8d3cf6c69f10ddb8860374f0c1d186085718d3a103adfa7a0df9c62d`. Both healthy. Nginx syntax checked and live wallet policy verified.

Connected [Figma design](https://www.figma.com/design/rPPdw73COMRMvUULCKJlvv) contains the product picker, cart and checkout preview design.

## Cleanup and owner decision

Removed this run’s ZZ orders, transactions, invoices, grants, offers, products, coupon, course/assessments, community/messages, members/contacts, automations/tags, reminder rows, suppression fixtures and related jobs/email rows. Deleted the uploaded protected test file and the additional authoring course/assessments (course 41, assessments 8/9). Restored checkout and reminder settings. Rebuilt reporting: the synthetic $27 is gone; recovery is back to **$0 / zero test carts**. Baseline **8 contacts / 4 members** remains. [Cleanup](verification/products-checkout-20260912/cleanup-result.json), [clean state](verification/products-checkout-20260912/clean-state.json).

The admin audit trail is retained. Already-delivered test emails and provider copies cannot be recalled; the gift test email landed in Spam. No actual Stripe charge was created. Stripe’s intended payment-domain registration and the six product conversions remain.

**Account owner decision required:** the supplied Kajabi count is 403 contacts, versus 8 currently in this staging database. Migration remains outstanding. Decide email matching, duplicate merging, unsubscribe precedence, and tag/purchase-history reconciliation before importing. No contact import was attempted.
