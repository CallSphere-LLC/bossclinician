# Lane 4 — Podcast RSS status, 12 September 2026

**PARTIAL.** The public Boss Clinician Show feed returns HTTP 200 `application/rss+xml`, parses as RSS 2.0, but contains **zero episodes** and uses **1365 × 768** artwork; a temporary private feed correctly required a valid token and rejected missing, invalid and revoked tokens. **Worth building:** complete publishing readiness checks, suitable show artwork and an owner contact field before claiming directory readiness; the token-protected feed foundation already exists.

## Public feed evidence

Live URL: `https://bossclinician.callsphere.site/api/podcast/the-boss-clinician-show/rss.xml`.

- Python ElementTree successfully parsed the live response; RSS version 2.0, title, description, language, category, explicit flag and author were present.
- There were **0 `<item>` elements**, so no enclosure URL exists to test for valid audio MIME type, content length, HEAD response or byte-range playback. Those checks are **blocked by the absence of a published episode**, not passed.
- The referenced `/uploads/f0884621265b705d.png` fetched successfully with GET and HEAD 200, `image/png`, RGB, and a Last-Modified header. Pillow decoded its size as **1365 × 768 pixels**.
- Apple requires at least one episode, suitable artwork, unique episode enclosures with URL/length/type, and servers supporting HEAD and byte ranges. The zero-episode feed fails the first readiness condition. [Apple RSS requirements](https://podcasters.apple.com/support/823-podcast-requirements).
- Apple specifies show artwork between 1400 × 1400 and 3000 × 3000 pixels in JPEG or PNG. The current non-square 1365 × 768 image fails that specification. [Apple RSS tag and artwork guide](https://help.apple.com/itc/podcasts_connect/en.lproj/itcb54353390.html).
- The feed exposes no owner/email tag. Spotify's claiming procedure sends a verification code to the address in the RSS feed; **inference:** the current feed needs a usable ownership email before that procedure can complete. [Spotify claiming instructions](https://support.spotify.com/us/creators/article/claiming-your-podcast-on-spotify-for-creators/).
- No submission to Apple or Spotify was performed, and acceptance by either provider is **not verified**. A parseable feed alone is insufficient evidence.

## Private feed exercise

Created published private podcast **4**, slug `zz-bughunt-private-feed`, and temporary feed token **2** through the admin API, without sending email. A new HTTP request for each condition returned:

| Request | Observed result |
| --- | --- |
| No token | 403 |
| Invalid token | 403 |
| Valid issued token | 200, `application/rss+xml`, `Cache-Control: private, no-store`, expected ZZ title |
| Same token after admin revocation | 403 |

This verifies token authentication and revocation on the RSS route. The fixture had no episodes and no assigned listener, so member entitlement delivery, signed protected audio, real podcast-player subscriptions and paid-show playback were **not exercised** in this status sweep. No claim is made for those paths.

Removed podcast 4 through its normal DELETE API; PostgreSQL readback confirmed both podcast 4 and cascading token 2 had zero remaining rows. No other records or existing show settings were changed.

Evidence: `/tmp/boss-bughunt/podcast-rss.xml`, `podcast-rss-headers.txt`, `podcast-public-check.json`, `podcast-private-check.json`; repeatable private-feed harness `podcast-private-check.mjs` in the same directory.
