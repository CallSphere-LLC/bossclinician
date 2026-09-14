# Bug hunt Lane 1: admin session storage

Implementation ready for root deployment and Lane V. These are implementation/test results, not claims that the new build is live.

## Reproduced before editing

On staging, a normal revocable owner session was read from `localStorage.bc_admin_token` on both `/admin` and `/library`. Page JavaScript on each surface used it for `GET /api/admin/contacts` and received 200. Only boolean readability and status were recorded, never the credential. Evidence: `/tmp/boss-bughunt/lane1/reproduction.json`. The temporary session's user-agent is `codex ZZ bughunt auth reproduction`; migration 057 revokes it with other legacy sessions. Delete this test session during cleanup and remove `/tmp/boss-bughunt/lane1/token` and backend `/tmp/zz-bughunt-auth-token`.

## Change

- `backend/src/auth/adminSession.ts` centralizes session issuance, transport, refresh, revocation and CSRF checks. Password and MFA checks remain in the login route. Existing authorization roles and module gates were not changed. `requireAuth` still queries the active administrator and revocable session on every request; current database role overrides the JWT claim.
- Login returns `{ user }`, no JWT. `bc_admin_session` (five minutes) and `bc_admin_refresh` (absolute eight hours) are HttpOnly, Secure, SameSite=Lax, host-only cookies with Path `/api/admin`. Only the opaque refresh hash is stored. Refresh cannot extend the session's absolute deadline. Concurrent tabs reference the same session row, so concurrent refresh does not invalidate another tab's in-flight request.
- Migration `057_admin_cookie_sessions.sql` revokes existing sessions. This intentionally requires administrators to sign in once after rollout and invalidates already copied seven-day credentials.
- Cookie writes reject a missing origin and reject cross-origin / cross-site requests before route handlers. Exact configured FRONTEND_ORIGIN is trusted. Nonbrowser explicit bearer API callers retain existing server semantics; newly issued bearer tokens also expire after five minutes. A member bearer never borrows an ambient admin cookie.
- One frontend `sessionFetch` transport adds cookies, shares a single in-flight refresh, and retries each expired request at most once. All admin JSON, CSV, PDF and media clients use it. Resumable XHR chunks also use cookies and retry once after refresh. Public/member clients retain their own semantics.
- The global entry point removes `bc_admin_token` before mounting or hydrating any page. Login also clears legacy storage. No frontend code reads or writes an admin credential in localStorage or sessionStorage.
- Sign-out waits for server revocation and cookie clearing. If the request fails, the admin remains signed in with an explicit error instead of falsely claiming success.

## XSS sweep

Static review found no executable `dangerouslySetInnerHTML`, `innerHTML`, `insertAdjacentHTML`, `document.write`, eval or Function constructor in frontend application code. No concrete stored-XSS defect was reproduced, so no speculative sanitizer changes were made.

| Surface | Evidence |
| --- | --- |
| Community posts/comments | `components/community/PostBody.tsx` creates React text nodes, permits links only through `safeLink`; `PostCard.tsx` and `CommentThread.tsx` reuse it. |
| DM bodies | `pages/member/CommunityMessages.tsx` renders `{m.body}` as escaped React text. |
| Lesson comments | `components/player/LessonComments.tsx` renders `{comment.body}` as React text. |
| Names | Community author components, member lists and result tables pass names as React children or escaped props. |
| Form answers in admin | `pages/admin/Forms.tsx` converts answers to strings with `readableAnswer`, then renders them as React children. |
| Quiz answers in admin | `pages/admin/AssessmentEditor.tsx` renders response text and question/answer labels as React children. |
| Markdown, including quiz result/lesson bodies | ReactMarkdown without rehypeRaw; raw HTML is text and default URL handling rejects javascript schemes. |
| Embed lessons | `EmbedFrame.tsx` srcDoc uses sandbox without allow-same-origin. Scripts cannot reach the parent origin. |
| Receipt HTML | `ReceiptFrame.tsx` sandbox has no allow-scripts; `backend/src/services/receiptDocument.ts` escapes interpolated user/business data. |

Two renderer tests inject img/script markup and javascript URLs into the actual PostBody and ReactMarkdown components; markup remains escaped and executable links are absent. This is bounded source review and renderer testing, not proof that every conceivable XSS payload is impossible. Root can add harmless literal markup to the live ZZ DM regression fixture to check actual persisted rendering.

## Completed checks

- Both backend/frontend typechecks passed.
- Frontend full suite: 21 files, 187 tests passed. `/tmp/boss-bughunt/lane1/frontend-all.log`.
- Auth + existing download lifecycle + receipt-access integration: 3 files, 15 tests passed on isolated PostgreSQL. `/tmp/boss-bughunt/lane1/regression-integration.log`.
- Four auth integration scenarios exercise real login: cookies/300-second JWT/no JSON token; same-session parallel reads and role demotion; missing/cross-origin CSRF refusals plus persisted same-origin write; expired access refresh/logout/suspension; member and anonymous 401 on contacts/offers/settings.
- New frontend tests cover shared concurrent refresh, no refresh on public/login/logout/403, no endless retry on refused refresh, legacy-storage cleanup, and the two renderer probes.

## Root Lane V contracts

1. Deploy backend/frontend together. Migration invalidates all previously issued admin sessions. Root's old bearer helper must issue a new token afterward.
2. Prefer a scoped ZZ owner with a known hashed password and POST `/api/admin/login` from an actual browser with the staging Origin. Set-Cookie must be captured through Playwright context cookies, not document.cookie. Body must contain only user data. Root can use `issueAdminCookieSession({adminUserId,email,role,userAgent,ip})` from `dist/auth/adminSession` for additional normal sessions; it returns `{accessToken,refreshToken,expiresAt}` for server-side tooling, never publicly. Add both cookies to Playwright with secure/httpOnly/sameSite Lax/path `/api/admin`; keep raw values out of reports.
3. Set a harmless old `bc_admin_token` marker before navigation. Confirm null on admin and member/public pages after navigation/reload; cookie names must also be absent from document.cookie. Reload mid-session and open a second tab, then check authenticated admin API reads and representative writes, upload, CSV/PDF clients.
4. Record login time. Run other verification while the five-minute access cookie expires naturally, then use the UI; expect initial 401, one POST `/api/admin/refresh` 204, retried 200. No token in storage or network JSON. Verify the refresh cookie's expiry does not slide.
5. POST state changes with cookie but hostile Origin / Sec-Fetch-Site and absent Origin:403. Correct staging Origin: normal route behavior. Test member-only Bearer on the three protected endpoints:401.
6. Save cookie values only in private verification memory, sign out via UI, then replay the old access and refresh cookies: both refused401; second tab reload returns to login. If testing a refreshed bearer directly, logout also revokes its parent session by signed sessionId.
7. Delete root's ZZ auth/session fixtures and the reproduction session/files. Never delete unrelated admin users or existing real sessions beyond the intentional migration.
