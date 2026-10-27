# Password recovery implementation and QA

Branch: `fix/bc-password-recovery`; base: `a1dce291cf91bbb18c88900c534a657ae6166ee9`.
Worktree: `/home/ubuntu/bc-password-recovery` on `server-64gbRam`.
Not deployed. No real accounts changed and no email delivered. Admin 27 was not touched.

## Actual surface inventory

| Surface | Password behavior | Recovery |
| --- | --- | --- |
| Public/member `/login` | Existing-password sign-in | Existing control retained; now carries safe `next` through recovery |
| Admin `/admin/login` | Existing-password sign-in, then MFA when enabled | New Forgot your password control; separate admin recovery pages/API |
| `/account/security` | Current password required to change it | New recovery link retaining `/account/security` |
| `/checkout/:offerSlug` | Email and payment, no password input/sign-in form | Member recovery via `/login`; checkout destination survives `next` |
| `/cart`, `/club/checkout` | Shared checkout experience, no password form | Same member flow |
| `/checkout/success`, PayPal return, upsell | Receipt/payment continuation, no password sign-in | No additional password form |
| `/signup` | New password, not an existing-password sign-in | Existing duplicate/guest setup behavior retained |
| `/admin/invite/:token` | First password from a separate invitation | Recovery does not activate invited admins |
| Admin settings secret input | Integration credential, not account sign-in | Not an account recovery surface |

Member aliases in migration 064 (`/signin`, `/sign-in`, `/log-in`, `/members/login`, `/member/login`, `/members`, `/account/login`, `/users/sign_in`) resolve to the member login. Admin-host `/login`, `/signin`, `/sign-in`, `/log-in` resolve to `/admin/login` through existing nginx rules. Protected member/admin pages use those same login forms. No curriculum/library/tool-state/certificate/retired-host code was edited.

## Security and integration

- Reuse existing CSPRNG tokens, SHA-256 token storage, bcrypt cost 12/password policy, mailer and member reset table.
- Migration **163** adds admin reset tokens, reset-count indexes and a member access-token reset cutoff. Apply before serving this code. Existing accounts are not reset by the migration.
- Admin and member tokens cannot cross realms. Links expire after one hour and are single-use. GET displays a form only.
- Neutral request responses, a uniform query path with a bounded response-time floor, IP limits and a durable five-per-account/15-minute email cap serialized across concurrent requests.
- Consumption locks the account before claiming the token; password change, session revocation and outstanding-link invalidation commit together. Member magic links are invalidated too. Member access JWTs minted before reset are rejected by authentication; refresh and document sessions are revoked.
- Admin role/status/MFA remain unchanged. Suspended/deleted accounts cannot reset; invited members can prove inbox ownership and set their first password. Admin invitations stay separate.
- Request audit identifies the requester as anonymous. Completed admin reset audits the token-proven admin with boolean outcome fields only. Neither tokens/hashes nor passwords enter audit payloads. Audit completion commits in the same transaction.
- Deferred reset and password-changed sends have explicit rejection handlers with constant, secret-free diagnostics.
- Safe `next` is carried through request body, email query, reset UI and login. External, cross-realm and auth-loop destinations fall back to `/library` or `/admin`. Successful reset returns via a full document login navigation so stale in-memory authentication cannot bypass re-sign-in.
- `backend/src/email/canonicalLinks.ts` is byte-for-byte identical to Curie's `7a691d1` helper (blob `919e7f5b0c6a1e66dfdeaec59f776cab602c332f`), included to keep this a1dce29-based branch self-contained. The combined release already has this identical file. Member reset emails use `publicEmailUrl`; admin recovery normalizes the legacy admin alias to `https://admin.bossclinician.com`.

## Verified before commit

- Backend typecheck: passed.
- Frontend typecheck: passed.
- Backend focused tests: **62 passed**, including **20 HTTP/Postgres integration tests**.
- Frontend focused tests: **38 passed**, including rendered controls, incomplete links, confirmation fields, recovery navigation and return-path rejection.
- `git diff --check`: passed.
- Full schema and migrations replayed in a disposable, separately-created Postgres 16 container. Only synthetic `example.invalid` accounts were created. Mailer mocked before import; no production database credentials or email transport used.
- Integration assertions cover old/new password login, member access/admin cookie and refresh revocation, expired/reused/wrong-realm tokens, concurrent same/sibling tokens, parallel caps, rollback on revocation failure, invited/blocked account behavior, preserved admin MFA, canonical URLs, cross-origin/Host protection, safe return paths, secret-free audit and rejected mail promises.

