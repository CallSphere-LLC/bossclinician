-- Her checkout wording (sheet rows 195-196) on the DRAFT preview only. Live offers change at the switch.
UPDATE offers SET checkout_headline = $h$You’re One Step Away From The Boss Clinician Lounge$h$, description = $d$Get the strategy, tools, and ongoing support to make your established practice more sustainable.

**Your membership includes:**

- The Practice Elevation four-module signature curriculum.
- Monthly 90-minute live Strategy Sessions with Yvette.
- The Boss Clinician Toolkit with templates, workbooks, and trackers.
- The Practice Elevation Dashboard.
- A guided Private Practice Business Plan.
- Private Lounge community access.
- The Replay Vault.
- Access to live Lounge challenges throughout the year.

Access to membership content and ongoing benefits continues while your membership is active.

Questions before joining? Email [support@bossclinician.com](mailto:support@bossclinician.com).$d$,
       allow_gifting = false, show_in_cart = false, require_terms = false, updated_at = now()
 WHERE slug = 'lounge-billing-preview';
UPDATE offer_pricing_options p SET label = $l$Monthly Membership — $197/month$l$, updated_at = now()
  FROM offers o WHERE o.id = p.offer_id AND o.slug = 'lounge-billing-preview' AND p.minimum_months = 6;
INSERT INTO offer_pricing_options (offer_id, label, pricing_type, amount_cents, currency, interval_count, sort, active)
SELECT o.id, $l$Annual Membership — $1,997 for 12 months$l$, 'one_time', 199700, 'usd', 1, 2, true
  FROM offers o WHERE o.slug = 'lounge-billing-preview'
   AND NOT EXISTS (SELECT 1 FROM offer_pricing_options p WHERE p.offer_id = o.id AND p.pricing_type = 'one_time' AND p.amount_cents = 199700);
UPDATE offer_checkout_requirements r SET acknowledgments = $a$[{"key": "lounge-monthly", "version": 1, "text": "I understand that I am enrolling at $197 per month with a six-month minimum commitment totaling $1,182. After six months, my membership continues monthly unless canceled.", "linkLabel": "Read the Terms of Use and refund policy", "linkUrl": "/terms", "active": true, "appliesTo": "subscription"}, {"key": "lounge-annual", "version": 1, "text": "I understand that my $1,997 payment provides twelve months of membership and does not automatically renew.", "linkLabel": "Read the Terms of Use and refund policy", "linkUrl": "/terms", "active": true, "appliesTo": "one_time"}]$a$::jsonb, updated_at = now()
  FROM offers o WHERE o.id = r.offer_id AND o.slug = 'lounge-billing-preview';
