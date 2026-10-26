# Host retirement: callback migration — 2026-10-26

Status: **Stripe and PayPal live endpoint URLs migrated in place and read back. SNS remains access-blocked. Keep the old public DNS A record and the three exact legacy POST callback exceptions during retirement.** **Corrected owner requirement: retire ONLY `bossclinician.callsphere.site` web UI/other paths. `www.bossclinician.com` and `admin.bossclinician.com` MUST remain active. Public `/admin` and legacy `admin.bossclinician.callsphere.site` must redirect to canonical admin, not 410.** This supersedes the earlier instruction to retire admin.

Only this document is changed by this callback task in `/home/ubuntu/bc-host-retire-1026`. No application source, `/opt` source, ingress, DNS, IAM, payment, email, commit or deployment action was performed by this task. Provider changes are limited to the two endpoint URLs below. No customer event replay or signed synthetic financial event was sent.

## Canonical preflight

Before either mutation, external HTTPS POSTs to `www.bossclinician.com` returned:

| Route | Synthetic request | Response |
| --- | --- | --- |
| `/api/stripe/webhook` | `{}` without Stripe signature | **400**, `Missing stripe-signature header` |
| `/api/paypal/webhook` | Invented ID `HOST-RETIREMENT-UNSIGNED-PREFLIGHT`, type `HOST.RETIREMENT.PREFLIGHT`, without PayPal signature headers | **400**, `Invalid signature` |

Source review established both rejection branches occur before event claiming/fulfillment. These checks prove public route reachability and rejection of unsigned requests, not successful provider-signed delivery. A pod-to-public-IP preflight failed with ECONNREFUSED; external requests succeeded. No host/network configuration was changed to work around that internal connection failure.

## Stripe — completed

- Account verified from the deployed credential: `acct_1PJSdOFXM7aVDtPL`. The connected Stripe plugin exposed a different account, so it was not used for this mutation.
- Exact endpoint: **`we_1USLpuFXM7aVDtPLvggPr6Kc`**.
- Before (2026-10-26 **16:16:07 UTC**): `https://bossclinician.callsphere.site/api/stripe/webhook`, `status=enabled`, `livemode=true`, `api_version=null`.
- Mutation (**16:16:08 UTC**): HTTP **200** from `POST /v1/webhook_endpoints/we_1USLpuFXM7aVDtPLvggPr6Kc`, request body containing **only** `url=https://www.bossclinician.com/api/stripe/webhook`.
- Independent GET readback (**16:16:08 UTC**): same endpoint ID, **`https://www.bossclinician.com/api/stripe/webhook`**, enabled/live, same API version and all other returned properties unchanged.
- Full before/after endpoint-list comparison confirmed both other endpoints unchanged: `we_1TxgrIFXM7aVDtPLHySokyhk` (disabled, creator-hq URL) and `we_1TxgXyFXM7aVDtPL03Gqs54D` (disabled, old Boss Clinician URL). No endpoint was created, deleted, enabled or disabled.
- Existing signing secret was not rotated, revealed or rewritten. The same endpoint was edited in place; deployed `STRIPE_WEBHOOK_SECRET` remains configured. Signature success against a real provider delivery was not exercised.

All **14** event filters preserved:

```text
charge.dispute.created
charge.refunded
charge.succeeded
checkout.session.async_payment_failed
checkout.session.async_payment_succeeded
checkout.session.completed
checkout.session.expired
customer.subscription.created
customer.subscription.deleted
customer.subscription.updated
invoice.paid
invoice.payment_failed
payment_intent.payment_failed
payment_intent.succeeded
```

## PayPal — completed

- Deployed configuration verified: `PAYPAL_ENVIRONMENT=live`, `PAYPAL_CHECKOUT_ENABLED=true`.
- Exact endpoint, matching deployed `PAYPAL_WEBHOOK_ID`: **`2NS729434A8253147`**.
- Before (**16:16:08 UTC**): `https://bossclinician.callsphere.site/api/paypal/webhook`.
- Mutation (**16:16:09 UTC**): HTTP **200** from `PATCH /v1/notifications/webhooks/2NS729434A8253147`, with exactly:

```json
[{"op":"replace","path":"/url","value":"https://www.bossclinician.com/api/paypal/webhook"}]
```

