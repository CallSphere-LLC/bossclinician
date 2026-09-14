# Lane 4 — assessments inside lessons

## Reproduction and existing behavior

- Before modifications, `backend/scripts/test-integration.sh src/routes/admin/parity.integration.test.ts` passed 9/9, including the existing member-token API test that passed a linked graded assessment and unlocked the prerequisite lesson. That backend behavior was already implemented.
- The course builder already offered a Graded test lesson and linked a standalone graded assessment. It filtered out all other kinds.
- The actual lesson UI rendered the public Quiz page in an iframe. That page submitted through `quizApi`'s admin-token client, while the submit endpoint only recognizes member bearer tokens. The old API test manually supplied the member bearer and therefore did not prove the iframe UI worked.
- No survey kind, native member attempt history or admin per-question answer display existed. The assessment route did not require sign-in for a linked lesson. Manual completion routes did not enforce assessment passes, and ordinary progress writes checked drip timing without checking course prerequisites.

## Changes

- Replaced the iframe with a native lesson assessment using the existing member API client. Single choice, multiple choice, scale and text questions all work in the same lesson surface.
- Added Survey with no pass mark; survey submissions save responses and complete the lesson without producing a passed event. API forcibly clears pass marks/pass requirements for surveys even if a client submits them.
- Course lesson editor can create a quiz or survey directly, attach it on Save, and open the existing question editor. All assessment attempts are still visible in Marketing → Quizzes, including their member identity and readable answers.
- Graded settings include the pass mark, attempt cap, whether a pass is required before the following lesson unlocks, and editable pass/fail messages. Failed attempts can be retried while attempts remain. Turning off the pass requirement allows completion on submission.
- A required-pass quiz automatically keeps its following lesson locked. Existing explicit lesson prerequisites continue to work. Server checks now prevent manual-completion/progress requests from bypassing this rule.
- Linked assessment definition, submission and member-history reads require a live course grant and an unlocked lesson. Draft/missing assessment setup cannot be bypassed by marking its lesson complete.
- Member results reload from persisted attempts and show saved answers. Submission updates course progress and refreshes the current lesson/outline.
- Existing `assessment_completed` and `assessment_passed` events fire with a resolved contact identity. Survey submissions fire completion only.
- Migration: `054_lesson_assessments.sql`.

## Verification

- Both frontend and backend TypeScript checks PASS after the primary changes; root runs final integrated checks.
- `backend/scripts/test-integration.sh src/services/lessonAssessments.integration.test.ts`: 2/2 PASS against a fully migrated scratch database. Exercises fail → locked next → pass → unlocked next, no-prerequisite-checkbox required-pass gating, manual-next-lesson bypass refusal, draft-assessment bypass refusal, owner/stranger/anonymous read boundaries, persistent member and admin answer history, completion/pass event rows, optional-pass failure completion, all four survey question types, survey mark coercion, survey completion and absence of a passed event.
- Existing parity integration suite rerun: 9/9 PASS.
- Focused assessment/curriculum unit tests: 53/53 PASS.
- No SMTP sends in these lesson tests. All ZZ fixtures lived in dropped scratch databases; no staging data created by this lane.
- Full deployed browser authoring, visible native assessment interaction, and automation-action execution remain for Lane V. Event rows are verified; this lane does not claim an end-to-end live automation action.
