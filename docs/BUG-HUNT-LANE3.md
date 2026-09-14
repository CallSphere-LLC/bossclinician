# Lane 3 — offer editor profiling, 12 September 2026

**ALREADY FIXED / could not reproduce in the requested test. No application change made.** This finding is the same item as Products/Checkout Lane 6c; it has not been implemented twice.

At staging `https://bossclinician.callsphere.site/admin/offers/2`, Chromium at 1440 × 1000 opened the Offers list once, then clicked the existing offer link and the editor's **All offers** button for five successive visits in the same SPA document. There was exactly one top-level document request, one Navigation Timing entry, and the same instrumented document UUID throughout. No reload, `goto`, new page or fresh tab occurred between visits.

| Visit | Link click to editor, Upsells tab and populated product picker visible |
| --- | ---: |
| 1 | 119 ms |
| 2 | 261 ms |
| 3 | 264 ms |
| 4 | 262 ms |
| 5 | 265 ms |

The live catalogue contained 18 products. Every visit rendered 17 unattached choices plus the selector's prompt; the remaining product was already attached to this offer. All six tabs were present. The harness opened the native selector without selecting anything, exercised the Price, Order bumps, Upsells and After purchase tabs, then returned to the selling tab on every visit.

Evidence of bounded activity:

- Exactly five admin GET requests per editor visit: the offer, catalogue, offers list, pages and layout statistics. No repeated effect fetch loop occurred.
- Zero active intervals and zero pending timeouts at each settled editor visit.
- Zero observed long tasks and zero browser page errors throughout.
- After explicit garbage collection, DOM nodes stayed at 865 and event listeners at 227 across all five visits. Used JavaScript heap rose from 7.75 MB to 8.79 MB; this short test does not establish a long-duration heap-leak absence.
- Source inspection: `frontend/src/pages/admin/OfferEditor.tsx` has a detail-loading effect whose callback depends only on `offerId`, and a mount-only catalogue/offers/pages effect. There are no timers or polling loops in that component. `AdminLayout.tsx` makes one statistics request per pathname with an unmount cancellation flag.
- The picker does eagerly render all choices, but they are plain native `<option>` nodes, not a catalogue of expensive mounted cards. The measured full current catalogue did not justify virtualisation or pagination.

Raw evidence: `/tmp/boss-bughunt/lane3-profile.json`; reproducible harness: `/tmp/boss-bughunt/lane3-profile.mjs`; screenshots: `/tmp/boss-bughunt/lane3-visit-1.png` through `lane3-visit-5.png`.

This evidence meets the requested five-visit under-two-second condition for the measured staging/browser session. It cannot disprove the previously observed intermittent freeze in another browser session or attribute an old freeze to a specific fix. Per the user's reproduce-before-fix instruction, profiling stops here and no speculative code change was applied. Root Lane V must repeat this acceptance after the auth changes deploy.

No offer, product or other business record was created or changed. Temporary admin session 174 is shared with root verification and must be revoked by root when finished; credential files are outside the repository and must be removed.
