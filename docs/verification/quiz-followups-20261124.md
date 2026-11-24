# Quiz followup implementation and release checks

Status: implemented and locally tested; production verification pending the exact committed release.

- Migration 236 creates Ready H1-H6, Almost H1-H6, Not Yet N1-N3, assessment A1-A6. The 21 templates preserve supplied subjects, previews and body copy. CTA metadata renders as supported buttons, with labels and URLs unchanged. H3/A3 stay disabled and the shared send guard refuses the unresolved walkthrough URL even if enabled accidentally.
- Day offsets are absolute from first quiz completion. Retakes deliver a new requested result but do not restart or change the original followup bucket/clock. Unknown practice stage preserves the current followup and records an administrative review reason. Confirmed incompatible stages stop mismatched quiz mail; no Club registration or bonus deadline is invented.
- New explicit practice-stage controls do not change either quiz score. Marketing consent is optional and separate from results. Existing opt-outs, complaints and bounces are not re-subscribed.
- Known promotional sequences use one per-contact transaction lock, one active sales sequence and at most one sales email per Pacific calendar day. Legacy quiz position 1 is a requested transactional result; only later positions enter sales arbitration. Paid onboarding, bonus reminders and retreat communications are untouched.
- Requested H0 uses the existing durable automation/action claim, with its original three automations active throughout deployment. Only those exact actions use the transactional result sender. No parallel form sender or historical result replay is introduced. Suppression, delivery caps and send failure handling remain enforced.
- Before promotional send: confirm opt-in, excluded form submission, promoted-offer access and competing sales sequence. Registration/application and purchase events continue their existing exit processing.
- No historical enrollment, external email sends, paid purchases, agreement replacement or tracker changes were performed in these tests.

Validation: backend typecheck; 115 focused unit tests; 12 disposable PostgreSQL integration cases covering migration replay, no backfill, consent, stage transitions, concurrency, absolute timing, disabled video, daily cap, prior application/access, legacy result, real transactional delivery-log status and H0 event replay. SMTP transport was mocked and used simulator recipients. Linux frontend typecheck and 10 existing Hiring Quiz tests passed. Full native CI remains required before production.

Deployment requires additive migration rehearsal against a protected backup, then backend-only rollout and confirmation that old backend workers have terminated while frontend remains the previous version. Only then roll the full tested image set through the existing gate. Retain original backend image for rollback if full rollout fails. Advance the baseline only after the complete gate succeeds.

Outstanding owner inputs: walkthrough recording URL and thumbnail; corrected approved retreat agreement; historical payment reconciliation and Kajabi cancellation confirmation; GA4/Meta IDs and Search Console property evidence. These are not marked complete by this implementation.
