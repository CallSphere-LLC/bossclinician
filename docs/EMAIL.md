# Email

How mail leaves this platform, what happens when someone buys, and what is
configured in AWS.

## Transport — Amazon SES

Sending goes through Amazon SES in **us-east-1**, over its SMTP interface. SMTP
rather than the SES SDK because the platform has two senders and this way both
use one transport with no new dependency:

| Path | Entry point | Used by | Recorded in `email_messages`? |
| --- | --- | --- | --- |
| A | `email/mailer.ts` → `sendMail` | receipts, welcomes, password links, coaching reminders | no |
| B | `email/provider.ts` → `sendEmail` | sequences, broadcasts, cart recovery, automations | yes |

Path B additionally checks the suppression list, appends the CAN-SPAM footer and
the `List-Unsubscribe` headers, and throws on failure so the queue can retry.
Path A is fire-and-forget by design: a receipt must not fail a paid webhook.

### What is set up in AWS

Account `689517798275`, region `us-east-1` (production access; the account is on
SES **PROBATION** — see *Risks*).

- **Identity** — `callsphere.site`, already verified with Easy DKIM and a custom
  MAIL FROM of `bounce.callsphere.site`. Mail is sent from
  `yvette@bossclinician.callsphere.site`; a verified domain covers its
  subdomains, so no new DNS was needed. SPF and DMARC (`p=none`) already exist.
- **IAM user** `bossclinician-ses-smtp` — its own key, with an inline policy that
  allows sending **only** from `*@bossclinician.callsphere.site`. That condition
  is deliberate: this is a shared account and a bug here must not be able to send
  as any other domain on it.
- **Configuration sets** — two, and the split matters:
  - `bossclinician-transactional` — SEND, DELIVERY, BOUNCE, COMPLAINT, REJECT,
    DELIVERY_DELAY, RENDERING_FAILURE. Deliberately **no CLICK**, because
    subscribing to click events makes SES rewrite every link in the message
    through `awstrack.me`, which is wrong for a receipt.
  - `bossclinician-marketing` — the above plus OPEN, CLICK, SUBSCRIPTION. Link
    rewriting is wanted here; it is what makes the admin's open and click figures
    non-zero.
  `mailer.ts` stamps the transactional set on every send; `provider.ts` overrides
  it with the marketing set for anything that is not `sourceType:
  "transactional"`.
- **SNS topic** `bossclinician-email-events` → HTTPS subscription to
  `https://bossclinician.callsphere.site/api/email/webhook/ses`.

### Delivery feedback

`routes/public/emailWebhook.ts` gained a second route for SNS. It verifies the
X.509 signature SNS puts on every notification, and — critically — refuses any
`SigningCertURL` that is not `https://sns.<region>.amazonaws.com`. SNS
authenticates with no shared secret, so the URL in the body decides which public
key is verified against; an unchecked one lets a caller forge a bounce for any
address and have it suppressed. The endpoint confirms its own subscription on
first contact, but only for the topic in `SES_SNS_TOPIC_ARN`.

SES's vocabulary is mapped onto the platform's existing event kinds, so bounces
and complaints flow into `email_events` and the suppression list exactly as they
would from any other provider. Only **permanent** bounces suppress.

### Environment

```
SMTP_HOST=email-smtp.us-east-1.amazonaws.com
SMTP_PORT=587
SMTP_USER / SMTP_PASS          # SES SMTP credentials for bossclinician-ses-smtp
SMTP_FROM="Yvette at Boss Clinician <yvette@bossclinician.callsphere.site>"
SES_CONFIG_SET_TRANSACTIONAL=bossclinician-transactional
SES_CONFIG_SET_MARKETING=bossclinician-marketing
SES_SNS_TOPIC_ARN=arn:aws:sns:us-east-1:689517798275:bossclinician-email-events
```

The SMTP password is derived from the IAM secret key by AWS's documented HMAC
derivation — it is not the secret key itself, and regenerating the IAM key means
re-deriving it.

## What happens when someone buys

`services/fulfillment.ts` owns the money and the access. `services/purchaseDelivery.ts`
owns everything the buyer experiences, and has three callers so that a buyer's
experience does not depend on which door they came through:

| Caller | When |
| --- | --- |
| `routes/public/stripeWebhook.ts` | a card payment |
| `routes/public/checkoutOffer.ts` | an order a coupon took to $0 |
| `routes/admin/offers.ts` (`/grant`) | an admin handing over access |

Each completed purchase now produces:

1. **A receipt** with a **PDF invoice attached** (`services/invoicePdf.ts`) —
   business name, support address, postal address and tax ID from the new
   *What goes on your receipts* settings group, plus order number, transaction
   reference, payment method, the buyer's billing address, and the
   subtotal → coupon → total breakdown.
2. **A welcome email** — numbered steps, the link that opens what they bought,
   and, for an account this purchase created, the set-password link inside it.
   Per-offer copy comes from the offer's *Their welcome email* card in the
   **After purchase** tab.
3. **Sequence exit** — `exitContactOnPurchase` is finally called, so buyers stop
   receiving the sales sequence for the thing they just bought.
4. **The `offer_purchased` automation trigger** — declared and offered in the
   automation builder since Phase 5, never fired until now.
5. **An owner notification.**

The set-password link is minted **once** and carried inside the welcome email
rather than sent separately: minting twice invalidates the first link, which
would leave the buyer holding one dead link and one live one.

## Fixed along the way

- **`$0` orders sent nothing at all.** A 100%-off coupon granted access in total
  silence and left a guest account with no password and no way to claim it.
- **Every token link in every account email was broken.** `memberTemplates.link()`
  built `/reset-password?token=…` while the page reads `useParams` on
  `/reset-password/:token`, so confirmations, resets and set-password links all
  landed on the "this link is missing its token" branch.
- **`email_templates` was inert.** The table and its admin screen have existed
  since Phase 5; nothing read them, so every edit Yvette made changed nothing
  while reporting success. `email/templateStore.ts` is the reader. A row that is
  missing, disabled or blank falls back to the shipped template.
- **Manual grants were silent** and could create an unusable account.
- **No `business` settings group existed**, so the receipt renderer in
  `routes/member/billing.ts` could only ever print a bare "Boss Clinician" with
  no address and no tax number.

## Risks and open items

- **The SES account is on `PROBATION`.** It is the same account that sends for
  callsphere.tech. A bounce-heavy send from this app can get the *whole account*
  paused, which would take out the other business's mail too. Watch the
  reputation dashboard before the first broadcast, and consider a dedicated
  configuration set IP or a separate AWS account if volume grows.
- **The IAM access key was pasted into a chat transcript and should be rotated.**
  The `bossclinician-ses-smtp` key is separate and was never exposed, but the
  admin key `AKIA…(redacted — rotate this key)` was.
- **Path A sends are still not recorded** in `email_messages`, so receipts and
  password links do not appear in reporting and their delivery events arrive
  unmatched. Moving `sendMail` callers onto `sendEmail` with
  `sourceType: "transactional"` would close this.
- **`magicLink` points at `/magic-link/:token`, for which no frontend route
  exists.** Pre-existing; the sign-in-link email cannot work until a route is
  added.
- **Sending is from `bossclinician.callsphere.site`,** which is the staging host.
  At the `bossclinician.com` cutover this needs a new SES identity and DKIM
  records on the real domain, and the IAM policy condition needs widening to
  match.
