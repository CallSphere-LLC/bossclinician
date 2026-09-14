# Lane 6 — checkout appearance, gifting, offer editor

## Reproduction before changes

- Live `/admin/offers/2`, Chromium 1228, 1440×1000, one tab reused for six full navigations. Time from navigation until all six tabs and the complete existing product picker were present: **440, 62, 54, 50, 55, 54 ms**. Picker held 18 options including its placeholder. No browser page errors. Evidence harness: `/tmp/boss-products-run/lane6-profile.mjs`; screenshot: `/tmp/boss-products-run/lane6-before.png`.
- **6c ALREADY FIXED for the measured acceptance condition.** The reported intermittent freeze did not reproduce. No speculative performance patch was made. Six successful visits cannot prove a rare intermittent problem impossible.
- Checkout settings schema exposed only brand colour, support email, terms URL and coupon toggle. The actual Checkout page did not consume these global settings. No preview existed.
- Offer/order schemas and checkout UI had no gifting fields.

## Changes

- Global Settings → Payments checkout card now includes button label colour, outline colour and radius (0–40 pixels), alongside background colour. Live side-by-side Cart/Checkout sample previews use the same `checkoutButtonStyle` helper as the real checkout.
- Checkout consumes these saved settings, support email, terms link and discount-code visibility. Cart implementation can reuse the helper.
- Offers → After purchase has a persistent allow-gifting switch, including create/update/clone and public offer API.
- Checkout offers recipient email and optional 2,000-character message for gifts. One-time/free/PWYW purchases supported; recurring subscriptions/payment plans explicitly rejected for gifts to preserve existing billing lifecycle semantics.
- Payer retains order/receipt ownership. Fulfillment resolves the recipient separately and grants the main products and bumps to the recipient only. Upsells inherit the recipient from their parent order. Full refunds revoke access by the originating order, including recipient grants.
- Gift email escapes the message, includes a new-account password link or existing-member library link, and uses a durable `purchase.gift` job for retries. Row locking and `gift_delivered_at` prevent duplicate sends in concurrent normal deliveries. As with email generally, a process dying after SMTP accepted but before the DB commit can still produce a retry duplicate.
- Migration: `056_checkout_gifting.sql`.

## Verification

- Frontend TypeScript check PASS.
- Backend TypeScript PASS on the final lane check after concurrent test typing corrections.
- `backend/scripts/test-integration.sh src/services/purchaseGift.integration.test.ts` PASS, 1 database-backed scenario against a fully migrated throwaway DB: payer ownership, recipient-only main+bump access, no duplicate fulfillment, queue insertion, failed-send retry, concurrent delivery dedupe, escaped gift message, password link, persisted delivery timestamp and full-refund revocation of both recipient grants. SMTP transport mocked; **this is not proof of real email receipt**. Scratch database dropped.
- New customizer persistence/browser styling and full gift checkout/email retrieval remain for Lane V after root deployment. No live paid charge attempted; Stripe runtime is live mode.
- No production/staging data created by this lane. Browser used root's temporary admin session. All integration data lived only in the dropped test DB.
