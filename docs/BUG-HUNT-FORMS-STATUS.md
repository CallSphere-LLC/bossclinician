# Lane 4 — Form double opt-in and embed status

Status sweep only. No application fixes or pre-existing form changes were made.

- **Double opt-in: PARTIAL (stored setting only; working confirmation flow absent).** A new published `ZZ Bug Hunt Double Opt In` form (19) saved and reread `doubleOptIn: true`; its public submission returned 201 and immediately created contact 65 as `email_marketing_status = subscribed`, while submission 15 retained `confirmed_at = NULL`. The builder, after reload, exposes no double opt-in control. Source inspection finds the flag in the schema and admin persistence only: the public submit path neither checks it nor sends a confirmation email or waits for confirmation. Gmail search for the approved test recipient returned no messages; therefore opening a confirmation and verifying a before/after transition is blocked by the absent implementation.
  Worth building: **Yes, before offering a double opt-in promise**; hold consent-sensitive enrollment until a signed, expiring confirmation succeeds and preserve existing unsubscribes.
- **Embed snippet: ABSENT.** The reloaded builder exposes a hosted `/f/zz-bug-hunt-double-opt-in` address, but no snippet, iframe/script copy control, or embed delivery endpoint exists in the form code. A hosted form is not an embeddable snippet. No invented iframe was used to claim support.
  Worth building: **Yes if external-site lead capture is required**; provide a copyable supported embed with sizing and a narrowly defined cross-origin contract.

Evidence: `/tmp/boss-bughunt/forms-status.json`, `forms-ui.json`, `forms-settings.png`; reproducible setup and inspection scripts `forms-status.mjs` and `forms-ui.mjs`. Source: `backend/src/routes/admin/formsV2.ts`, `backend/src/routes/public/growthPublic.ts`, `frontend/src/pages/admin/FormBuilder.tsx`.

Disposable test records left for coordinated Lane V cleanup: form **19**, submission **15**, contact **65** (`ZZ Bug Hunt Form`, `sagar+zz-bughunt-form@callsphere.ai`). No follow-up sequence, form tags, or lead creation was configured for this test. Root was notified of all IDs.
