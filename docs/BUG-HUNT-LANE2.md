# Lane 2 — Public quiz

Status: **ALREADY FIXED on the deployed staging build; no application changes made.** The reported header-only state could not be reproduced on 12 September 2026 at approximately 19:19–19:23 UTC. Final post-deployment verification remains with Lane V.

## Current-live evidence

- URL: `https://bossclinician.callsphere.site/quiz/zz-test-practice-quiz`.
- Both normal-motion and reduced-motion browser sessions at 1280 × 1000 showed “How confident are you as a business owner?”, “Not confident at all”, and “New answer” after START. The progress label was “QUESTION 1 OF 1”. No page errors occurred.
- A real visitor completed START → first answer → first name and approved email → Show me my result. The submit endpoint returned HTTP 201. The visible result was “YOUR RESULT / New result”. The existing quiz result has no body content configured; its existing title was preserved.
- Database reread confirmed assessment attempt **7**, assessment **1**, contact **64**, name **ZZ Bug Hunt Quiz**, email **sagar+zz-bughunt-quiz-before@callsphere.ai**, response `[{"answerIds":[1],"questionId":1}]`, score **3/3**, completed **2026-09-12 19:22:54 UTC**.
- Reloading the quiz and pressing START again displayed the question. The completed response was verified in storage independently of the browser result screen.

## Evidence artifacts

- `/tmp/boss-bughunt/quiz-repro.json` and `quiz-repro.png`: normal motion, before/after DOM and screenshot.
- `/tmp/boss-bughunt/quiz-repro-reduced.json` and `quiz-repro-reduced.png`: reduced motion.
- `/tmp/boss-bughunt/quiz-result-before.json` and `quiz-result-before.png`: actual HTTP result and result screen.
- Reusable harnesses: `/tmp/boss-bughunt/quiz-repro.mjs` and `/tmp/boss-bughunt/quiz-complete.mjs`. For Lane V run the latter with `QUIZ_RUN=after` to use a distinct approved test email. The browser interacts with the main quiz email input; the footer also contains an email control.

## Shared path inspection

The public renderer is `frontend/src/pages/Quiz.tsx`. Lessons mount the separate `frontend/src/components/player/LessonAssessment.tsx` through `LessonBody.tsx`. They share assessment API data types, but not the START/question rendering component. No lesson renderer change is justified by this finding.

## Cleanup handoff

Remove this run's contact **64**, attempt **7**, and their linked disposable subscriptions/tags/jobs/events after final evidence collection. The existing assessment **1**, result **1**, tag **2**, and sequence **1** are pre-existing and must remain. The result's configured sequence enrollment is real; the only recipient introduced by this test is the approved address above. Do not erase the existing quiz to clean up an attempt.