- Independent GET readback (**16:16:41 UTC**): HTTP **200**, same ID, **`https://www.bossclinician.com/api/paypal/webhook`**, still matching the deployed webhook ID. App webhook listing returned this one endpoint only.
- PayPal sorted its returned event array after the update. The initial strict whole-object comparison stopped on that order change; comparison by event name then verified all **16 complete event objects** (name, status and description) were unchanged. No follow-up mutation was needed.
- Client ID/secret, webhook ID, checkout switch and environment were not modified.

All **16** enabled event filters preserved:

```text
BILLING.SUBSCRIPTION.ACTIVATED
BILLING.SUBSCRIPTION.CANCELLED
BILLING.SUBSCRIPTION.EXPIRED
BILLING.SUBSCRIPTION.PAYMENT.FAILED
BILLING.SUBSCRIPTION.RE-ACTIVATED
BILLING.SUBSCRIPTION.SUSPENDED
BILLING.SUBSCRIPTION.UPDATED
CHECKOUT.ORDER.APPROVED
PAYMENT.CAPTURE.COMPLETED
PAYMENT.CAPTURE.DECLINED
PAYMENT.CAPTURE.DENIED
PAYMENT.CAPTURE.REFUNDED
PAYMENT.SALE.COMPLETED
PAYMENT.SALE.DENIED
PAYMENT.SALE.REFUNDED
PAYMENT.SALE.REVERSED
```

## SES/SNS — bounded inspection complete; no mutation

Configured topic: **`arn:aws:sns:us-east-1:689517798275:bossclinician-email-events`**. Configured SES sets: `bossclinician-transactional`, `bossclinician-marketing`. Repository `docs/EMAIL.md` records `https://bossclinician.callsphere.site/api/email/webhook/ses` as its HTTPS subscription. This is historical configuration evidence; current provider subscription URL remains unverified.

Current read attempts:

| Credential source / verified caller | Result |
| --- | --- |
| Deployed Boss Clinician: `arn:aws:iam::137808120879:user/bossclinician-app` | `SNS:ListSubscriptionsByTopic` and `SNS:GetTopicAttributes` denied; no resource-based policy allows cross-account access. SES configuration-set destination reads also denied. |
| Host `bossclinic` profile: `arn:aws:iam::137808120879:user/bossclinic-admin` | Topic subscription listing denied by resource-policy boundary. |
| Host `callsphere-mgmt` profile: `arn:aws:iam::381443104652:user/superadmin` | Topic subscription listing denied by resource-policy boundary. |
| Authorized other-app inspection, callsphere-website: `arn:aws:iam::689517798275:user/callsphere-web-app` | Topic subscription listing denied: **no identity-based policy allows `SNS:ListSubscriptionsByTopic`**. This caller is in the topic-owning account. |
| Host `mgmt-sso` profile | No cached SSO token available. |
| Targeted SuperFulfill process environment | No AWS credential pair in the inspected AWS/SES credential fields. |

No IAM policies, trust relationships, subscriptions or application credentials were changed; other-app credentials were not copied into Boss Clinician. No credentials were printed or stored in this report.

**Smallest next operator request:** an already-authorized operator/session in account **689517798275**, region **us-east-1**, should run `sns:ListSubscriptionsByTopic` for the exact topic above and supply the HTTPS `Endpoint`, `SubscriptionArn` and confirmation state. The exact denied caller/action are documented above; this task does not request broad account access or an IAM change. If the endpoint still uses the old host, migrate/confirm the canonical HTTPS subscription and verify delivery before removing the legacy SES route or old DNS. Do not assume the newly migrated payment endpoints resolve the email dependency.

## TURN and DNS retention

- Deployed backend readback: **`TURN_HOST=192.99.63.81`**, **`TURN_PORT=3479`**.
- `bossclinician-coturn-1` is running with host networking. Its live command includes **`--realm=bossclinician.callsphere.site`**, matching `docker-compose.yml`.
- The app constructs client TURN URLs using `TURN_HOST`; the inspected value is an IP. The old-name realm is an authentication identifier, not itself a DNS lookup target. Thus the inspected active TURN configuration does **not** establish an old-A-record dependency. No ICE/relay connectivity test was performed, and unknown cached clients were not inspected.
- Keep the realm, coturn process and UDP/TCP listeners unchanged during this web retirement. Nginx HTTP 410 handling is separate from the TURN port. DNS retention remains justified by unresolved SNS and transitional callback delivery; do not remove the A record based solely on payment URL readback.
- Parent supplied DNS snapshot location: `/var/tmp/bc1026-dns-callsphere.site.json`. No DNS mutation was performed here.

