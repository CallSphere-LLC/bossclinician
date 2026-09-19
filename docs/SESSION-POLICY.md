# Login session limits

| Audience | Access credential | Absolute login deadline |
| --- | --- | --- |
| Administrator | Five-minute cookie token, refreshed through the existing admin session | Eight hours after sign-in |
| Customer/member | Fifteen-minute in-memory bearer token, rotating HttpOnly refresh cookie | Thirty days after sign-in |

These are absolute session limits, not inactivity limits. Normal activity and background refresh
cannot extend the deadline. Signing in again starts a new session. Member refresh previously
extended the deadline by another thirty days on every rotation; rotations now inherit the
existing session row's expiry, including concurrent-refresh recovery. Refreshed member access
tokens and both browser cookies are limited to the same remaining lifetime.

Existing sessions retain their current stored deadline at deployment. Their next rotation carries
that deadline forward; the release does not forcibly log out every current customer.

The server rejects expired credentials. Authenticated browser pages check their session once a
minute and when the window regains focus, so an open protected screen leaves the authenticated
area after the server refuses the session. Temporary network/server errors alone do not prove
that the session ended. Login screens disclose the limits, and customer Security repeats its
thirty-day limit beside device/session management.

The concierge's admission, chat, transcript, catalog and recording calls reuse the application's
admin/member credential-refresh paths. A failed supplied credential receives HTTP 401 rather
than silently changing an authenticated concierge into a public visitor. Requests with no
credentials still receive the public concierge. An admin refresh cookie stays confined to the
admin origin; public calls do not perform an admin refresh.

Tests cover preservation of the original member deadline, simultaneous rotations, expired
session refusal, JWT/cookie expiry bounds, credential refresh for both concierge audiences,
and genuinely anonymous calls. Live session-expiry and browser verification evidence belongs
in the release verification directory.
