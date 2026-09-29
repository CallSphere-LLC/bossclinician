-- Kajabi admin verification, 2026-09-29 (QA sheet rows 32-43, second pass).
--
-- The first pass (078-084) had no Kajabi admin access. This pass read the
-- Kajabi admin directly (read-only) and fixes what differed:
--   * Offers (R40): Kajabi has 48 offers (6 are its own tests). 15 real ones
--     were missing here; they are added as DRAFTS (publishing creates the
--     Stripe price through the normal admin path). Every offer now carries
--     Kajabi's internal title (085) so the admin list reads like Kajabi's, and
--     Kajabi purchase cards are linked to their offer by that title.
--     Titles, prices and pricing options come from Kajabi's public checkout API
--     (www.bossclinician.com/api/offers/<token>/checkout); copy from the public
--     checkout page. "Private Practice Protection Pack" is Kajabi's PUBLISHED
--     protection-pack offer (G3qCF3TP); 081 had matched the draft one.
--   * Products (R37): the 4 Kajabi products missing here are added as drafts:
--     The Practice Elevation and The Lounge VIP (courses), Supervisory Billing
--     Documentation Packet and The Private Practice Planner (downloads).
--     Descriptions are Kajabi's product descriptions. No lessons/files: those
--     are the bulk content import, not done here.
--   * Lounge (R36/R41): Kajabi's Lounge has no member posts (feed empty; the
--     chat channel only holds 9 automatic meetup invites). Its channels are
--     "Boss Clinician Lounge" (chat) and "Q&A" (feed) in the Boss Clinician
--     Lounge group and "Q&A" (feed) in "how to improve relations". That group
--     is FREE in Kajabi (free published offer). The Lounge offer is
--     $1,997 or $197/month x 6 and grants The Practice Elevation + Credential
--     With Confidence; the Lounge VIP offer grants The Lounge VIP + The Practice
--     Elevation. Our fixture channel "Wins" (no posts, no members) is removed.
--   * Coaching (R35): Kajabi's Practice Reset Intensive client list, "Completed
--     X of N sessions" per client (086 columns). No other program has clients.
--   * Quinn Ford (R32): order #1001 used coupon 4UQUINN (-$3,997.00, total $0);
--     access granted to The Boss Move for its 5 Kajabi holders (product stays a
--     draft, so nothing new is visible to them until it is published).
--
-- No emails, no Stripe calls, no jobs. Idempotent: every statement is guarded.

-- 1. Missing Kajabi products (drafts, no content).
INSERT INTO courses (slug, title, subtitle, description, price_text, url, features, sort, published)
SELECT v.slug, v.title, '', v.description, '', '/courses/' || v.slug, '[]'::jsonb, v.sort, false
  FROM (VALUES
    ('the-practice-elevation', 'The Practice Elevation', $kj$Welcome to The Practice Elevation, a comprehensive course designed specifically for you to move from fully booked and underpaid to a practice that actually pays you what your work is worth. Using my proven B.O.S.S Blueprint, this course takes the guesswork out of restructuring your rates, your income sources, and your systems so you can focus on what truly matters most: serving your clients well while running a practice that pays you consistently, protects your time, and no longer depends on you doing everything yourself.$kj$, 30),
    ('the-lounge-vip', 'The Lounge VIP', $kj$VIP access to The Lounge$kj$, 31)
  ) AS v(slug, title, description, sort)
 WHERE NOT EXISTS (SELECT 1 FROM courses c WHERE c.slug = v.slug);
INSERT INTO products (slug, title, subtitle, description, kind, course_id, status, sort)
SELECT c.slug, c.title, '', c.description, 'course', c.id, 'draft', c.sort
  FROM courses c
 WHERE c.slug IN ('the-practice-elevation', 'the-lounge-vip')
   AND NOT EXISTS (SELECT 1 FROM products p WHERE p.slug = c.slug);
INSERT INTO products (slug, title, subtitle, description, kind, status, sort)
SELECT v.slug, v.title, '', v.description, 'download', 'draft', v.sort
  FROM (VALUES
    ('supervisory-billing-documentation-packet', 'Supervisory Billing Documentation Packet', '', 32),
    ('the-private-practice-planner', 'The Private Practice Planner', $kj$Build a Profitable Private Practice with your Private Practice Planner.$kj$, 33)
  ) AS v(slug, title, description, sort)
 WHERE NOT EXISTS (SELECT 1 FROM products p WHERE p.slug = v.slug);

