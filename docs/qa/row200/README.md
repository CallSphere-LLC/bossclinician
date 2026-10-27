# BC-QA-200 — Boss Move welcome intake survey

Source request (verbatim): “Can you remove the google form survey and include this as a survey in the welcome tab in the boss move course https://drive.google.com/file/d/1Yv-f6PliOYyPBdqc0RSiGSBY8LNCKoY7/view?usp=drive_link”

Sheet row: 200. Source date: blank. Reporter: blank. Neither field is inferred from the PDF print timestamp.
Source: Intake Survey - Google Forms.pdf, Drive file 1Yv-f6PliOYyPBdqc0RSiGSBY8LNCKoY7, two pages, 78,693 bytes; both pages visually checked.
Local source record: C:\Users\sag19\bc187-192\row200\intake-survey-source.pdf (with source-page-1.png and source-page-2.png).

## Implementation
Base 38c34ee; isolated /home/ubuntu/bc200-native-survey, branch fix/bc200-native-survey.
Migration169 attaches form-boss-move-intake-survey to the existing Boss Move welcome lesson249, course52/product44/module86.
The existing video, media, publication, progression, lesson count and certificate requirements remain as stored.
Seven required source questions and every choice are preserved. Email and First and Last Name use the signed-in account, with original labels rendered readonly. Five questions are editable (two check-all, one radio, two long text).
A member with no stored name sees an Edit your profile link (/account/profile); submission is disabled and direct POST rejects with a friendly message and profileHref. No name is invented from the email address.
The old exact forms.gle link becomes a local form anchor; the duplicate standalone link is removed. Other owner edits/community/help links remain.
Native form answers appear under Admin > Forms. The form is unpublished to public /f routes, create_lead=false, notify_on_submit=false. Existing Google Form responses are not deleted or imported; the PDF contains questions, not historical response data.
Rerunning169 preserves form edits, stored replies, other welcome edits and progression. Ambiguous placement, another attached tool or a preexisting unrelated form slug stop the migration.

## Evidence (isolated scratch only)
- Backend: 60 passing focused tests (16 database integration, 13 lesson-form units,21 existing form-logic,10 existing notification tests).
- Frontend:12 passing focused tests (3 identity/profile-escape render tests,9 form-logic tests).
- Backend and frontend typechecks passed. Frontend client/SSR build passed (rerun after final identity change recorded in test logs).
- Database integration replays schema/all migrations on a fresh database, verifies no orphan form when course absent, source text/order/options, invalid required answers, server-bound identity, no-access/anonymous/impersonation restrictions, member-only history, missing-name handling, no lesson/assessment/certificate mutation, no email, rerun preservation and collision guards.
- Helper lifecycle tested only in bc200-survey-pg: provision2 finite grants, issue unsent one-use link, audit/delete one synthetic reply/contact/activity/domain event/job, zero readback. Separate negative tests reject a global automation and unexpected completed lesson.
- No production writes, messages, bookings, student answers or UI automation by this agent. Parent Chrome verification remains pending.

## Live read-only preflight facts
At 2026-10-27 approximately06:36 UTC, before row200 deployment:
-18 active form_submitted rules; all exact other formIDs24–40 and532; no globals.
-0 active contact_created/member_created/member_granted_access rules.
-0 enabled matching webhooks for form.submitted/contact.created/contact.updated/member.created/member.granted_access.
-New native form not yet deployed.
The member lesson route calls upsertContactWithStatus directly (no contact_created publication), records contact_activity and publishes only form_submitted. No worker execution was invoked.
This is a snapshot, not a guarantee against later configuration changes. Rerun preflight immediately before QA; do not disable any global workflow. If it fails or concurrent configuration changes prevent confidence, limit Chrome to display/validation and rely on isolated HTTP submission evidence; document that live submission remains unverified.

## Prepared helper commands — authorization required before writes
Run from this directory on server-64gbRam. Default target is bossclinician-db-1 / boss / bossclinician. Environment BC200_PG_CONTAINER, BC200_PG_USER, BC200_PG_DATABASE override only for isolated tests.
No dependencies beyond Python3, Docker and container psql.
The helper is prepared, not executed against production. Parent must explicitly authorize fixture/link/cleanup. The --execute-authorized flag is required for those modes.

Read-only preflight after deployment:
```sh
python3 qa.py preflight
```

After parent authorizes synthetic QA:
```sh
python3 qa.py fixture --execute-authorized
python3 qa.py link --who a --execute-authorized
python3 qa.py link --who b --execute-authorized
```
Creates only bc-qa-200-20261027-a@example.invalid and ...-b@example.invalid with product44 direct grants expiring in2hours. No progress/certificates/answers/contact rows are seeded. B deliberately has no name to exercise the profile escape. IDs and links are saved in /var/tmp/bc200-qa-manifest.json (mode0600). Links are one-use, expire in120seconds and are never emailed; prepare each immediately before its browser use. Never paste live tokens into reports. The helper refuses a preexisting manifest/identity.
Do not reuse deleted QA members243/244 or previous course fixtures.

## Exact parent Chrome checks
1. Admin preview: Boss Move > Welcome: Start Here > welcome lesson. Check existing video/content plus title/description and seven source questions, required markers, exact options and no Google Forms navigation. Preview submission remains disabled.
2. A: open the one-use link to /library/the-boss-move/lessons/start-here-welcome-to-the-boss-clinician-club-program. Click the intake-survey link; it stays on the page and targets the native form.
3. Compare both PDF pages at desktop and390px. Check Email and First and Last Name show A's account, readonly;5 editable questions match.
4. Try empty submit and leave each required question blank in turn: visible required error and no saved reply. Pick multiple stage/support choices and exactly one confidence.
5. Immediately rerun preflight before positive submit. Use clearly labelled synthetic text. Submit once; confirm success, reload and confirm last-sent history; Admin > Forms > Boss Clinician Intake Survey contains only A's test reply under A's name/email.
6. B: initially see friendly profile prompt and Edit your profile route. Save a synthetic full name through profile, return to welcome and confirm readonly updated account identity. B's reply history remains empty. No need to submit B.
7. Scoped admin View as member: GET can display A's form/history; POST remains403. No staff-created student response.
8. Check survey submission did not mark welcome complete, add an assessment attempt or issue a certificate. Avoid playing/completing the existing welcome video during this narrow QA.
9. Record actual Chrome results/screenshots separately; these are instructions, not completed proof.

## Cleanup after parent declares QA complete
```sh
python3 qa.py audit
python3 qa.py cleanup --execute-authorized
python3 qa.py readback
```
Audit and cleanup require exact manifest member IDs AND the fixed disposable emails. They inspect all FK references to members/contacts/submissions, including SET NULL relations, plus email-only records, domain events, jobs, automation runs and webhook deliveries. Unexpected progress/completions, grants, purchases, emails, files, certificates, automation runs or webhook effects abort the transaction for review. Running event jobs also stop cleanup.
Cleanup deletes exact captured native replies/events/jobs, members with cascading auth tokens/sessions/grants, and exact synthetic contacts with their activity. It adjusts the form submit counter only by deleted QA replies. It preserves the survey/content, all admin users/audits, other replies and shared media. No PDF should exist for this QA; finding one stops cleanup.
The manifest is retained without bearer links as the ID-only execution record. Readback must show zero members,contacts,submissions,events and email-referencing jobs; the cleanup transaction also verifies captured job IDs were removed.
