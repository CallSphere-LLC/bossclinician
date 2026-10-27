# Row 191: Boss Move exam pass confirmation

## Root cause, read-only production evidence

The Boss Move graded post-exam is assessment 31 (`the-boss-move-post-exam`), course 52 (`the-boss-move`), lesson 301 (`post-exam`), pass mark 75. Program evaluation 33 is a survey. A passed exam attempt and a processed `assessment_passed` event for assessment 31 exist. These observations do not establish certificate eligibility or successful email delivery.

The only imported Boss Move pass workflow, automation 1339, is **paused**, has unresolved `trigger_config.assessmentId=-1`, and its action 1344 subscribes to imported sequence 483. No active assessment-pass email automation targets exam 31. The missing confirmation is a configuration gap independent of the certificate completion gate. CWC's active pass/fail automations do not cover Boss Move.

## Bounded implementation

Migration **164_boss_move_pass_confirmation.sql** installs one active `assessment_passed` automation for the exact published Boss Move graded post-exam, found by course/assessment/lesson slugs rather than hard-coded database IDs. Its sole action is a product email confirming the saved pass, with canonical www result/progress/certificate links. Copy explicitly separates exam confirmation from certificate issuance after required course/video/exam/evaluation completion. It does not promise that a certificate already exists.

The imported sequence and all existing automation states remain unchanged. There is no audience scan, enrollment, historical event enqueue, progress edit, certificate issue, or real email in this implementation task. James's login/auth/recovery surfaces and migration 163 are untouched; Pauli's certificate gates remain untouched.

To prevent old queued/replayed attempts from receiving a newly introduced email, installation briefly takes a SHARE lock on the attempts table, waits for in-flight writes, and captures `minimumAttemptId = MAX(id)+1`. The engine applies this optional boundary only to assessment triggers; old/missing/invalid attempt IDs fail closed. Existing automations without the boundary retain their behavior. Migration replay retains the original boundary and later owner edits/pauses.

Already-passed learners are **not** retroactively emailed. A new qualifying pass after installation uses the normal durable event and delivery path. Normal suppression and per-contact limits still apply. Successful replay is deduplicated by the existing event/run/action protections.

## Verification and parent QA

All **46 focused tests passed**: 4 new isolated PostgreSQL pass-email integration tests, 2 existing lesson-assessment integration tests, 12 attempt-boundary tests, and 28 existing engine tests. Backend TypeScript check passed. The isolated `bc192-pg` test container was removed. Integration coverage executes the migration and real domain-event dispatcher with mocked email delivery: missing target no-op, exact target/action scope, preserved paused import, old/missing/wrong-assessment/failure/survey events producing no mail, a future pass with no certificate producing confirmation, duplicate event/run replay producing only one send, and migration replay preserving boundary plus owner pause/subject edits. Existing lesson assessment integration tests verify pass-event publication independently.

Parent release work should include migration 164 and the engine boundary together. Verify the installed automation's exam binding/boundary and one email action, then exercise a synthetic new pass with delivery suppressed and confirm one rendered confirmation with canonical links. Keep certificate issuance QA separate. Do not replay real historical attempts or enroll the old imported sequence. Row 191 should retain any delivery/certificate/Chrome limitations until parent release proof is available.

This agent has not deployed, changed production data, or sent real mail. Local canonical records and Google statuses remain pending parent evidence.