Re-run against a disposable Postgres instance using the repository `TEST_DATABASE_URL` harness (never the application database):

```sh
cd backend
npm run typecheck
TEST_DATABASE_URL=postgres://test-user:test-password@127.0.0.1:TEST_PORT/postgres NODE_ENV=test WORKER_ENABLED=false node_modules/.bin/vitest run --maxWorkers=1 src/services/passwordRecovery.integration.test.ts src/auth/passwordRecoveryLinks.test.ts src/email/adminPasswordRecovery.test.ts src/routes/admin/auth.test.ts src/routes/auth/memberAuth.test.ts src/auth/memberSession.test.ts
cd ../frontend
npm run typecheck
node_modules/.bin/vitest run --maxWorkers=1 src/lib/passwordRecovery.test.ts src/pages/admin/PasswordRecovery.test.tsx src/pages/admin/adminReturnTo.test.ts src/pages/admin/Login.test.ts src/pages/admin/Login.session.test.tsx
```

## Parent release QA still pending

Chrome QA and real transport delivery were not performed in this no-deploy task. After the parent integrates and releases:

1. Inspect member login, admin login and account security at mobile/desktop widths; check keyboard focus and recovery controls. Inspect checkout/cart/Club to confirm the inventory remains accurate.
2. In a QA environment with a captured/mock email transport, use synthetic accounts only. Start with member `next=/checkout/QA-offer?plan=annual#details` and admin `next=/admin/offers/QA-id?tab=pricing#form`; follow the captured link in a fresh browser context, reset, re-sign-in and confirm the destination survives.
3. Confirm validation, mismatched confirmation, expired/reused links, throttling and network errors are actionable. Unknown and existing request responses remain indistinguishable.
4. Confirm the prior password and all prior sessions fail; the new password succeeds. For a synthetic MFA-enabled admin, the second-factor challenge must remain. Check the two audit events contain no secret.
5. Do not trigger recovery for provisioned admin 27 or any real account. Do not deliver real mail for this QA.

## Changed files

- `backend/src/auth/memberSession.ts`
- `backend/src/auth/passwordRecoveryLinks.test.ts`
- `backend/src/auth/passwordRecoveryLinks.ts`
- `backend/src/db/migrations/163_admin_password_recovery.sql`
- `backend/src/email/adminPasswordRecovery.test.ts`
- `backend/src/email/adminPasswordRecovery.ts`
- `backend/src/email/canonicalLinks.ts`
- `backend/src/email/memberTemplates.ts`
- `backend/src/middleware/memberAuth.ts`
- `backend/src/middleware/rateLimit.ts`
- `backend/src/routes/admin/index.ts`
- `backend/src/routes/admin/passwordRecovery.ts`
- `backend/src/routes/auth/memberAuth.ts`
- `backend/src/services/passwordRecovery.integration.test.ts`
- `backend/src/services/passwordRecovery.ts`
- `backend/src/validation/memberSchemas.ts`
- `frontend/src/lib/api.ts`
- `frontend/src/lib/memberApi.ts`
- `frontend/src/lib/passwordRecovery.test.ts`
- `frontend/src/lib/passwordRecovery.ts`
- `frontend/src/pages/admin/AdminApp.tsx`
- `frontend/src/pages/admin/Login.tsx`
- `frontend/src/pages/admin/PasswordRecovery.test.tsx`
- `frontend/src/pages/admin/PasswordRecovery.tsx`
- `frontend/src/pages/admin/adminReturnTo.ts`
- `frontend/src/pages/member/ForgotPassword.tsx`
- `frontend/src/pages/member/Login.tsx`
- `frontend/src/pages/member/ResetPassword.tsx`
- `frontend/src/pages/member/Security.tsx`
- `docs/PASSWORD-RECOVERY-QA.md`