## Parent release handoff

The parent's retirement release may proceed with all three exact legacy POST receivers preserved: `/api/stripe/webhook`, `/api/paypal/webhook`, `/api/email/webhook/ses`. Keep only old-public GET/UI/other paths at 410. Keep canonical admin active at `https://admin.bossclinician.com/admin/login`; public `/admin` and legacy-admin host redirects must continue to target canonical admin. Retain old-public DNS while SNS/current delivery remains unresolved. Endpoint URL readback and unsigned rejection are verified; successful post-migration provider-signed delivery is still an operational follow-up, without generating real purchases or emails for testing.

Evidence files on server (sanitized): `/tmp/bc-callback-update-evidence.jsonl`, `/tmp/bc-paypal-readback.json`. They contain endpoint IDs, URL/configuration readbacks and timestamps, not credentials. Production source and the parent's ongoing build were not modified.

Primary references consulted: [Stripe endpoint update](https://docs.stripe.com/api/webhook_endpoints/update), [Stripe signature/delivery handling](https://docs.stripe.com/events/manage-webhook-endpoints), [PayPal URL-only webhook patch](https://developer.paypal.com/api/webhooks/v1/webhooks-update).

## Admin restoration correction: final worktree verification

The owner's corrected scope retires only the old public host. Canonical admin is required active; do not disable its ingress, frontend boundary target, backend host gate, or OAuth/password login. Parent reports browser verification of restored Google/password login. This review independently confirmed external HTTP 200 for canonical public homepage and canonical admin login, and HTTP 302 from both public `/admin/login` and legacy-admin `/admin/login` to canonical admin. After the parent's rollback, the old public homepage was still HTTP 200 live; the new 410 result below is a worktree scratch test, not a claim of deployment.

- **Nginx syntax passed**, using a uniquely named disposable nginx:1.31-alpine container.
- **28/28 scratch routing assertions passed.** A temporary copy of the current worktree nginx files used the same listen/upstream transformations as `k8s/gateway.Dockerfile`, with local mock frontend/backend upstreams. No production providers or customer APIs received these tests. Scratch containers were removed by the harness.
- Canonical public `/` and admin `/admin/login` returned 200 from mocked upstreams. Public `/admin/login` and old-admin `/admin/login` returned 302 to `https://admin.bossclinician.com/admin/login`; canonical admin `/` returned 302 to its `/admin`; apex redirected 301 to www. Public admin API remained 401.
- Old-public `/`, `/admin/login` and unrelated POSTs returned 410. For each of the three exact callback paths, POST reached the mocked backend (202), while GET/HEAD/OPTIONS/PUT and POST with trailing slash returned 410.
- Updated response body verified exactly: `This address is no longer available.\nVisit https://www.bossclinician.com/\n`. Source `nginx/retired-hosts.conf` SHA-256 at test: `7519c0516ccb4c0976406b7b0ce7022bade7acaf11b635590b5865e7bae10461`. No visual mobile rendering claim is made.
- Test harness: `/tmp/bc-nginx-admin-restore-check.sh`; isolated config snapshot: `/tmp/bc-nginx-admin-restore.00aZej/conf/`.
- `scripts/ci/deploy-release.sh`, `scripts/deploy-k3s.sh`, `scripts/k3s-cutover.sh`, `scripts/smoke-test.sh`, and the uptime monitor source use canonical public/admin targets. Smoke requires admin 200; cutover checks active canonical admin. Shell syntax checks passed for the four shell scripts. The monitor was inspected, not executed, to avoid sending alerts or changing monitor state.
- **Remaining issue for parent:** `.github/workflows/ci.yml:218` still used `Host: admin.bossclinician.callsphere.site` and asserted 200. Correct behavior for that legacy host is 302, so change the active-admin assertion to `Host: admin.bossclinician.com`; optionally test the legacy redirect separately. This review did not edit CI or any parent source.

Only this document was changed for the restoration correction. No `/opt` source edits, deployment, commit, DNS mutation, provider mutation or real payment/email action occurred during these final routing checks. Preserve DNS and all three legacy POST callback exceptions until the outstanding delivery/SNS checks are resolved.