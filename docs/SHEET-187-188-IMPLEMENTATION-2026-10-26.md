# Rows 187 and 188 implementation — 26-Oct-2026

Worktree: `/home/ubuntu/bc187-188`, branch `fix/bc187-188`, base `a1dce29`.
Primary commit: `0cfdd50`. Unicode/search-refresh follow-up accompanies this note.
No deployment, production source/database writes, customer submissions, payments,
or emails performed by this agent. Parent owns integrated Chrome QA and release.

## Row 187 — search inside a course

- Search is above the content on both course overview and lesson player, including mobile.
- A labeled search input, 300 ms debounce, Clear/Escape, live result count, no-results message, retry, keyboard focus, and normal lesson links retain the existing UI identity.
- `GET /api/member/library/:productSlug/search?q=…` checks the owned product and `loadCourseForMember` before reading content. It searches lesson/module titles plus **all unlocked lesson bodies and transcripts** in the selected course.
- Locked titles/unlock guidance may appear because the existing outline already exposes them. Locked body columns are never selected. Draft, scheduled, prerequisite-locked and other-course bodies cannot match. No assessment answers, private notes, tool state, attached-file contents, or embedded external documents are indexed.
- Searches never call the lesson-read endpoint or write viewed/progress records. Responses are private/no-store; existing member rate limiting applies. Query cap: 160 characters; first 100 matches returned with total count; excerpts capped at 220 characters.
- Results use the gated outline's slug, preserving Pauli's qualified duplicate-lesson slugs. Completion/unlock changes refresh the unchanged query; playback-position heartbeats do not. Switching member or course discards local search state.
- Admin preview remains on its separate authorization surface: it searches loaded outline titles only.

## Row 188 — real PDF download and explicit editable backup

- Primary header action is **Download PDF**. Export & backup separately offers Download PDF, Print / Save as PDF, Download backup (JSON), and Restore backup (JSON).
- Authenticated `POST /api/member/tool-state/living-business-plan/pdf` checks current tool entitlement and expected member identity, validates a bounded text-only payload, and generates an attachment with existing PDFKit. It includes the current editor snapshot, including pending/unsaved edits, and does not write saved state, revision, reviews, or archives.
- Export contains the plan year, all **66 fields across 11 annual sections**, blank-entry markers, review flags, and the existing acknowledgment/financial qualification. Long values paginate; footers do not create extra blank pages.
- The original `Annual_Living_Business_Plan.zip` defines this annual PDF scope. Its 66 field keys exactly match the native definitions. Dated strategic reviews and archived annual versions remain in the JSON backup, not silently folded into the current-year PDF. Archived plans retain their Print / Save as PDF and explicitly named archive JSON download.
- Supplied `boss-clinician-annual-plan-backup.json` has the expected type/version/data structure. Only schema/field names were inspected; no private values were printed, copied into tests, or incorporated into artifacts. Original reference files were untouched.
- Boardroom context (`the-board-room`) now uses Boardroom labels and links to `boardroom-ceo-dashboard`; Practice Elevation retains its own labels/link.
- Bundled OFL-licensed Noto Sans and Noto Emoji preserve Greek/Cyrillic names, combining accents, common symbols and emoji (monochrome), including joined/skin-tone sequences. CJK and any other genuinely unsupported glyphs receive an explicit browser-print fallback before download; no characters are silently dropped. Fonts and licenses ship through the existing backend asset-copy/build path. See `backend/src/assets/fonts/README.md` for official sources and hashes.

## Verification

- Frontend: **16 passing** focused tests (living plan persistence/restore, full export field coverage and escaping, search matching and completion/exemption invalidation); typecheck passes.
- Backend: **15 passing** search/PDF/font unit tests. Tests check locked-ID filtering, body/transcript matches, long final-field preservation, page-footers, PDF Unicode mappings and grapheme preservation. Typecheck and backend build pass.
- Scratch Postgres integration: **7 passing** real HTTP/database tests for unauthenticated/outsider access, no view/progress writes, draft/drip/prerequisite/scheduled/cross-course isolation, bounded queries/payloads, current-data PDF responses, unchanged stored state/revision/timestamp, identity swaps and expired/revoked access. Unique `bc187188-pg` container removed after testing.
- Frontend client and SSR builds pass with bounded memory; existing chunk-size/dynamic-import and Tailwind screen warnings remain.
- Synthetic six-page full-plan PDF rendered and reviewed. Greek/Cyrillic names and joined emoji were visually checked and recovered intact using `pdftotext`. No customer plan was used.
- Impeccable scoped refinement/context and mechanical UI scan completed; no findings. Actual integrated browser interaction QA remains with parent.

## Parent Chrome QA checklist

1. At `/library/the-board-room`, search an outline title, a module title, and a distinctive word found only in an unlocked lesson body/transcript. Confirm results without changing lesson progress. Repeat inside a lesson at desktop and 390 px width.
2. Exercise keyboard search, result links, Clear/Escape, unmatched query and retry. Search a locked title: guidance only, no clickable lesson or body excerpt. After completing/exempting a prerequisite, keep the same query and confirm results refresh. Open a duplicate-title result and confirm its qualified route reaches the intended module.
3. At `/library/the-board-room/lessons/meet-your-business-live-plan`, confirm Boardroom context and working CEO Dashboard link. On an authorized synthetic account, enter a value and immediately download PDF; confirm the pending edit, all 11 sections, final declaration, legible page breaks and footers. Check a Greek/Cyrillic name and joined emoji. Do not put customer financial data in QA artifacts.
4. Confirm JSON backup and restore remain explicit and retain reviews/archives; verify reload/account isolation using authorized synthetic accounts. In preview, the print option remains available without sending admin credentials to the member export endpoint.
5. Confirm PDF export failures leave the plan intact and expose Print / Save as PDF. Test a CJK entry for that explicit fallback if useful. Parent records actual Chrome/release outcomes separately.
