# Cart, lesson assessments and gifting — 12 September 2026

Implemented and deployed the missing entry points and verified the transaction and assessment services behind them.

## What changed

- **Cart:** public navigation now has a cart button and item count. `/cart` restores selections after hydration and tracks changes across tabs. Buyers can add multiple offers, review the subtotal, apply a discount and complete one checkout. The basket clears after success.
- **Course assessments:** each course section has **Add quiz** and **Add survey** beside **Add a lesson**. Saving creates a linked draft lesson and assessment and opens the questions editor. Quizzes start with an editable 70% pass mark and required passing. Surveys have no pass mark. The editor identifies course content, provides **Back to course**, and explains that both the assessment and its lesson need publishing. Assessments linked to another lesson are excluded from the lesson picker.
- **Gifts:** offers now have a dedicated **Send as a gift** tab. Its saved setting controls recipient details at checkout. The recipient gets product access; the payer retains the order and receipt. The editor explains recurring-payment and mixed-cart restrictions.

The earlier team suspend/restore and pending-invitation distinctions remain deployed. No team import was performed.

## Verification

| Check | Result and scope |
| --- | --- |
| Database integration | 10 tests passed across cart, gifting, lesson assessments and download readiness. The two lesson tests were rerun after adding course metadata to the editor response. Charged checkout uses a mocked Stripe client. |
| Browser cart | Three download offers survived reload; $27 + $47 + $97 = **$171 subtotal**. A 100% verification coupon completed one $0 order without a payment provider. Cart cleared and confirmation appeared. |
| Gift access | One payer-owned receipt, three offer totals and three recipient grants persisted. Recipient downloaded the exact bytes of all three files; payer was denied each download with 404. |
| Lesson behavior | Wrong answer saved 0% and kept the next lesson locked. Correct answer saved 100% and unlocked it. Both attempts survived reload. Single-choice, multiple-choice, rating and written survey answers persisted without pass/fail. |
| Live authoring | Created quiz and survey using the new section buttons, verified their lesson links and drafts after reload, returned through Back to course. Saved a draft offer's gifting setting and confirmed persistence. |
| Responsive/live regression | Course builder, offer editor, homepage and cart at 320/390/768/1440/1920: 20 checks, no document overflow or browser errors. Public admin API still returned 401. Smoke suite: 21/21 passed. Both TypeScript checks passed. |

Browser purchase and student tests loaded the deployed browser bundle while routing API requests to an isolated database and API container. That container had no payment or email provider credentials and no running worker. No live charge or outbound email was attempted. Live authoring/navigation tests used the actual deployed API with temporary drafts; all temporary live records were deleted afterward.

Evidence: [cart](verification/cart-lesson-gift/cart-result.json), [recipient downloads](verification/cart-lesson-gift/access-result.json), [persisted order and attempts](verification/cart-lesson-gift/persistence.json), [student quiz/survey](verification/cart-lesson-gift/lesson-result.json), [live authoring and responsive checks](verification/cart-lesson-gift/live-result.json).

## Boundaries

- Cart accepts up to 20 distinct one-time/free offers in the same currency. Subscriptions, payment plans and pay-what-you-want offers use individual checkout. A cart uses the first offer's upsell sequence, excluding offers already selected.
- Every offer in a gifted cart must permit gifting. Subscriptions and payment plans cannot be gifted.
- The original seven download products still need their genuine source files. Verification files existed only in the isolated container. Empty/missing-file products remain blocked from checkout; this release does not supply their missing content.
- Charged Stripe transactions and gift-email delivery were not exercised in this run.

Deployment verified healthy: backend `2e397f03ca7770324066398d73501cfd9917f9d8310c76eeba7c739b0cb1b76a`; frontend `4fd1b39a30cc8b6394d3da114afd509400573bfefb289e293048cc31ed61debd`.
