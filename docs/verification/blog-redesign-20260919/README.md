# Blog card redesign — 19 September 2026

Requested changes: professional blog cards designed in connected Figma; remove the horizontal topics list, “BEST OF” and the introductory paragraph; keep one bold “BOSS CLINICIAN BLOG” heading; tighten vertical spacing across screen sizes.

Figma: https://www.figma.com/design/hPsqBrJQQcEMoVVaRKJEJW?node-id=6-18 (desktop), node 6:198 (mobile). Editable layouts use SDS Card instances with Boss Clinician typography, local color/spacing variables, and the actual article images.

Implementation: page-scoped styles, a shared featured/archive article structure, one category per card, natural image colors, reading time, explicit read links, consistent footer placement and a responsive three/two/one-column grid. Existing article data, indexed topic archive URLs, author section and quiz destination retained.

Local validation: client and SSR build passed; 373 frontend tests passed. Browser coverage at 320/390/640/768/1024/1440/1920, each in dark and light themes, with reduced motion: no page errors, no broken images or horizontal overflow. All eight article destinations loaded; topic-archive reset and keyboard navigation passed. Heading-to-card spacing is 22–28px; featured-to-grid spacing is 22–32px; top and bottom collection spacing is 24–40px.

See local-results.json and live-results.json for measured browser observations. Live release evidence is recorded after deployment verification.

Live release `20260919193825-99df2fc` verified through the public health endpoint and K3s pod readback (all containers ready, zero restarts). The live browser matrix passed all 14 theme/width cases plus all eight article destinations, keyboard navigation and topic reset. A 1024×600 normal-motion browser pass also verified that all archive cards become visible without overflow. Screenshots are included alongside the results.
