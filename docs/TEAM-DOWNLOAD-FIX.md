# Team invitation states and empty-download checkout protection

The pending-invite UI promised actions that only applied after acceptance. It now explains the distinction and provides actions appropriate to the person's actual state. Download source files remain missing; this release blocks new checkouts that cannot deliver files and makes the existing customer delivery gap explicit.

## Team behavior

- **Waiting to accept:** the status explains that the person cannot sign in yet. The Change dialog describes role editing and invitation withdrawal, explains when suspension becomes available, and offers **Withdraw invitation**. It no longer offers signing out a person who has not joined.
- **Accepted:** **Suspend access** and **Sign them out everywhere** are available. Suspension retains the account and history, revokes sessions, and blocks login and refresh. **Restore access** permits a fresh login without reviving old sessions.
- **Withdrawal:** revokes the unused invitation link and removes only its pending placeholder. It is distinct from suspending an accepted account.
- **Roles:** the five-role model and permission matrix remain. Fixed a related acceptance bug: changing a pending person's role now updates the invitation and acceptance preserves the current account role, rather than restoring the invitation's original role.
- No Kajabi team import was performed, and no invitation emails were sent by verification.

## Download protection and remaining delivery gap

The seven original download products still have zero attached files. Product 25, **The Profitable Private Practice Boss Builders Collective**, retains one existing access grant and is linked to the `ppp-collective` offer. The available media assets are unrelated to these products. No replacement content was invented or attached.

A shared server-side check now rejects new purchases when an included download has no files, an attached file is missing from storage, or an attached file is empty. It uses the same path resolver as member delivery. Coverage includes offer page/quote, checkout order creation, selected bumps, recursive bundle contents, multi-offer carts, upsells, and legacy course checkout links for converted downloads. The check runs before new order creation and Stripe requests. Existing grants are preserved. Existing subscriptions and already-created payment sessions are not cancelled by this change.

The admin now labels empty downloads **checkout blocked**, uses **linked to an offer** instead of suggesting they are ready for sale, and identifies existing customers as **awaiting files**. The Add files dialog explains what must be uploaded. Public checkout shows an unavailable message rather than presenting payment controls.

**Still required:** each product's original deliverables and their product mapping. Blocking a new empty purchase does not fulfil the existing customer's purchase. The seven products must not be marked delivered until those actual files have been uploaded and tested through the customer's library.

## Validation

- Expanded admin-session/invitation integration suite: **6 passed**.
- Download lifecycle and missing-file protection: **2 passed**, including actual-byte redownload, stranger access refusal, missing/zero-byte cases, bundles, bumps, cart checkout and upsells, recovery when bytes appear, and refusal again if bytes disappear. Refused checkouts leave the order count unchanged.
- Existing cart suite: **5 passed**, including paid-intent mocking, free checkout, gift grants, upsells, coupon scopes and recovery attribution. Its fixtures now contain real files because an empty download is intentionally no longer purchasable.
- Both TypeScript builds and the deployment passed; read-only smoke checks: **21 passed**.

[Integration evidence](verification/team-download-fix/integration.log), [download/upsell evidence](verification/team-download-fix/download-integration.log), [initial inventory](verification/team-download-fix/before.json), [live browser evidence](verification/team-download-fix/live.json).

## Final live result

The real browser journey passed from pending invitation through acceptance, edited-role preservation, suspension, login/refresh refusal, restoration and withdrawal. The withdrawn invitation ultimately returns 404. Both team and downloads pages passed at 320, 390, 768, 1440 and 1920px with no document overflow or browser exceptions.

The Collective's existing linked offer was found to be **draft**, and was left as draft. To exercise the new protection, a temporary published free offer was linked to the existing empty product. Its public offer, offer quote, cart quote and checkout POST all returned **503 with the missing-file explanation**. The visible checkout page showed that checkout was unavailable. The attempted checkout created **zero orders and zero contacts**. Paid checkout prevention, bundles, add-ons and upsells were exercised in the isolated integration tests.

[Cleanup evidence](verification/team-download-fix/cleanup.json) confirms all temporary accounts, invitations and the published verification offer were removed. The original offer remains draft, the customer's existing grant remains, and the original download files remain absent. No real charge or outbound invitation was made.
