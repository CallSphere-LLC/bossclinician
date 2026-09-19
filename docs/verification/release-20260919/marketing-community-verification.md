# Marketing and community verification

Preview release `release20260919182104-f736b5f` served through host-preserving browser routing to K3s preview. This report separates preview from final public verification; final live JSON files are produced after cutover.

- `marketing.json`: 45 browser checks: 9 public routes × 320/390/768/1440/1920px. All returned200; no horizontal overflow, broken images, or page errors.
- `marketing-interactions.json`: retreat reservation anchor,18 rendered photos,14 FAQs open/close, contact fallback; Club marketing-plan vs Lounge masterclass placement and navigation; withdrawn standalone1:1/Reset offers absent; Boardroom retained.
- `community-preview.json`: UI-created free and monthly49 access groups; prices persisted after reload; generated checkout pages rendered correct totals and subscription terms. No payment was submitted. All7 Club CTAs point to the explicitly requested hosted checkout URL.
- `community-edit-preview.json`: existing monthly group changed to one-time99 then restored monthly49; each persisted.
- Native event3 created with empty external URL and external event4 with supplied URL. Both appeared in member event rail with their correct join destinations. One final source fix resets the new-event dialog to native every time it opens, including after a cancelled external selection.
- `member-navigation-preview.json`: actual member session across all5 widths; separately named community links; named access group and authorized channel visible; unowned paid channel absent; paid checkout enrollment visible. Authorized channel link navigated correctly. No page errors or overflow.
- `member-community-390.png` and `member-community-1440.png` manually inspected; member channel/access-group navigation and event rail fit. Admin pricing screenshots also inspected at390/1440.

Connected Figma references:
- Retreats: https://www.figma.com/design/dgnWmga3VcftWObQLRCkDT?node-id=3-2
- Community pricing and navigation: https://www.figma.com/design/dgnWmga3VcftWObQLRCkDT?node-id=5-2

Source checkout limitation: the retreats source-hosted checkout returned403 from Kajabi/Cloudflare in Chromium. Its exact source destination remains preserved, with a local contact fallback. No charge or checkout submission was attempted. Club exact target is checked again on public release.

Temporary fixture cleanup inventory: community9, groups7/8, generated offers16/17, events3/4, channels16/17/18, membership29 for existing QA member66 (member66 belongs to voice QA fixture and must not be independently deleted here). Group deletion archives generated offers; root handles final generated offer/product cleanup after confirming no orders. Final removal is confirmed below and in the commerce cleanup report.

## Final public release

Public `/api/health` confirmed release `20260919183929-f736b5f` before tests. Direct public member navigation passed all5 widths, with no errors or overflow (`member-navigation-live.json`). Direct public marketing interactions passed (`marketing-interactions.json`). Final admin price persistence and event-dialog reset passed; all7 Club CTAs have the requested URL. A real browser click reached the source-hosted Club checkout with HTTP200 and the expected6-month program copy, with no form or payment submission (`community-final-live.json`). The external Kajabi checkout emitted its own “Unexpected end of input” script error; our pages did not.

Cleanup completed through authenticated API: groups7/8 and community9 deleted; subsequent community read404 (`marketing-fixture-cleanup.json`). Related temporary channels/events/membership cascade with the community. Generated offers16/17 were subsequently deleted after all34 dependency checks returned zero. Products39/40, prices and links were also absent; see `community-commerce-cleanup.md`. Member66 belongs to the voice QA agent, who was notified that this lane no longer depends on it.

Final direct public responsive sweep completed:45/45 checks passed,9routes ×5widths, allHTTP200, no overflow/broken images/page errors. `marketing.json` now contains the direct public release run. Member390px public screenshot manually inspected. Voice QA agent independently removed its member66/community8 after both lanes completed.
