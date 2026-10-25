# Boss Clinician QA row 182 — Lounge VIP Practice Health Check

Source: Bugs row 182 in the Boss Clinician tracker, dated 24 October 2026. The linked Drive ZIP is `VIP_Practice_Health_2_Minute_CallSphere_Package_Updated.zip` (file ID `13Q7F5ZStvJ4qW41y2VwvEC_pwpGyZwqZ`). Its HTML and PDF specify eight choice questions, a six-area score, selected challenges, a 90-day priority, and the first action from the lowest-scoring area.

Base commit: `c989baeb6cb8044446df6ada9d785ef550e05138`. Worktree: `/home/ubuntu/bc-qa-182`. No production database or sheet edits and no deployment.

## Implementation

- Migration 157 inserts `Your 2-Minute Practice Health Check` after `Welcome VIP Boss Clinician` in course `the-lounge-vip`, shifting later lessons. It is safe to rerun.
- The native lesson tool reproduces all eight questions and the ZIP's score formula: round(sum of six 1–4 answers / 24 × 100), lowest area first on ties. Answers and report save via the authenticated, revision-checked member tool-state route.
- Migration 157 adds `form_submissions.member_id`. The three existing VIP lesson forms now list prior submissions by authenticated member ID. Shared contact records can no longer mix their receipt lists.
- Autosaves include the member ID that loaded the data. The server rejects a save if the signed-in account changed before the request arrived. The new tool remounts on account change; the existing lesson form also suppresses stale member data during an account switch.
- Historical form submissions are not assigned an owner by guessing from email or contact ID. Admin records remain, but those historical receipts do not appear in a member's prior-submissions list.

## Verification

- Live database read-only query identified the exact course/module and welcome slug; no production writes.
- Scratch PostgreSQL integration: new assessment state isolated across two members; all three VIP form receipt lists isolated despite a shared contact; outsider denied; impersonated write denied; cross-account pending save rejected; migration order and rerun verified.
- Frontend scoring tests: 3 passed. Backend integration tests, including existing tool-state coverage: 9 passed.
- Frontend and backend TypeScript checks passed; Vite client build passed; `git diff --check` passed.