-- 2. Kajabi internal titles on the offers that already exist (id -> Kajabi admin title).
UPDATE offers SET internal_title = $kj$[PIF] PPP Boss Builders $3997$kj$, updated_at = now() WHERE id = 1 AND internal_title = '';
UPDATE offers SET internal_title = $kj$The Fully Booked Therapist Toolkit$kj$, updated_at = now() WHERE id = 18 AND internal_title = '';
UPDATE offers SET internal_title = $kj$Credentialing Success Formula$kj$, updated_at = now() WHERE id = 19 AND internal_title = '';
UPDATE offers SET internal_title = $kj$Private Practice Starter Suite$kj$, updated_at = now() WHERE id = 20 AND internal_title = '';
UPDATE offers SET internal_title = $kj$Private Practice Protection Pack$kj$, updated_at = now() WHERE id = 21 AND internal_title = '';
UPDATE offers SET internal_title = $kj$Therapist Directory Guide$kj$, updated_at = now() WHERE id = 22 AND internal_title = '';
UPDATE offers SET internal_title = $kj$Ramp Up Rate Pricing Formula$kj$, updated_at = now() WHERE id = 23 AND internal_title = '';
UPDATE offers SET internal_title = $kj$Provider Partnership Guide$kj$, updated_at = now() WHERE id = 24 AND internal_title = '';
UPDATE offers SET internal_title = $kj$THE DIRECTORY MAKEOVER AUDIT - Single Profile Audit$kj$, updated_at = now() WHERE id = 32 AND internal_title = '';
UPDATE offers SET internal_title = $kj$Credentialing With Confidence Kit$kj$, updated_at = now() WHERE id = 33 AND internal_title = '';
UPDATE offers SET internal_title = $kj$MARKETING MASTERY FOR THERAPISTS$kj$, updated_at = now() WHERE id = 34 AND internal_title = '';
UPDATE offers SET internal_title = $kj$THERAPIST NICHE CLARITY ACCELERATOR$kj$, updated_at = now() WHERE id = 35 AND internal_title = '';
UPDATE offers SET internal_title = $kj$Rate Renegotiate Letter Templates$kj$, updated_at = now() WHERE id = 36 AND internal_title = '';
UPDATE offers SET internal_title = $kj$Prepare to Profit: Guided Meditation Journal For Therapists$kj$, updated_at = now() WHERE id = 37 AND internal_title = '';
UPDATE offers SET internal_title = $kj$Client Consultation Call Script$kj$, updated_at = now() WHERE id = 38 AND internal_title = '';
UPDATE offers SET internal_title = $kj$Boss Clinician Club Program$kj$, updated_at = now() WHERE id = 39 AND internal_title = '';
UPDATE offers SET internal_title = $kj$Lounge PIF Plan$kj$, updated_at = now() WHERE id = 40 AND internal_title = '';
UPDATE offers SET internal_title = $kj$Lounge VIP$kj$, updated_at = now() WHERE id = 41 AND internal_title = '';
UPDATE offers SET internal_title = $kj$90 Day 1:1 Coaching Support - One Time Payment$kj$, updated_at = now() WHERE id = 42 AND internal_title = '';
UPDATE offers SET internal_title = $kj$6 Month 1:1 Coaching Support - One Time Payment$kj$, updated_at = now() WHERE id = 43 AND internal_title = '';
UPDATE offers SET internal_title = $kj$12 Month 1:1 Consulting Support - One Time Payment$kj$, updated_at = now() WHERE id = 44 AND internal_title = '';
UPDATE offers SET internal_title = $kj$The Private Practice Blueprint-VIP$kj$, updated_at = now() WHERE id = 45 AND internal_title = '';

-- Protection pack: Kajabi's published offer G3qCF3TP (1 product, the one that sells).
UPDATE offers SET title = $kj$Private Practice Protection Pack$kj$, description = $kj$Protect Your Practice with The Practice Protection Pack
Legally-Sound, Plug-and-Play Forms & Templates for Mental Health Therapists.
Streamline Your Paperwork & Safeguard Your Practice in Minutes
As a mental health therapist, your priority is serving your clients—not stressing over paperwork and legal risks.
That’s why I created The Practice Protection Pack —a complete set of lawyer-reviewed, plug-and-play forms designed to keep your practice legally protected, professionally organized, and ethically sound.
Every document is crafted to help you stay compliant, set clear boundaries, and reduce liability —without the headache of figuring it all out yourself.
What’s Inside the Practice Protection Pack?
Every document is designed to protect your practice, streamline your processes, and keep you compliant.
For just $97, you’ll get:
✔️ Consent to Treat Forms – Ensure clients fully understand and agree to treatment.
✔️ Client Intake & Assessment Forms – Collect key client details effortlessly.
✔️ Progress Notes & Documentation Templates – Maintain ethical, organized records.
✔️ Payment & Financial Agreements – Prevent payment disputes and protect your income.
✔️ Client Communication Forms – Set clear boundaries and expectations.
✔️ Legal Protection Forms – Reduce liability and safeguard your practice.
✔️ Telehealth Consent Form – Ensure compliance for virtual sessions.
🎁 BONUS: HIPAA Compliance Checklist
To help you stay compliant and avoid costly mistakes, you’ll also receive a HIPAA Compliance Checklist —your quick-reference guide to ensuring your practice meets legal requirements.
Why You Need This Pack
These aren’t just generic, one-size-fits-all templates . Every form has been carefully crafted and reviewed by legal professionals to meet ethical and compliance standards.
✅ Lawyer-Reviewed & Compliant – Protect yourself from liability and legal risks.
✅ Editable & Customizable – Personalize each document to fit your practice needs.
✅ Saves You Hours of Work – No need to write forms from scratch.
✅ Instant Access – Download immediately and start using them today!
Get the Practice Protection Pack Today for Just $97!
Don’t leave your practice vulnerable. Get the forms you need to stay protected and legally secure—all for a one-time payment of $97.
Who Is This For?
✔️ Licensed therapists, counselors, psychologists, and social workers
✔️ Private practice owners who need legally sound documentation
✔️ Therapists offering in-person or virtual sessions
✔️ Anyone who wants to protect their practice and stay compliant
Hey, I'm Yvette and I'm a seasoned therapist and private practice coach.
I help mental health therapists protect their practices and simplify their paperwork with lawyer-reviewed, ready-to-use forms and templates. The Practice Protection Pack is based on my experience supporting private practice owners and understanding the unique legal and administrative challenges they face. I hope these resources make running your practice safer, easier, and more efficient!
FAQs
Q: Can I edit the forms?
A: Yes! Every template is fully customizable, so you can adapt them to your specific needs.
Q: Is this HIPAA compliant?
A: Yes! These documents are designed with HIPAA compliance in mind. However, you should always review them with your legal counsel to ensure they align with your specific practice.
Q: How do I access my forms?
A: As soon as you complete your purchase, you’ll receive instant access to download all the forms.
Protect Your Practice Today!
✅ Lawyer-Reviewed Forms
✅ Instant Download
✅ One-Time Payment of $97
🎁 Bonus: HIPAA Compliance Checklist Included (Limited Time!)$kj$, updated_at = now()
 WHERE id = 21 AND slug = 'private-practice-protection-pack' AND title = 'The Practice Protection Pack';

