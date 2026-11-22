-- 22 Nov 2026 — Yvette's answers (round 2), items 9 and 10.
--
-- Item 9: "The old Leap Accelerator/Boss Builders Collective sales page should no
-- longer exist. I no longer offer Boss Builders Collective. ... You may redirect
-- the old URL to The Club ... Replace the separate Practice Reset Audit PDF and
-- its links with the Practice Freedom Audit."
-- Item 10: support@bossclinician.com is the product and program support address.
--
-- Every statement is guarded (id + current value, or ON CONFLICT), so re-running
-- is a no-op. Nothing here sends email, changes a price, or touches orders,
-- purchases, access grants, sent campaigns or contact records. Offer 1
-- (ppp-collective, "The Profitable Private Practice Boss Builders Collective")
-- and its product 25 are already archived, and the public offer, checkout and
-- cart queries require status = 'published', so no checkout can reach it; the
-- buyers' access grants are left exactly as they are.
--
-- nginx serves these 301s from nginx/redirects.map (committed alongside this
-- migration with the same rows); regenerate it from this table after deploy to
-- confirm they match: backend/scripts/generate-nginx-redirects.js.

-- ── Item 9a: old Leap Accelerator / Boss Builders addresses → The Club ───────
INSERT INTO redirects (from_path, to_path, status_code, target_exists, note) VALUES
  ('/profitable-private-practice-leap-accelerator', '/club', 301, true,
   'Leap Accelerator / Boss Builders Collective retired (Yvette, 22 Nov 2026)'),
  ('/leap-accelerator-thank-you', '/club', 301, true,
   'Leap Accelerator / Boss Builders Collective retired (Yvette, 22 Nov 2026)'),
  -- Linked from the paused Kajabi quiz emails (automation actions 1414-1416).
  ('/pppbossbuildersales', '/club', 301, true,
   'Boss Builders Collective sales page retired (Yvette, 22 Nov 2026)'),
  -- The archived offer's checkout address.
  ('/checkout/ppp-collective', '/club', 301, true,
   'Boss Builders Collective checkout retired (Yvette, 22 Nov 2026)')
ON CONFLICT (from_path) DO UPDATE
   SET to_path = EXCLUDED.to_path, status_code = 301, target_exists = true,
       note = EXCLUDED.note, updated_at = now();

-- Two older Boss Builders rows that pointed at the home page (was to_path '/').
UPDATE redirects
   SET to_path = '/club', target_exists = true,
       note = 'Boss Builders Collective retired → The Club (Yvette, 22 Nov 2026)',
       updated_at = now()
 WHERE from_path IN ('/boss-builders-sales-page', '/the-boss-builders-collective-thank-you-page')
   AND to_path = '/';

-- ── Item 9b: Practice Reset Audit → Practice Freedom Audit ────────────────────
-- The Freedom Audit page is /practice-reset-planner (form 44 `reset-planner`,
-- /reset-planner-form); its one PDF is /downloads/practice-freedom-audit.pdf.
-- The old PDF's exact address is redirected too, so the "Download now" link in
-- Reset Audit emails already delivered opens the Freedom Audit. Exact path only:
-- the Club's First 30 Days planner under /uploads/kajabi-rehost/ is not touched.
INSERT INTO redirects (from_path, to_path, status_code, target_exists, note) VALUES
  ('/reset-audit', '/practice-reset-planner', 301, true,
   'Practice Reset Audit replaced by the Practice Freedom Audit (Yvette, 22 Nov 2026)'),
  ('/reset-audit-form', '/reset-planner-form', 301, true,
   'Practice Reset Audit replaced by the Practice Freedom Audit (Yvette, 22 Nov 2026)'),
  ('/practice-reset-audit-ty', '/practice-reset-planner', 301, true,
   'Practice Reset Audit replaced by the Practice Freedom Audit (Yvette, 22 Nov 2026)'),
  ('/uploads/kajabi-rehost/practice-reset-audit-fillable-c996ffdf7c4c.pdf', '/downloads/practice-freedom-audit.pdf', 301, true,
   'Practice Reset Audit PDF replaced by the Practice Freedom Audit PDF (Yvette, 22 Nov 2026)')
ON CONFLICT (from_path) DO UPDATE
   SET to_path = EXCLUDED.to_path, status_code = 301, target_exists = true,
       note = EXCLUDED.note, updated_at = now();

-- Form 43 (`reset-audit`, the retired /reset-audit-form) stops taking sign-ups.
-- Was: published true, name "Practice Reset Audit — opt-in". Submissions are kept.
UPDATE forms
   SET published = false,
       name = 'Practice Reset Audit — opt-in (retired 22 Nov 2026; use Practice Freedom Audit)',
       updated_at = now()
 WHERE id = 43 AND slug = 'reset-audit' AND published = true;

-- Its automation 1366 (action 1371 mailed the old Reset Audit PDF). Was: active.
UPDATE automations
   SET status = 'paused', updated_at = now()
 WHERE id = 1366 AND status = 'active'
   AND trigger_config->>'formId' = '43';

-- Hiring-quiz "Not Yet" result email (automation 19, action 22, active). Was:
-- "5. Start with the free Practice Reset Audit to identify exactly what needs
-- restructuring first". Same line as frontend/src/content/hiringQuiz.ts.
UPDATE automation_actions
   SET config = jsonb_set(config, '{bodyMd}', to_jsonb(replace(config->>'bodyMd',
         'Start with the free Practice Reset Audit to identify',
         'Start with the free Practice Freedom Audit to identify'))),
       updated_at = now()
 WHERE id = 22 AND automation_id = 19 AND action_type = 'send_email'
   AND position('Start with the free Practice Reset Audit to identify' in config->>'bodyMd') > 0;

-- ── Item 9c: internal links in admin and email ───────────────────────────────
-- Funnel 27 "Sales funnel by Deborah" (Kajabi import, unpublished, no offer)
-- existed only to list the Leap Accelerator sales + thank-you pages in
-- Admin → Funnels. Its steps 56/57 go with it (ON DELETE CASCADE); nothing else
-- references funnels.
DELETE FROM funnels
 WHERE id = 27 AND kajabi_id = '2148658460' AND source = 'kajabi'
   AND published = false AND offer_id IS NULL;

-- Sequence 464 "Profitable Practice Post-Purchase Confirmation Email" is the
-- Leap Accelerator registration confirmation (email 1509). Nothing enrols into
-- it and it has no subscribers; archive it so it cannot be attached again.
UPDATE email_sequences
   SET status = 'archived', updated_at = now()
 WHERE id = 464 AND status = 'active'
   AND NOT EXISTS (SELECT 1 FROM sequence_subscriptions ss WHERE ss.sequence_id = 464);

-- Offer 115 (profitable-private-practices-ceu, published) bio, same sentence 216
-- fixed on course 53. Was: "the creator of Boss Builders Collective , where she coaches".
UPDATE offers
   SET description = replace(description,
         'the creator of Boss Builders Collective , where she coaches',
         'the creator of Boss Clinician, where she coaches'),
       updated_at = now()
 WHERE id = 115 AND slug = 'profitable-private-practices-ceu'
   AND position('the creator of Boss Builders Collective , where she coaches' in description) > 0;

-- ── Item 10: support@bossclinician.com for product support ───────────────────
-- Checkout "Where customers write if something goes wrong" was blank, so the
-- checkout printed no address. Was: "supportEmail": "".
UPDATE settings
   SET value = jsonb_set(value, '{supportEmail}', to_jsonb('support@bossclinician.com'::text)),
       updated_at = now()
 WHERE key = 'checkout' AND coalesce(value->>'supportEmail', '') = '';
