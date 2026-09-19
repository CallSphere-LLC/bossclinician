# Assistant modes and calm voice — 19 September 2026

Live release: `20260919-assistant-modes-marin`.
Source SHA256: `4f1b834e6a68ae8cfedaf66a0f963df853ee93636df1d00e419f0938c1b3dc69`.

The shared assistant now has persistent Text and Voice buttons with an explicit selected state and mode subtitle. Each mode occupies the full conversation area. Voice shows connecting/listening/speaking status, readable captions, time remaining and a fixed end-call button. Switching to Text ends voice and preserves the text draft. Collapsing and reopening the assistant retains the active mode and call.

Cancelled voice startup cannot resume after late microphone permission, admission, module loading or connection completion. Returning to Text also cancels a pending greeting/disclosure.

The public, member and admin default voice is now Marin. Both server and frontend persona instructions request a calm, warm tone, an unhurried conversational pace, short sentences and natural pauses. Voice model remains gpt-live-1; delegated reasoning remains gpt-6-astra. Production config was read back after release. A real call received live audio with Marin; calmness is subjective and was not scored by an automated acoustic test.

Figma: https://www.figma.com/design/dgnWmga3VcftWObQLRCkDT?node-id=8-10
Voice reference: https://developers.openai.com/api/docs/guides/realtime-conversations

## Evidence

- Frontend typecheck and 378 tests in 41 files passed; backend typecheck and 26 focused voice tests passed.
- Production client and SSR builds passed.
- Local and live browsers: 320x568, 390x800, 768x800, 1440x1000, 1920x1080 and 844x390 in light and dark themes; mode exclusivity, selected state, preserved draft, cancelled disclosure, retained mode after collapse and viewport containment passed with zero page errors.
- A controlled browser test delayed microphone permission until after switching to Text: the late microphone track was stopped and zero provider admissions occurred.
- A real production call returned `voice: marin`, delivered inbound WebRTC audio and captions, retained one session across collapse/reopen, then ended with HTTP 200 when Text was selected. All microphone tracks ended and the draft was restored.
- Test voice session was confirmed ended and then removed, along with four recording chunks. Storage and database readbacks found zero residual recording objects or session rows.
- Deployed backend, frontend and gateway containers are ready with zero restarts. Public health reports the intended release.

Deployment used an isolated snapshot of the previously deployed sources plus the nine assistant-related files. The unrelated changed contact verification script was excluded. Existing concurrent workspace changes were not committed.