-- 3. Kajabi offers that were missing (all drafts; Kajabi's own test offers are left out).
INSERT INTO offers (title, internal_title, slug, status, description, pricing_type, amount_cents, currency, send_welcome_email)
SELECT $kj$Do's and Don'ts of Documentation Edu$kj$, $kj$Do's and Don'ts of Documentation Edu$kj$, $kj$dos-and-donts-of-documentation-edu$kj$, $kj$draft$kj$, $kj$The Do's & Don'ts of Clinical Documentation
Date: September 25, 2026
Time: 1:00 to 4:30 PM PT
Format: Live on Zoom
Replay: 60 Days Access
What's included:
210-minute live CEU workshop
3.5 Ethics CE contact hours
Audit-Proof Documentation Toolkit
Live Q&A with Yvette
Elizabeth W., LCPC
"It was a very good wake up call about all the elements needed to be audit proof. I will never be the same as a clinician."$kj$, $kj$one_time$kj$, 12700, 'usd', true
 WHERE NOT EXISTS (SELECT 1 FROM offers WHERE slug = $kj$dos-and-donts-of-documentation-edu$kj$);

INSERT INTO offers (title, internal_title, slug, status, description, pricing_type, amount_cents, currency, send_welcome_email)
SELECT $kj$Do's and Don'ts of Documentation CE$kj$, $kj$Do's and Don'ts of Documentation CE$kj$, $kj$dos-and-donts-of-documentation-ce$kj$, $kj$draft$kj$, $kj$The Do's & Don'ts of Clinical Documentation
Date: September 25, 2026
Time: 1:00 to 4:30 PM PT
Format: Live on Zoom
Replay: 60 Days Access
What's included:
210-minute live CEU workshop
3.5 Ethics CE contact hours
Audit-Proof Documentation Toolkit
Live Q&A with Yvette
Elizabeth W., LCPC
"It was a very good wake up call about all the elements needed to be audit proof. I will never be the same as a clinician."$kj$, $kj$one_time$kj$, 16700, 'usd', true
 WHERE NOT EXISTS (SELECT 1 FROM offers WHERE slug = $kj$dos-and-donts-of-documentation-ce$kj$);

INSERT INTO offers (title, internal_title, slug, status, description, pricing_type, amount_cents, currency, send_welcome_email)
SELECT $kj$Bali Shared Room$kj$, $kj$Shared Room$kj$, $kj$bali-shared-room$kj$, $kj$draft$kj$, $kj$Your $500 deposit is non-refundable and reserves your spot in the Release. Restore. Reconnect. Retreat in Bali, June 15–20, 2027. This is not a free trial — your card will be charged $500 today. Your remaining balance must be paid in full by June 8, 2027. Monthly payment amounts are determined by your registration date. All payments are non-refundable. By completing your deposit, you confirm that you have read and agree to the full Retreat Terms of Service and Trip Agreement . Travel insurance is strongly recommended — visit trawickinternational.com.$kj$, $kj$one_time$kj$, 450000, 'usd', true
 WHERE NOT EXISTS (SELECT 1 FROM offers WHERE slug = $kj$bali-shared-room$kj$);
INSERT INTO offer_pricing_options (offer_id, label, pricing_type, amount_cents, interval, interval_count, installment_count, sort)
SELECT o.id, $kj$$500.00 deposit today, then $445.00/month for 9 payments$kj$, 'payment_plan', 44500, $kj$month$kj$, 1, 9, 1 FROM offers o
 WHERE o.slug = $kj$bali-shared-room$kj$ AND NOT EXISTS (SELECT 1 FROM offer_pricing_options x WHERE x.offer_id = o.id AND x.pricing_type = 'payment_plan');

INSERT INTO offers (title, internal_title, slug, status, description, pricing_type, amount_cents, currency, send_welcome_email)
SELECT $kj$Bali Private Room$kj$, $kj$Private Room$kj$, $kj$bali-private-room$kj$, $kj$draft$kj$, $kj$Your $500 deposit is non-refundable and reserves your spot in the Release. Restore. Reconnect. Retreat in Bali, June 15–20, 2027. This is not a free trial — your card will be charged $500 today. Your remaining balance must be paid in full by June 8, 2027. Monthly payment amounts are determined by your registration date. All payments are non-refundable. By completing your deposit, you confirm that you have read and agree to the full Retreat Terms of Service and Trip Agreement . Travel insurance is strongly recommended — visit trawickinternational.com.$kj$, $kj$one_time$kj$, 550000, 'usd', true
 WHERE NOT EXISTS (SELECT 1 FROM offers WHERE slug = $kj$bali-private-room$kj$);
INSERT INTO offer_pricing_options (offer_id, label, pricing_type, amount_cents, interval, interval_count, installment_count, sort)
SELECT o.id, $kj$$500.00 deposit today, then $556.00/month for 9 payments$kj$, 'payment_plan', 55600, $kj$month$kj$, 1, 9, 1 FROM offers o
 WHERE o.slug = $kj$bali-private-room$kj$ AND NOT EXISTS (SELECT 1 FROM offer_pricing_options x WHERE x.offer_id = o.id AND x.pricing_type = 'payment_plan');

INSERT INTO offers (title, internal_title, slug, status, description, pricing_type, amount_cents, currency, send_welcome_email)
SELECT $kj$The Lounge VIP$kj$, $kj$VIP Extra details$kj$, $kj$the-lounge-vip-free$kj$, $kj$draft$kj$, $kj$$kj$, $kj$free$kj$, 0, 'usd', true
 WHERE NOT EXISTS (SELECT 1 FROM offers WHERE slug = $kj$the-lounge-vip-free$kj$);
INSERT INTO offer_products (offer_id, product_id, sort)
SELECT o.id, p.id, 0 FROM offers o, products p WHERE o.slug = $kj$the-lounge-vip-free$kj$ AND p.slug = $kj$the-lounge-vip$kj$
   AND NOT EXISTS (SELECT 1 FROM offer_products x WHERE x.offer_id = o.id AND x.product_id = p.id);

INSERT INTO offers (title, internal_title, slug, status, description, pricing_type, amount_cents, currency, send_welcome_email)
SELECT $kj$Supervisory Billing Documentation Packet$kj$, $kj$Supervisory Billing Documentation Packet$kj$, $kj$supervisory-billing-documentation-packet$kj$, $kj$draft$kj$, $kj$$kj$, $kj$one_time$kj$, 4700, 'usd', true
 WHERE NOT EXISTS (SELECT 1 FROM offers WHERE slug = $kj$supervisory-billing-documentation-packet$kj$);
INSERT INTO offer_products (offer_id, product_id, sort)
SELECT o.id, p.id, 0 FROM offers o, products p WHERE o.slug = $kj$supervisory-billing-documentation-packet$kj$ AND p.slug = $kj$supervisory-billing-documentation-packet$kj$
   AND NOT EXISTS (SELECT 1 FROM offer_products x WHERE x.offer_id = o.id AND x.product_id = p.id);

INSERT INTO offers (title, internal_title, slug, status, description, pricing_type, amount_cents, currency, send_welcome_email)
SELECT $kj$Audit Proof Your Practice-On-Demnad- CEUs Included$kj$, $kj$Audit Proof On Demand$kj$, $kj$audit-proof-on-demand$kj$, $kj$draft$kj$, $kj$Protect Your Practice. Protect Your Peace.
Join Yvette Howard, LCSW , Clinical Director and Founder of Boss Clinician, for a 90-minute CEU workshop that breaks down how to protect your practice from audits, billing errors, and compliance pitfalls — without getting overwhelmed.
You’ll Learn How To:
Identify the most common audit triggers therapists face
Write documentation that demonstrates medical necessity
Apply ethical billing practices to protect your license
Prepare for Medicaid, Medicare, and UHC audits with confidence
Create internal systems that make your practice audit-proof
Check out what past trainees said 👇$kj$, $kj$one_time$kj$, 7700, 'usd', true
 WHERE NOT EXISTS (SELECT 1 FROM offers WHERE slug = $kj$audit-proof-on-demand$kj$);

INSERT INTO offers (title, internal_title, slug, status, description, pricing_type, amount_cents, currency, send_welcome_email)
SELECT $kj$Audit Proof On-Demand- Educational Only$kj$, $kj$Audit Proof On Demand Educational$kj$, $kj$audit-proof-on-demand-educational$kj$, $kj$draft$kj$, $kj$Protect Your Practice. Protect Your Peace.
Join Yvette Howard, LCSW , Clinical Director and Founder of Boss Clinician, for a 90-minute educational workshop that breaks down how to protect your practice from audits, billing errors, and compliance pitfalls — without getting overwhelmed.
You’ll Learn How To:
Identify the most common audit triggers therapists face
Write documentation that demonstrates medical necessity
Apply ethical billing practices to protect your license
Prepare for Medicaid, Medicare, and UHC audits with confidence
Create internal systems that make your practice audit-proof
Check out what past trainees said 👇$kj$, $kj$one_time$kj$, 5700, 'usd', true
 WHERE NOT EXISTS (SELECT 1 FROM offers WHERE slug = $kj$audit-proof-on-demand-educational$kj$);

INSERT INTO offers (title, internal_title, slug, status, description, pricing_type, amount_cents, currency, send_welcome_email)
SELECT $kj$Audit Proof Your Practice - CEUs Included$kj$, $kj$Protect Your Practice Training$kj$, $kj$protect-your-practice-training$kj$, $kj$draft$kj$, $kj$Protect Your Practice. Protect Your Peace.
Join Yvette Howard, LCSW , Clinical Director and Founder of Boss Clinician, for a 90-minute CEU workshop that breaks down how to protect your practice from audits, billing errors, and compliance pitfalls — without getting overwhelmed.
You’ll Learn How To:
Identify the most common audit triggers therapists face
Write documentation that demonstrates medical necessity
Apply ethical billing practices to protect your license
Prepare for Medicaid, Medicare, and UHC audits with confidence
Create internal systems that make your practice audit-proof
Training Details
Date: January 30, 2026
Time: 1:00 PM/ 4 PM EST
Location: Live on Zoom
CEUs: 1.5 Ethics CEUs (Nevada Board Approved)
Instructor: Yvette Howard, LCSW$kj$, $kj$one_time$kj$, 9700, 'usd', true
 WHERE NOT EXISTS (SELECT 1 FROM offers WHERE slug = $kj$protect-your-practice-training$kj$);

INSERT INTO offers (title, internal_title, slug, status, description, pricing_type, amount_cents, currency, send_welcome_email)
SELECT $kj$Audit Proof Your Practice- Educational Only$kj$, $kj$Protect Your Practice Training Educational Only$kj$, $kj$protect-your-practice-training-educational$kj$, $kj$draft$kj$, $kj$Protect Your Practice. Protect Your Peace.
Join Yvette Howard, LCSW , Clinical Director and Founder of Boss Clinician, for a 90-minute educational workshop that breaks down how to protect your practice from audits, billing errors, and compliance pitfalls — without getting overwhelmed.
You’ll Learn How To:
Identify the most common audit triggers therapists face
Write documentation that demonstrates medical necessity
Apply ethical billing practices to protect your license
Prepare for Medicaid, Medicare, and UHC audits with confidence
Create internal systems that make your practice audit-proof
Training Details
Date: January 30, 2026
Time: 1:00 PM/4:00 PM EST
Location: Live on Zoom
Instructor: Yvette Howard, LCSW$kj$, $kj$one_time$kj$, 6700, 'usd', true
 WHERE NOT EXISTS (SELECT 1 FROM offers WHERE slug = $kj$protect-your-practice-training-educational$kj$);

INSERT INTO offers (title, internal_title, slug, status, description, pricing_type, amount_cents, currency, send_welcome_email)
SELECT $kj$Profitable Private Practices: Training For Clinically- Aligned Private Practices$kj$, $kj$CEU course only$kj$, $kj$profitable-private-practices-ceu$kj$, $kj$draft$kj$, $kj$Profitable Private Practices:
Training for Clinically-Aligned Private Practices
Profitable Private Practices
CE Hours Included: 4 Core Hours (See NBCC content area alignment below) Format: On-Demand Training (Asynchronous Learning) – Watch at your own pace. Pause, rewind, and revisit the material anytime. Investment: $149 (LIFETIME access!) Presented by: Yvette Howard, LCSW (see bio below) Instruction Level: Intermediate Target Audience: Licensed Mental Health Professionals, including Social Workers, Counselors, Marriage & Family Therapists, Psychologists, Pre-licensed Therapists, and other Behavioral Health Providers
Workshop Description:
Launching a private practice can be both liberating and overwhelming for mental health professionals. While graduate school prepares us to serve clients, it often leaves gaps in the business and ethical side of building a sustainable practice.
This comprehensive training bridges that gap. We’ll cover the essential components of establishing a legally sound, ethically responsible, and clinically-aligned private practice. From deciding between practice models and setting session fees, to building your brand and streamlining your systems — you’ll walk away with clarity and a practical roadmap.
Through downloadable template and real-life examples, you’ll learn how to build a business that supports both your clients' needs and your professional sustainability. This course is ideal for clinicians who want to start private practice the right way, without compromising care, access, or ethical integrity.
Educational Objectives:
In this workshop, you will learn how to:
Identify the legal, ethical, and financial components necessary to launch a private mental health practice.
Design a comprehensive business plan that includes niche definition, branding, pricing, and administrative systems.
Formulate marketing, client onboarding, and retention strategies to attract and serve their ideal clientele.
Explain the implications of insurance credentialing, private pay models, and documentation best practices.
Presented by: Yvette Howard, LCSW
Yvette is a Licensed Clinical Social Worker, business strategist, and private practice mentor with over 8 years of experience in the mental health field. She is the founder of Brighter Tomorrow Therapy — a thriving group practice — and the creator of Boss Builders Collective , where she coaches therapists to launch and scale private practices with confidence and clarity. Yvette holds a Master’s in Social Work and is currently completing her Doctorate in Organizational Leadership.
Having gone from burnt-out employee to empowered practice owner, she now helps other clinicians do the same — without sacrificing ethics, access, or clinical quality. Her passion lies in demystifying the private practice process for therapists who are ready to lead with integrity and profit with purpose.$kj$, $kj$one_time$kj$, 14900, 'usd', true
 WHERE NOT EXISTS (SELECT 1 FROM offers WHERE slug = $kj$profitable-private-practices-ceu$kj$);
INSERT INTO offer_products (offer_id, product_id, sort)
SELECT o.id, p.id, 0 FROM offers o, products p WHERE o.slug = $kj$profitable-private-practices-ceu$kj$ AND p.slug = $kj$profitable-private-practices-training$kj$
   AND NOT EXISTS (SELECT 1 FROM offer_products x WHERE x.offer_id = o.id AND x.product_id = p.id);

INSERT INTO offers (title, internal_title, slug, status, description, pricing_type, amount_cents, currency, send_welcome_email)
SELECT $kj$The Private Practice Planner$kj$, $kj$The Private Practice Planner$kj$, $kj$the-private-practice-planner$kj$, $kj$draft$kj$, $kj$Don’t Just Learn It… Build It
You’re about to get the strategy…
But if you want to actually organize, implement, and launch your private practice step-by-step , you need this.
The Private Practice Planner
This workbook turns your learning experience from the course into real action and real results.
Instead of feeling stuck or overwhelmed, you’ll have:
✔️ Step-by-step worksheets to build your practice ✔️ Pricing + income planning tools ✔️ Marketing + content planning templates ✔️ Business, branding, and credentialing checklists ✔️ Mindset + growth exercises to keep you moving
All structured in one place so you can build as you learn
Why You Need This
Without a plan → you’ll overthink and delay With this planner → you’ll execute with clarity and confidence
Add It Now for Just $39
Turn this course into a fully built, profitable practice—faster.$kj$, $kj$one_time$kj$, 3900, 'usd', true
 WHERE NOT EXISTS (SELECT 1 FROM offers WHERE slug = $kj$the-private-practice-planner$kj$);
INSERT INTO offer_products (offer_id, product_id, sort)
SELECT o.id, p.id, 0 FROM offers o, products p WHERE o.slug = $kj$the-private-practice-planner$kj$ AND p.slug = $kj$the-private-practice-planner$kj$
   AND NOT EXISTS (SELECT 1 FROM offer_products x WHERE x.offer_id = o.id AND x.product_id = p.id);

INSERT INTO offers (title, internal_title, slug, status, description, pricing_type, amount_cents, currency, send_welcome_email)
SELECT $kj$Directory Makeover Audit$kj$, $kj$Therapist Directory Audit$kj$, $kj$therapist-directory-audit$kj$, $kj$draft$kj$, $kj$$kj$, $kj$one_time$kj$, 6700, 'usd', true
 WHERE NOT EXISTS (SELECT 1 FROM offers WHERE slug = $kj$therapist-directory-audit$kj$);

INSERT INTO offers (title, internal_title, slug, status, description, pricing_type, amount_cents, currency, send_welcome_email)
SELECT $kj$Practice Foundations Intensives$kj$, $kj$90 Day 1:1 Consulting Support - One Time Payment$kj$, $kj$practice-foundations-intensives$kj$, $kj$draft$kj$, $kj$$kj$, $kj$one_time$kj$, 350000, 'usd', true
 WHERE NOT EXISTS (SELECT 1 FROM offers WHERE slug = $kj$practice-foundations-intensives$kj$);
INSERT INTO offer_products (offer_id, product_id, sort)
SELECT o.id, p.id, 0 FROM offers o, products p WHERE o.slug = $kj$practice-foundations-intensives$kj$ AND p.slug = $kj$practice-reset-intensive$kj$
   AND NOT EXISTS (SELECT 1 FROM offer_products x WHERE x.offer_id = o.id AND x.product_id = p.id);

-- Boardroom: Kajabi also sells it as $3,000 every 3 months ("12 Month 1:1
-- Consulting Support - 4 x Payments", a subscription in Kajabi).
INSERT INTO offer_pricing_options (offer_id, label, pricing_type, amount_cents, interval, interval_count, sort)
SELECT 44, '$3,000.00 every 3 months', 'subscription', 300000, 'month', 3, 1
 WHERE EXISTS (SELECT 1 FROM offers WHERE id = 44 AND slug = 'the-boss-boardroom')
   AND NOT EXISTS (SELECT 1 FROM offer_pricing_options WHERE offer_id = 44 AND pricing_type = 'subscription');

-- Products Kajabi's offers grant (the Club, the Lounge, the Lounge VIP).
INSERT INTO offer_products (offer_id, product_id, sort)
SELECT v.offer_id, p.id, v.sort
  FROM (VALUES (39, 'the-boss-move', 0),
               (40, 'the-practice-elevation', 1), (40, 'credential-with-confidence', 2),
               (41, 'the-lounge-vip', 0), (41, 'the-practice-elevation', 1)) AS v(offer_id, slug, sort)
  JOIN products p ON p.slug = v.slug
 WHERE EXISTS (SELECT 1 FROM offers o WHERE o.id = v.offer_id)
   AND NOT EXISTS (SELECT 1 FROM offer_products x WHERE x.offer_id = v.offer_id AND x.product_id = p.id);

-- 4. Link Kajabi purchase cards to their offer by Kajabi's internal title.
UPDATE purchases pu SET offer_id = o.id, updated_at = now()
  FROM (VALUES
  ($kj$Credentialing With Confidence Kit$kj$, $kj$credential-with-confidence$kj$),
  ($kj$Protect Your Practice Training$kj$, $kj$protect-your-practice-training$kj$),
  ($kj$Protect Your Practice Training Educational Only$kj$, $kj$protect-your-practice-training-educational$kj$),
  ($kj$Do's and Don'ts of Documentation CE$kj$, $kj$dos-and-donts-of-documentation-ce$kj$),
  ($kj$Do's and Don'ts of Documentation Edu$kj$, $kj$dos-and-donts-of-documentation-edu$kj$),
  ($kj$The Private Practice Blueprint-VIP$kj$, $kj$private-practice-blueprint-vip$kj$),
  ($kj$Private Room$kj$, $kj$bali-private-room$kj$),
  ($kj$Shared Room$kj$, $kj$bali-shared-room$kj$),
  ($kj$The Fully Booked Therapist Toolkit$kj$, $kj$fully-booked-toolkit$kj$),
  ($kj$Boss Clinician Club Program$kj$, $kj$the-club$kj$),
  ($kj$CEU course only$kj$, $kj$profitable-private-practices-ceu$kj$),
  ($kj$90 Day 1:1 Coaching Support$kj$, $kj$practice-reset-intensive$kj$),
  ($kj$90 day 1:1 Coaching Support - 3 x Payments$kj$, $kj$practice-reset-intensive$kj$),
  ($kj$90 Day 1:1 Consulting Support - One Time Payment$kj$, $kj$practice-foundations-intensives$kj$),
  ($kj$The Practice Protection Pack$kj$, $kj$private-practice-protection-pack$kj$),
  ($kj$THE DIRECTORY MAKEOVER AUDIT - Two-Profile Bundle$kj$, $kj$directory-makeover-audit$kj$),
  ($kj$Therapist Directory Guide$kj$, $kj$from-profile-to-profit$kj$),
  ($kj$Ramp Up Rate Pricing Formula$kj$, $kj$ramp-up-rate-formula$kj$),
  ($kj$Lounge VIP$kj$, $kj$the-lounge-vip$kj$),
  ($kj$[PIF] PPP Boss Builders $3997$kj$, $kj$ppp-collective$kj$),
  ($kj$[PIF] The Boss Builders Collective (Belco)$kj$, $kj$ppp-collective$kj$)
  ) AS v(offer_title, slug)
  JOIN offers o ON o.slug = v.slug
 WHERE pu.offer_id IS NULL AND pu.source = 'kajabi' AND pu.offer_title = v.offer_title;

-- Quinn Ford, Kajabi order #1001: $3,997.00 less coupon 4UQUINN = $0.00.
UPDATE purchases SET meta = meta || jsonb_build_object('coupon_code', '4UQUINN', 'discount_cents', 399700, 'subtotal_cents', 399700), updated_at = now()
 WHERE source = 'kajabi' AND offer_title = '[PIF] PPP Boss Builders $3997' AND total_cents = 0
   AND contact_id = (SELECT id FROM contacts WHERE lower(email) = 'hello@quinn-ford.com')
   AND NOT (meta ? 'coupon_code');

-- 5. The Boss Move: Kajabi's 5 holders (Kasey Flynn, Joanna Tran, Quinn Ford,
-- Yvette Howard, Sagar Shankaran) = the Club roster from 078.
INSERT INTO access_grants (member_id, product_id, source, status, granted_at)
SELECT e.member_id, p.id, 'import', 'active', coalesce(e.enrolled_at, now())
  FROM coaching_enrollments e
  JOIN coaching_offers co ON co.id = e.coaching_offer_id AND co.kajabi_product = 'The Boss Move'
  JOIN products p ON p.slug = 'the-boss-move'
 WHERE e.member_id IS NOT NULL AND e.source = 'kajabi'
   AND NOT EXISTS (SELECT 1 FROM access_grants g WHERE g.member_id = e.member_id AND g.product_id = p.id);

-- 6. Practice Reset Intensive: Kajabi 'Completed X of N sessions' per client.
UPDATE coaching_enrollments e SET sessions_total = 6, sessions_completed = 0, updated_at = now()
  FROM coaching_offers co
 WHERE co.id = e.coaching_offer_id AND co.slug = 'practice-reset-intensive'
   AND e.source = 'kajabi' AND e.sessions_total IS NULL;
UPDATE coaching_enrollments e SET sessions_total = 11, sessions_completed = 0, updated_at = now()
  FROM coaching_offers co, contacts ct
 WHERE co.id = e.coaching_offer_id AND co.slug = 'practice-reset-intensive' AND ct.id = e.contact_id
   AND lower(ct.email) = $kj$yvette@brightertomorrowtherapy.com$kj$ AND e.source = 'kajabi';
UPDATE coaching_enrollments e SET sessions_total = 6, sessions_completed = 3, updated_at = now()
  FROM coaching_offers co, contacts ct
 WHERE co.id = e.coaching_offer_id AND co.slug = 'practice-reset-intensive' AND ct.id = e.contact_id
   AND lower(ct.email) = $kj$kaleidocounseling@therapysecure.com$kj$ AND e.source = 'kajabi';
UPDATE coaching_enrollments e SET sessions_total = 12, sessions_completed = 3, updated_at = now()
  FROM coaching_offers co, contacts ct
 WHERE co.id = e.coaching_offer_id AND co.slug = 'practice-reset-intensive' AND ct.id = e.contact_id
   AND lower(ct.email) = $kj$michelle@bansheetherapyservices.com$kj$ AND e.source = 'kajabi';

-- 7. The Lounge (community 14) as it is in Kajabi.
UPDATE community_access_groups SET name = 'how to improve relations'
 WHERE id = 13 AND community_id = 14 AND name = 'How to Improve Relations';

-- "how to improve relations" is free in Kajabi (published free offer).
INSERT INTO products (slug, title, description, kind, community_id, access_group_id, status)
SELECT 'community-14-group-13', 'The Lounge — how to improve relations', '', 'access_group', 14, 13, 'published'
 WHERE EXISTS (SELECT 1 FROM community_access_groups WHERE id = 13 AND community_id = 14)
   AND NOT EXISTS (SELECT 1 FROM products WHERE slug = 'community-14-group-13');
INSERT INTO offers (title, internal_title, slug, status, description, pricing_type, amount_cents, currency,
                    interval_count, access_group_id, redirect_url, send_welcome_email)
SELECT 'how to improve relations', 'how to improve relations', 'community-14-group-13', 'published', '', 'free', 0, 'usd',
       1, 13, '/community/the-lounge', false
 WHERE EXISTS (SELECT 1 FROM community_access_groups WHERE id = 13 AND community_id = 14 AND checkout_offer_id IS NULL)
   AND NOT EXISTS (SELECT 1 FROM offers WHERE slug = 'community-14-group-13');
INSERT INTO offer_products (offer_id, product_id, sort)
SELECT o.id, p.id, 0 FROM offers o, products p
 WHERE o.slug = 'community-14-group-13' AND p.slug = 'community-14-group-13'
   AND NOT EXISTS (SELECT 1 FROM offer_products x WHERE x.offer_id = o.id AND x.product_id = p.id);
UPDATE community_access_groups g SET checkout_offer_id = o.id
  FROM offers o WHERE o.slug = 'community-14-group-13' AND g.id = 13 AND g.checkout_offer_id IS NULL;

-- Channels. Kajabi: "Boss Clinician Lounge" (chat) + "Q&A" (feed) in the Boss
-- Clinician Lounge group, "Q&A" (feed) in "how to improve relations".
INSERT INTO community_channels (community_id, slug, name, format, visibility, sort, access_group_id)
SELECT 14, v.slug, v.name, v.format, 'public', v.sort, v.grp
  FROM (VALUES ('boss-clinician-lounge', 'Boss Clinician Lounge', 'chat', 1, 12),
               ('q-and-a', 'Q&A', 'feed', 2, 12),
               ('how-to-improve-relations-q-and-a', 'Q&A', 'feed', 3, 13)) AS v(slug, name, format, sort, grp)
 WHERE EXISTS (SELECT 1 FROM community_access_groups g WHERE g.id = v.grp AND g.community_id = 14)
   AND NOT EXISTS (SELECT 1 FROM community_channels c WHERE c.community_id = 14 AND c.slug = v.slug);

-- Our fixture "Wins" channel has no Kajabi counterpart, no posts and no members.
DELETE FROM community_channels c
 WHERE c.community_id = 14 AND c.slug = 'wins'
   AND NOT EXISTS (SELECT 1 FROM community_posts p WHERE p.channel_id = c.id)
   AND NOT EXISTS (SELECT 1 FROM community_channel_members m WHERE m.channel_id = c.id);

-- Kajabi meetup "Monthly Coaching Calls": every month on the 9th, 10:00
-- America/Los_Angeles, in the Live Room, Boss Clinician Lounge group only
-- (087 columns). Empty location_url = the community's own live room.
INSERT INTO community_events
  (community_id, title, description, starts_at, duration_minutes, location_url, published,
   recurrence_freq, recurrence_interval, recurrence_until, recurrence_count, timezone, access_group_id)
SELECT 14, 'Monthly Coaching Calls', 'Join in on our monthly coaching calls. Get Your questions answered and learn something new.',
       '2026-10-09T17:00:00Z', 60, '', true, 'monthly', 1, NULL, NULL, 'America/Los_Angeles', 12
 WHERE EXISTS (SELECT 1 FROM community_access_groups WHERE id = 12 AND community_id = 14)
   AND NOT EXISTS (SELECT 1 FROM community_events WHERE community_id = 14 AND title = 'Monthly Coaching Calls');

