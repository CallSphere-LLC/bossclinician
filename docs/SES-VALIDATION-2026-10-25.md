# Boss Clinician email validation — 2026-10-25

## Scope

Public lead, subscriber, dynamic form, event, affiliate, public assessment, booking, member registration, API contact creation, and guest checkout writes now call Amazon SES `GetEmailAddressInsights` before storing a fresh address. The shared transactional and marketing send paths also check recipients; known invalid recipients do not reach the transport. Public lead and subscribe forms show the returned correction. SES Auto Validation is configured separately at the account level for every outbound SES message.

## Operational configuration

- Region: `us-east-1`. Production SMTP sends from account `689517798275`; its `bossclinician-transactional` and `bossclinician-marketing` configuration sets and SNS topic live there. The application API key belongs to the separate Boss Clinician account `137808120879`; SES API validation runs there.
- Set `SES_VALIDATION_ENABLED=true` in `backend/.env` after the IAM application user `bossclinician-app` has `ses:GetEmailAddressInsights` permission. The backend already carries that user's `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`; the S3 media identity stays separate.
- Optional `SES_VALIDATION_REGION=us-east-1`.
- Enable SES account Auto Validation in **sending account `689517798275`**, not the API-key account, with the `MANAGED` threshold; retain `BOUNCE` and `COMPLAINT` suppression. Verify with SES `GetAccount` in that account. As of the initial audit, account `137808120879` has Auto Validation off and lacks these production configuration sets.
- A missing IAM permission, timeout, or SES outage allows the form to proceed and emits a rate-limited operational warning. This avoids blocking registration or a paid receipt because of an infrastructure failure. It is **not** a successful validation; monitor this warning.
- Each process caps paid API lookups at 2,000 per UTC day, caches results for up to 30 days (20,000 addresses), coalesces simultaneous identical requests, and never logs the address or SES response. A restart clears this cache. At AWS's current a-la-carte price, the cap is at most $20/day per process for API lookups. The cap is a safety ceiling, not a forecast.
- LOW syntax/DNS/overall confidence is rejected. MEDIUM and HIGH are accepted. SES managed Auto Validation makes the final transport decision.
- SES `Bounce` events with `bounceSubType=EmailValidationSuppressed` are stored as `suppressed` rather than counted as ordinary campaign bounces; the contact is suppressed with reason `invalid`.

## Verification

- Backend and frontend typechecks pass.
- Backend build passes.
- Backend unit suite: 1,789 passed, 408 skipped (integration fixtures are opt-in).
- Focused SES validation and signed webhook tests: 22 passed.
- Application IAM `GetEmailAddressInsights` verified with the SES simulator (`HIGH`) on 2026-10-25. Sending-account Auto Validation, deployment and Chrome checks: pending in this record until verified.

## Sources

- https://docs.aws.amazon.com/ses/latest/dg/email-validation.html
- https://docs.aws.amazon.com/ses/latest/dg/email-validation-api.html
- https://docs.aws.amazon.com/ses/latest/dg/email-validation-auto.html
- https://aws.amazon.com/ses/pricing/