# Lane 2 — New product entry point

Implemented; browser verification on local frontend with live read-only API data passed. Deployment and live retest remain for Lane V.

Before: root's live browser captured `/admin/products` with New product button count 0 (`/tmp/boss-products-run/products-before.png`); source only had overview sections.

After:

- All Products has New product opening a six-card picker: Course, Community, Coaching, Podcast, Newsletter, Download. Every card has a one-line description and feature list.
- Each Create action opens that type's existing creation dialog. A shared hook consumes `?new=1`, removing it from the address so reload after closing does not reopen the form.
- All Products now loads/counts and lists all six product types. Download counts exclude archived entries. Existing recurring plan and media shortcuts retained.
- Products navigation includes Downloads and `/admin/downloads` renders the focused catalogue view.
- Figma design context loaded and implemented using existing Modal, Button and console tokens: https://www.figma.com/design/rPPdw73COMRMvUULCKJlvv?node-id=2-155 . Cards wrap at narrower widths, preserving the design intent without fixed canvas overflow.

Validation: `npm --prefix frontend run typecheck` PASS. Local Vite 5191 browser using real live API GET responses, 2026-09-12:

- 1280px and 1440px: all six Create links visible, 0 picker controls beyond viewport.
- Clicked every option: Course → Add a course; Community → New community; Coaching → New coaching offer; Podcast → New show; Newsletter → New newsletter; Download → download creation form.
- No browser page errors. No records created or sends performed.
- Artifacts `/tmp/boss-products-run/lane2-local-results.json`, `lane2-picker-1280.png`, `lane2-picker-1440.png`; browser script `lane2-local.mjs`.

Owned files: Products.tsx, AdminApp.tsx, ui/nav.ts, ui/NewProductPicker.tsx, ui/useNewProductRequest.ts, CoursesAdmin.tsx, CommunityList.tsx, Coaching.tsx, Podcasts.tsx, Newsletters.tsx. Lane 1 ProductsCatalog supplies Download creation.
