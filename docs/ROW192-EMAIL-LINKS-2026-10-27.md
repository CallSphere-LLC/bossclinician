# Row 192: CWC email links on the retired public host

Prepared 2026-10-27 UTC (2026-10-26 PT), branch `fix/bc192`, base `a1dce29`.

## Evidence and scope

Read-only production inspection found active CWC pass automation 24/action 27 and fail automation 25/action 29 linking to:

`https://bossclinician.callsphere.site/library/credential-with-confidence/lessons/credential-with-confidence-quiz`

This is the exact path recovered from the active templates. Sent-message storage contains metadata, not rendered bodies; an individual recipient's original rendered message was not retrieved. Twenty-one automation email bodies contained the retired hostname; no stored `email_templates.body_md` did. No recipient addresses, tokens, or message bodies are included here.

CWC course 4 was published, with 17 published lessons and `require_full_video=false`. This does not prove an individual member is certificate-eligible. Pauli owns certificate eligibility, lesson loading, and CE gates for row 191. This change only touches the certificate email builder and its import/export in `services/certificates.ts`.

## Changes

- New email helper `backend/src/email/canonicalLinks.ts` canonicalizes the retired public origin and production apex/www to `https://www.bossclinician.com`; valid explicit preview/development origins remain supported.
- Automation email bodies and stored template overrides normalize exact retired-host URL tokens after token merge. Certificate emails generate canonical account/verification URLs directly and encode verification path components.
- Migration 162 repairs only `send_email` action `config.bodyMd` and `email_templates.body_md`. It preserves unrelated JSON fields, subjects, recipients, automation states, history, and disabled templates. Whole-URL scanning leaves third-party redirect queries, lookalike hosts, email addresses, user-info URLs, and non-default ports alone. Replays are idempotent.
- Existing-email compatibility: nginx and application middleware return **302 only for GET/HEAD on the exact raw path** `/library/credential-with-confidence/lessons/credential-with-confidence-quiz`. Destination is fixed to `https://www.bossclinician.com` plus that path. The original query string is preserved as data; no destination is read from it. Responses are `no-store` and `noindex, nofollow`.
- Old homepage, login, other library paths, certificate paths, trailing-slash/encoded/traversal aliases, and other methods remain 410. The existing three signed POST callback routes remain routed. Canonical admin is unaffected. This does not restore the retired site or change DNS.

The forgot-password agent owns login/auth/reset surfaces. The helper is available for reuse; this branch does not edit those surfaces or introduce redirect allowances for them.

## Validation

- 68 focused unit tests passed: canonical helper 26, retired-host middleware 13, certificate email 1, existing automation engine 28.
- 4 isolated PostgreSQL integration tests passed: original CWC pass/fail template repair; preservation/idempotence; runtime token merge and event replay with mocked delivery; stored override/disabled fallback behavior. Full schema/migration chain ran in the isolated fixture.
- Backend TypeScript check passed (`tsc -p tsconfig.json --noEmit`).
- Actual nginx syntax check and 37 routing/header checks passed, including fixed destination with untrusted `next` query, exact query preservation, blocked aliases/methods, and retained POST callbacks.
- Test containers `bc192-pg` and `bc192-nginx-check` were removed by their harnesses. No real messages, certificates, progress changes, charges, or production writes were performed. No deployment performed by this agent.

## Parent release and Chrome QA

1. Integrate with Pauli's certificate changes, retaining this email-only diff. Apply migration 162 through the normal migration process and deploy both application and retired-host nginx config.
2. Click the existing CWC result email and confirm its exact legacy URL redirects once to canonical www. Complete normal authentication there if necessary; do not alter or expose any original token.
3. Confirm old homepage/login remain 410, canonical admin remains available, and signed callbacks remain routed.
4. Use synthetic QA with delivery suppressed to inspect newly rendered pass/fail and certificate links. Verify certificate availability under Pauli's actual eligibility rules; passing this URL fix alone does not establish certificate eligibility.
5. Record production release, native Chrome results, and synthetic cleanup in row 192 and canonical records. This report is implementation/test evidence, not a claim of completed production QA.
