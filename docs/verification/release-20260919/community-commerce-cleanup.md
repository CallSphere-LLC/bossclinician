# Community commerce fixture cleanup

After the browser verifier removed QA community 9 and access groups 7/8, the exact generated products were identified from the validated pre-cutover database backup:

| Offer | Product | Slug | Verified title |
| --- | --- | --- | --- |
| 16 | 39 | community-9-group-7 | QA Release Community 20260919 — QA Free |
| 17 | 40 | community-9-group-8 | QA Release Community 20260919 — QA Monthly |

Products 39/40 and their offer-product links had already cascaded away with community deletion. Offers 16/17 remained archived; neither had a Stripe product or price identifier. There were no dependent offer-pricing-option rows.

A guarded transaction locked the two offers, asserted their exact IDs, slugs, titles and archived status, and checked all 34 foreign-key reference columns targeting offers/products. Every check returned zero, including orders, order items, order totals, access grants, subscriptions, payment plans and plan entitlements. The transaction deleted only offers 16/17.

Post-commit readback: offers = 0, products = 0, pricing options = 0, offer-product links = 0 for those exact fixture IDs. No provider-side product, price or charge was created or deleted. This cleanup did not touch QA admins 21/22, members 65/66, lead 22, voice sessions or native-call community 8.
