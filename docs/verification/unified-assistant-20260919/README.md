# Unified assistant and retreat contrast — 19 September 2026

Requested changes: one floating chat icon with voice inside; a warm text/voice greeting with an optional, simple, step-by-step tour; readable text throughout the retreat page.

The shared launcher owns both text and voice on public, member and admin surfaces. The separate microphone launcher and promotional teaser are removed. Recording consent, captions and end-call controls appear inside chat. The voice session stays mounted when chat closes or navigation changes the page.

Both channels offer a tour before starting. Tour tools check the actual latest human message, consume at most one step per turn, and wait for next/continue before explaining the next detail. A question or refusal does not advance the tour. Repeated spoken next requests are tracked as separate turns. The initial text greeting is replaced with its full welcome instead of adding a second introduction.

The retreat page keeps its green/ivory palette in both site themes. Scoped styles prevent the shared theme from repainting sections or overriding headings; numbered labels and photo-caption contrast are strengthened.

Figma assistant states: https://www.figma.com/design/dgnWmga3VcftWObQLRCkDT?node-id=8-10

## Verification

- Frontend: 373 tests across 39 files passed; backend voice session focused checks: 3 passed, plus 23 policy checks. Both typechecks passed.
- Local browser: five widths (320/390/768/1440/1920), one closed chat icon, voice and recording consent inside the panel, no overflow or page errors.
- Direct production retreat audit: 2,220 text checks (222 elements at five widths in both themes), minimum contrast 5.27:1, no horizontal overflow or browser errors. Screenshots were visually inspected.
- Public assistant layout: all five widths passed with a single closed launcher and voice/disclosure inside chat. Admin and member browser checks passed at 320 and 1440 pixels, including navigation between authenticated pages.
- Real text provider: warm greeting appeared once; explicit yes started the tour; the assistant waited for next, then explained one detail. A separate no-thanks conversation stayed on the original page.
- Real spoken provider: warm spoken greeting, no navigation before consent, exactly one start-tour and one next-step tool call for two actual spoken requests. The same voice session survived page navigation and closing/reopening chat. Call end returned HTTP 200 and its database end timestamp was verified.
- All three public QA sessions and recording objects removed; all temporary admin/member accounts and dependent fixture rows removed, with zero residuals.

## Release

Production release `20260919192607-ec79b4f` was built directly from the working source and deployed to K3s. All four runtime images carry source SHA256 `f3089cb708b1118c8e2ac745391ea12aed9144d7951e3ce56b9238cd5d6f7b66`. Original database/storage preserved; all containers ready with zero restarts. Git synchronization follows deployment.
