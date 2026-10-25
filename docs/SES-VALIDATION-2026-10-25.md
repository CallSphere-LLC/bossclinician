# Boss Clinician email validation — 2026-10-25

## Scope

Public lead, subscriber, dynamic form, event, affiliate, public assessment, booking, member registration, API contact creation, and guest checkout writes now call Amazon SES `GetEmailAddressInsights` before storing a fresh address. The shared transactional and marketing send paths also check recipients; known invalid recipients do not reach the transport. Public lead and subscribe forms show the returned correction. SES Auto Validation is configured separately at the account level for every outbound SES message.

## Operational configuration

- Region: `us-east-1`. Production SMTP sends from account `689517798275`; its `bossclinician-transactional` and `bossclinician-marketing` configuration sets and SNS topic live there. The application API key belongs to the separate Boss Clinician account `137808120879`; SES API validation runs there.
- Set `SES_VALIDATION_ENABLED=true` in `backend/.env` after the IAM application user `bossclinician-app` has `ses:GetEmailAddressInsights` permission. The backend already carries that user's `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`; the S3 media identity stays separate.
- Optional `SES_VALIDATION_REGION=us-east-1`.
- SES account Auto Validation is ENABLED in sending account `689517798275` (us-east-1), with the `MANAGED` threshold. `BOUNCE` and `COMPLAINT` suppression were preserved. Readback via SES `GetAccount` on 2026-10-25 confirmed this. The separate API-key account `137808120879` remains unchanged and is not the SMTP sender.
- A missing IAM permission, timeout, or SES outage allows the form to proceed and emits a rate-limited operational warning. This avoids blocking registration or a paid receipt because of an infrastructure failure. It is **not** a successful validation; monitor this warning.
- Each process caps paid API lookups at 2,000 per UTC day, caches results for up to 30 days (20,000 addresses), coalesces simultaneous identical requests, and never logs the address or SES response. A restart clears this cache. At AWS's current a-la-carte price, the cap is at most $20/day per process for API lookups. The cap is a safety ceiling, not a forecast.
- LOW syntax/DNS/overall confidence is rejected. MEDIUM and HIGH are accepted. SES managed Auto Validation makes the final transport decision.
- SES `Bounce` events with `bounceSubType=EmailValidationSuppressed` are stored as `suppressed` rather than counted as ordinary campaign bounces; the contact is suppressed with reason `invalid`.

## Verification

- Backend and frontend typechecks pass.
- Backend build passes.
- Backend unit suite: 1,789 passed, 408 skipped (integration fixtures are opt-in).
- Focused SES validation and signed webhook tests: 22 passed.
- Application IAM `GetEmailAddressInsights` verified with the SES simulator (`HIGH`) on 2026-10-25. The sending account was verified as `689517798275` using its existing application AWS credentials; SES `GetAccount` then confirmed Auto Validation `ENABLED` / `MANAGED` with `BOUNCE` and `COMPLAINT` retained. Both production configuration sets have no override, so they inherit the account setting. Live K3s release `20261025230856-133ae8a` passed its security gate and rollout; `/api/health` reported the release. In the user's Chrome, a synthetic `@bossclinician.invalid` address was rejected on contact and newsletter forms with a clear domain message. After the layout fix, the newsletter message sat below the input/button without overlap at desktop and 390 px phone width. Read-only database checks showed zero lead, contact, subscriber, or email-message records for the synthetic address. No real customer email or purchase was sent. This verifies known-bad form handling and configuration, not every possible mailbox or SES delivery outcome.

## Sources

- https://docs.aws.amazon.com/ses/latest/dg/email-validation.html
- https://docs.aws.amazon.com/ses/latest/dg/email-validation-api.html
- https://docs.aws.amazon.com/ses/latest/dg/email-validation-auto.html
- https://aws.amazon.com/ses/pricing/