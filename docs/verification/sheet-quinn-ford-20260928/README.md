# Bug sheet, last 9/27 row (Quinn Ford) — 2026-09-28

Row: "for the customer quinn ford, kajabi has a free access to a course called
'[PIF] PPP Boss Builders $3997' and it says it has been purchased with offer
code but its not showing in the callsphere bossclinician admin".

## What the admin shows now

The Kajabi purchases backfill (run by hand, 2026-09-28 04:04 UTC) wrote the
card as `purchases` row 216, kind `free`, source `kajabi`, Kajabi order #1001.
Release `20260928145939-72ce0aa` serves it. Read through the deployed readers
in the live backend container:

- `listContactPurchases(468)` → 1 purchase: "[PIF] PPP Boss Builders $3997",
  Paid on Jul 15, 2026, $0.00 USD, access from 2026-07-15, not revoked.
- `getPurchaseDetail("216")` → heading "Free offer", "Part of order #1001",
  customer name and billing address from the contact.

The profile Purchases tab and View Details page call these two functions
(`routes/admin/purchases.ts`) with no extra filter. No code change was needed.
The row most likely went into the sheet before the backfill ran.

## Still different from Kajabi (blocked, not faked)

- **Offer code.** Kajabi's card names the coupon used. The scrape recorded
  only the $0.00 total, so the code is not stored anywhere here. It needs to be
  read off Kajabi's card before the admin can show it.
- **Course access.** Kajabi's Products column gives Quinn "The Boss Move". No
  product, course or offer by that name exists in the rebuild. Local offer 1 /
  product 25 ("Boss Builders Collective") is a draft test fixture. Member 124
  has no `access_grants`, so logging in as Quinn shows no such course. Five
  contacts hold "The Boss Move" in Kajabi. This is the known open item: Kajabi
  product access was never migrated.
- **Wording.** The card's date line says "Paid on" for every kind except a
  grant, including this $0 purchase. Kajabi's exact wording for a $0 coupon
  purchase has not been checked.
