-- Owner's launch brief, 1 Nov 2026: only the three group offers are public.
-- Existing purchasers keep what they have: access comes from access_grants, and
-- no payment plan or subscription is attached to the two offers closed here.

-- Private consulting checkouts close to new buyers.
UPDATE offers SET status = 'draft', updated_at = now()
 WHERE slug IN ('practice-reset-intensive', 'scale-and-reclaim-suite') AND status = 'published';

-- The Boardroom offer carried the private consulting description. Invitation-only stays.
UPDATE offers
   SET title = 'The Boardroom',
       description = $d$The Boardroom is an application-only, 12-month group mastermind for mental health practice owners: an intimate peer group of 6–8, capped at eight, guided by Yvette Howard, LCSW.
INCLUDED IN YOUR 12-MONTH TERM:
✔ 4 quarterly CEO strategy intensives, 3–4 hours each, with peer hot seats
✔ 8 momentum check-ins, 60 minutes each, in the months without an intensive
✔ 2 private CEO strategy sessions, 45 minutes each: an initial CEO Strategy Reset and a Midyear Executive Review
✔ 2 guest expert sessions each year, with speakers and topics selected by Boss Clinician
✔ Up to 2 voice-note questions per month, with a response targeted within 2 business days, excluding announced closures and holidays
✔ CEO Dashboard, Living Business Plan, Executive Circle and relevant vault resources for your term
The Boardroom is a peer mastermind: you implement your own strategy. Done-for-you operations and payer credentialing are not included. Any special CEO experience is optional and is not a guaranteed benefit.
There is no automatic renewal. Your access ends at the end of your 12-month term unless you enroll again.$d$,
       updated_at = now()
 WHERE slug = 'the-boss-boardroom' AND description LIKE '%private consulting%';

-- The application form on the public page shows no dollar figures.
UPDATE forms f
   SET fields = (
     SELECT jsonb_agg(
              CASE
                WHEN x.e->>'key' = 'payment_preference' THEN
                  jsonb_set(x.e, '{options}', '["Pay in full", "Quarterly installments", "I''d like to discuss the options before deciding"]'::jsonb)
                WHEN x.e->>'key' = 'commitment' THEN
                  jsonb_set(x.e, '{label}', to_jsonb(replace(x.e->>'label', 'the 12-month investment is $12,000', 'The Boardroom is a 12-month commitment')))
                ELSE x.e
              END ORDER BY x.ord)
       FROM jsonb_array_elements(f.fields) WITH ORDINALITY AS x(e, ord)
   )
 WHERE f.slug = 'boardroom-application';

-- /work-with-me is retired. Links already out in the world land on the home page.
INSERT INTO redirects (from_path, to_path, status_code, target_exists, note)
VALUES ('/work-with-me', '/', 301, true, 'Private consulting retired from public view (owner, 1 Nov 2026)')
ON CONFLICT (from_path) DO UPDATE SET to_path = EXCLUDED.to_path, status_code = 301, target_exists = true, note = EXCLUDED.note, updated_at = now();
UPDATE redirects SET to_path = '/', target_exists = true, updated_at = now() WHERE to_path = '/work-with-me';

-- Email funnels stop pointing at it.
UPDATE sequence_emails
   SET body_md = regexp_replace(
         replace(replace(replace(body_md,
           'Apply to work with me here', 'Find the program that fits you'),
           'Click here to work with me', 'Find the program that fits you'),
           'Click here to gain more support', 'Find the program that fits you'),
         'https://www\.bossclinician\.com/work-with-me(\?[^)"\s<]*)?', 'https://www.bossclinician.com/offer-quiz', 'g'),
       updated_at = now()
 WHERE body_md LIKE '%/work-with-me%';
