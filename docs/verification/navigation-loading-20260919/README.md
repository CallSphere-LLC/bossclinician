# Navigation loading verification — 2026-09-19

The original failure was reproduced by returning 404 for a lazy page module after loading `/courses`: selecting Club changed the URL but emptied the React root. Reloading restored the page. An actual previous Club module also returned 404 before this change.

The implementation preserves browser asset hashes across releases, deduplicates route imports, preloads menu destinations, displays a loading state, and catches route errors. A missing module gets one automatic document reload per URL per minute; persistent failure displays a retry screen instead of looping.

Verified on release `20260919200702-99df2fc`:

- A browser tab opened before rollout navigated to Club afterward without a refresh or JavaScript error.
- All 50 header menu selections passed across 320, 390, 768, 1440 and 1920 pixels. No horizontal overflow or page errors.
- Click-to-visible-heading median 125.5 ms, p95 559 ms, maximum 652 ms in this browser on the server network. These are navigation timings, not a claim about every visitor's network or full-page LCP.
- 210 direct page/size checks passed, covering 42 public routes including 14 courses and 8 blog articles. These checks verify server-rendered content and overflow; the separate menu and course-card checks exercise hydration/client navigation.
- A missing module recovered automatically. A persistently missing module reloaded exactly once and then displayed the usable error screen.
- Previous `/assets/Club-BY_a43_q.js` now returns HTTP 200 with JavaScript MIME and immutable caching. The deployment archived 667 module files from four frontend images.

See `after-matrix.json`, `public-pages.json`, `chunk-recovery.json`, screenshots and verification scripts. Checkout-related final release checks are recorded in the native-courses directory.
