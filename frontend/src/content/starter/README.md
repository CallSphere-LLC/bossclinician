# Private Practice Starter Suite source reproduction

Source: https://www.bossclinician.com/startersuitecourse
Captured: 23 October 2026, in response to QA tracker row 162.

Rendered by `components/course/ImportedSalesPage.tsx` for
`/courses/private-practice-starter-suite`. It replaces the earlier hand-built
StarterSuiteSalesPage, whose copy had drifted from the original and whose
unclassed headings rendered white on lilac under the dark site theme.

The template keeps the source sections in order, with their images,
backgrounds, workbook-page scroller and "Start Today With Clarity & Confidence"
band. Not kept: the Kajabi header/footer (the app has its own), two webinar
sections the owner had hidden on every breakpoint, the exit and two-step opt-in
popups, and the ThriveCart card-brand strip. Scripts, forms, iframes, event
handlers and Kajabi editor/reveal attributes are removed. The accordion uses
native details/summary. The two Wistia videos are click-to-play posters
(`data-source-video`); the wrapper swaps in the player on click.

Content edits, both owner decisions: the separate "Pricing Formula Cheat Sheet"
bonus is omitted (migration 143), and FAQ access wording says the member
library instead of email.

Live catalogue is authoritative: `__SOURCE_PRICE__` and `__SOURCE_CHECKOUT__`
are filled from the published offer; lines marked `data-source-compare`
("usually $197 / you're saving $170") are dropped when the offer is not $27.

source.css is the Kajabi theme plus the theme-settings and section/block styles,
every selector scoped to `.starter-sales-page` and keyframes prefixed. Its tail
sets the page's own light palette (it must not inherit the site's dark-theme
ink) and darkens source colours under 4.5:1 (white-on-green buttons, white
headings on lilac, green value tags, the red total). Every referenced image and
font is local under /images/source-sales; assets.json maps source URL to file.

To revise copy, edit source.html as trusted application source. Do not accept
runtime/user HTML here. Do not restore Kajabi scripts, tracking or checkout URLs.
