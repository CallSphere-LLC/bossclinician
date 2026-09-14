# Lane 5 — Wallets and a multi-item cart

## Reproduced before fixing

- Existing checkout already rendered Stripe Payment Element with `wallets: { applePay: 'auto', googlePay: 'auto' }` and created PaymentIntents with dynamic payment methods. The missing live setup was concrete: reading the configured account's payment method domains returned **tidycal.com, checkout.stripe.com, buy.stripe.com only**. `bossclinician.callsphere.site` was absent.
- Live `POST /api/cart/quote` returned **404**, body `{"error":"Not found","path":"/api/cart/quote"}`. There was no cart page, stored basket or combined checkout. Existing offer checkout handled only one offer plus its bumps.

## Wallet work (done first)

Registered **bossclinician.callsphere.site** with the existing Stripe account. Read-after-create result:

- Domain id: `pmd_1UEvEzFXM7aVDtPLgBxJpe1f`
- `enabled: true`
- Apple Pay: `active`
- Google Pay: `active`

No customer charge, intent or subscription was created by this configuration action. The account uses a live secret.

Added Stripe Express Checkout Element above the existing Payment Element. Both reuse the existing amount/currency, order creation, gift fields, validation, terms and confirmation path. Wallet buttons appear only when Stripe determines that the browser/device/account supports the method. Invalid fields or missing required terms reject the wallet sheet before payment. Dynamic payment methods remain enabled.

Used the Stripe best-practices skill and official documentation: https://docs.stripe.com/elements/express-checkout-element/accept-a-payment?payment-ui=elements and https://docs.stripe.com/payments/payment-methods/pmd-registration . Retained the application's pinned SDK/API version because upgrading unrelated billing/webhook payload handling is outside this change.

**Not claimed verified:** payment with a real Apple Wallet/Google Pay account. This environment has no configured device wallet or Stripe test secret, and no live charge was attempted. Klarna/Afterpay/PayPal have not been separately enabled or transaction-tested; any dynamic method Stripe already enables remains available according to Stripe eligibility.

## Cart implementation

- New **/cart** page: persistent local basket (up to 20 distinct offer slugs), published one-time/free offer catalogue, add/remove, subtotal, discount and total, add-ons by offer, then one checkout.
- Existing one-time checkout has **Add to cart** and **View cart** links. The selected pricing option and selected bumps travel into the basket.
- Cart and Checkout use the same checkout button customizer settings. Both honor the discount-code visibility setting. The applied code carries into checkout.
- Server recalculates all prices, discount scope, coupon capacity and per-offer tax. Fixed discounts apply once across eligible items, allocated in integer cents; offer-scoped coupons only discount eligible offers. Cross-currency baskets, duplicate offer selections, invalid add-ons and add-ons already included by another item are refused.
- A single pending order and single PaymentIntent cover all items. All offer lines retain their real `offer_id`. Fulfillment grants each purchased offer plus bumps; gifts grant all of that access to the recipient while the payer keeps the receipt. Full refund revocation is by order, including gift recipients (Lane 6 integration).
- Every offer's required phone/address/terms/custom fields is enforced. Custom fields are namespaced by offer id and checkout renders all of them with the offer title. Required terms links are listed separately. Gifting is available only if every offer permits it.
- Cart checkout keeps the first offer's post-purchase upsell sequence, excluding upsell targets already in the cart. Existing single-offer checkout/upsell behavior remains available. Recurring, instalment and pay-what-you-want offers use their individual checkout; the cart explicitly accepts one-time/free price options only.
- Migration **055_multi_offer_cart.sql** adds an `is_cart` flag and per-offer order totals. Recovery is stopped for every purchased offer, and recovered revenue uses its allocated per-offer total rather than counting the full combined order for each captured email.

## Local evidence

`./backend/scripts/test-integration.sh src/services/cart.integration.test.ts`: **5/5 PASS**, 3.45 seconds. Scratch migrated Postgres database dropped after tests. Stripe and purchase delivery are mocked; no external charge/email.

The integration suite verifies:

1. Three offers priced at $27/$47/$97 ignore a forged one-cent client total; a $10 fixed coupon produces exactly **$161.00**, one PaymentIntent and three grants.
2. Three offers plus an add-on with a 100% coupon settle as paid with **no Stripe call**, and all four products belong to the gift recipient.
3. Scoped coupons, mixed-currency refusal and duplicate-selection refusal.
4. Per-item required custom fields, terms and phone, and rejection of an add-on already included in the cart.
5. Two abandoned offers recovered in one discounted order report exactly **6400 cents**, not two copies of the full payment.

Backend and frontend TypeScript checks passed during implementation. Lane 3 integration regression is rerun after cart integration.

## Live Lane V contract

1. Create three `ZZ` published one-time offers, each with a real downloadable product, and an active global coupon with `percent_off=100`.
2. Add all three on `/cart`, reload and confirm basket persistence; apply the coupon; continue; fill required fields; complete using only an approved `sagar+...@callsphere.ai` test recipient.
3. Confirm no PaymentIntent was created, all offers appear on one paid order and all purchased downloads are in the recipient library. Reload and re-download. Check gift/add-on variants as needed.
4. Checkout API remains `POST /api/checkout/offer/<first-slug>`, with normal email/name/gift/address/customFields/acceptedTerms plus:

```json
{
  "pricingOptionId": null,
  "cartItems": [
    {"slug":"zz-first","pricingOptionId":null,"bumpProductIds":[]},
    {"slug":"zz-second","pricingOptionId":null},
    {"slug":"zz-third","pricingOptionId":null}
  ],
  "couponCode":"ZZFREE"
}
```

Quote: `POST /api/cart/quote` with `cartItems`, optional `couponCode` and optional `address`. Catalogue: `GET /api/cart/catalog`.

Clean up only newly created fixture offers/products, members/contacts, orders/grants, coupon/redemption and email/job/report rows. The Stripe domain registration is intentional application configuration and should remain. No staging test data was created by this implementation lane.
