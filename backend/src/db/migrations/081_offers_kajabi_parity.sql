-- R40 (QA sheet 2026-09-29): "the offers page, the content is not matching with kajabi".
--
-- Source of truth: Kajabi's public checkout API, fetched 2026-09-29 for every
-- offer token linked from www.bossclinician.com (store, catalogue, sales pages
-- and the checkout pages themselves):
--   GET https://www.bossclinician.com/api/offers/<token>/checkout?source=embedded
-- Titles and prices below are that API's `offer.title` / `price` /
-- `pricing_options`; descriptions are the copy printed on the matching
-- /offers/<token>/checkout page, verbatim, minus navigation and the payment
-- picker. The side-by-side diff is backups/sheet-parity-20260929/offers-diff-20260929.json.
--
-- Deliberately NOT changed (see the diff file):
--   * Prices for Credentialing Success Formula ($247) and Credential With
--     Confidence ($127): owner-set in 073, Kajabi still says $17 / $27. The
--     Kajabi copy's "Only $17" / "Only $27" lines are left out so the page never
--     contradicts what checkout charges.
--   * Provider Partnership Guide stays $97: Kajabi's sales page says $97, its
--     checkout charges $47, and the catalogue card (courses lane) says $97.
--   * Stripe ids. New offers are drafts with no Stripe price; publishing one
--     creates its price through the normal admin path.
--
-- Idempotent: every statement is guarded, so re-running changes nothing.

-- 1. Fixtures out of the list. Both carry a single $0 order placed by the
--    developer's own address (orders 7 and 9); archiving keeps that history and
--    the grants, and stops the published test offer selling.
UPDATE offers SET status = 'archived', updated_at = now()
 WHERE slug IN ('zz-test-checkout-probe', 'ppp-collective') AND status <> 'archived';

-- 2. Offers that exist on both sides: Kajabi's offer title and checkout copy.
-- uTLp7Fuz
UPDATE offers SET title = $kj$The Fully Booked Therapist Toolkit$kj$, description = $kj$Get 85% off with this exclusive one-time offer! $444 $67 today only
Discount automatically applied.
*All sales are final as this is a digital product.$kj$, updated_at = now()
 WHERE slug = 'fully-booked-toolkit' AND (title, description) IS DISTINCT FROM ($kj$The Fully Booked Therapist Toolkit$kj$, $kj$Get 85% off with this exclusive one-time offer! $444 $67 today only
Discount automatically applied.
*All sales are final as this is a digital product.$kj$);
-- bhkvLZTX
UPDATE offers SET title = $kj$Credentialing Success Formula$kj$, description = $kj$Streamline Your Group Practice Credentialing Like a Pro!
What You'll Learn:
✅ How to efficiently credential new hires and ensure compliance.
✅ Best practices for managing ongoing credentialing for current staff.
✅ Step-by-step guidance on supervisory billing, connecting providers to your group, and insurance panel requirements.
✅ Tools and strategies to track licenses, CAQH profiles, malpractice insurance, and renewal deadlines.
✅ Insider tips to save time, reduce errors, and avoid delays with insurance panels.
Who Is This Training For?
This course is designed for group practice owners who:
Are ready to streamline their credentialing processes.
Want to ensure their team stays compliant with insurance and legal requirements. Need practical tools to manage documentation and deadlines with ease. Desire to unlock the potential of supervisory billing to grow their practice.
Why Choose Credentialing Success Formula?
🚀 Save Time: Learn efficient systems to simplify credentialing.
📋 Stay Organized: Keep track of all documentation and deadlines in one place. 💡 Gain Confidence: Master the credentialing and supervisory billing process.
📈 Grow Your Practice: Expand your team and scale your services effortlessly. What’s Included in the Course?
🎥 Step-by-Step Video Lessons (valued at $497) – Gain a clear understanding of the credentialing process from start to finish, eliminating confusion and uncertainty.
📄 Credentialing Checklist Templates (valued at $197) – Stay on track with every step of the credentialing journey and avoid missing critical details for new hires.
📊 Credentialing and Billing Management Tracker (valued at $297) – Organize and manage licenses, renewals, and insurance panel deadlines effortlessly with this powerful tool.
💼 Supervisory Billing Guides (valued at $397) – Unlock the potential of pre-licensed clinicians by learning how to navigate supervisory billing with confidence.
🧾 Insurance Panel Reference Guides (valued at $197) – Save time and frustration with quick access to the requirements and contact information for top insurance panels.
This course equips you with everything you need to streamline credentialing, grow your practice, and increase your revenue with less stress and more confidence.
Total Value: $1,500+
Take the Stress Out of Credentialing Today!
✔ Instant Access
✔ Lifetime Training
Click the check out button to secure your spot and get immediate access to Credentialing Success Formula.
Don’t let credentialing hold your group practice back! Need help?
Contact us at support@profitableprivatepractices.com.
We're here to assist you!
Due to the nature of this being a digital product, all sales are final.$kj$, updated_at = now()
 WHERE slug = 'credentialing-success-formula' AND (title, description) IS DISTINCT FROM ($kj$Credentialing Success Formula$kj$, $kj$Streamline Your Group Practice Credentialing Like a Pro!
What You'll Learn:
✅ How to efficiently credential new hires and ensure compliance.
✅ Best practices for managing ongoing credentialing for current staff.
✅ Step-by-step guidance on supervisory billing, connecting providers to your group, and insurance panel requirements.
✅ Tools and strategies to track licenses, CAQH profiles, malpractice insurance, and renewal deadlines.
✅ Insider tips to save time, reduce errors, and avoid delays with insurance panels.
Who Is This Training For?
This course is designed for group practice owners who:
Are ready to streamline their credentialing processes.
Want to ensure their team stays compliant with insurance and legal requirements. Need practical tools to manage documentation and deadlines with ease. Desire to unlock the potential of supervisory billing to grow their practice.
Why Choose Credentialing Success Formula?
🚀 Save Time: Learn efficient systems to simplify credentialing.
📋 Stay Organized: Keep track of all documentation and deadlines in one place. 💡 Gain Confidence: Master the credentialing and supervisory billing process.
📈 Grow Your Practice: Expand your team and scale your services effortlessly. What’s Included in the Course?
🎥 Step-by-Step Video Lessons (valued at $497) – Gain a clear understanding of the credentialing process from start to finish, eliminating confusion and uncertainty.
📄 Credentialing Checklist Templates (valued at $197) – Stay on track with every step of the credentialing journey and avoid missing critical details for new hires.
📊 Credentialing and Billing Management Tracker (valued at $297) – Organize and manage licenses, renewals, and insurance panel deadlines effortlessly with this powerful tool.
💼 Supervisory Billing Guides (valued at $397) – Unlock the potential of pre-licensed clinicians by learning how to navigate supervisory billing with confidence.
🧾 Insurance Panel Reference Guides (valued at $197) – Save time and frustration with quick access to the requirements and contact information for top insurance panels.
This course equips you with everything you need to streamline credentialing, grow your practice, and increase your revenue with less stress and more confidence.
Total Value: $1,500+
Take the Stress Out of Credentialing Today!
✔ Instant Access
✔ Lifetime Training
Click the check out button to secure your spot and get immediate access to Credentialing Success Formula.
Don’t let credentialing hold your group practice back! Need help?
Contact us at support@profitableprivatepractices.com.
We're here to assist you!
Due to the nature of this being a digital product, all sales are final.$kj$);
-- H39qjBXY
UPDATE offers SET title = $kj$Private Practice Starter Suite$kj$, description = $kj$You're One Step Away from Launching Your Private Practice With Clarity & Confidence!
✅ Get instant access to the step-by-step system that takes you from feeling stuck to signing your first paying client—without overwhelm or confusion.
What You’ll Get:
✔ 3-Step Private Practice Kickstart Video Course – The exact roadmap to launch your practice with confidence ($597 Value)
✔ Mindset Shift Worksheet – Overcome fear and step into your CEO role with confidence ($67 Value)
✔ Niche & Business Model Clarity Worksheet – Get crystal clear on your ideal clients and pricing ($97 Value)
✔ Client Attraction Quick-Start Checklist – Actionable steps to get your first clients fast ($47 Value)
LIMITED-TIME BONUSES!
🎁 Private Practice Starter Checklist – A complete step-by-step roadmap to launch ($57 Value)
🎁 Pricing Formula Cheat Sheet – Set your rates with confidence—no more second-guessing! ($37 Value)
🎁 “From Employee to CEO” Mindset Affirmations – Shift fear & imposter syndrome into confidence ($27 Value)
💰 Total Value: $929
🔥 Today’s Price: Just $27!
No Risk – Just Results!
✅ Lifetime Access – Learn at your own pace, anytime.
✅ Instant Delivery – Gain access immediately after purchase.
✅ Actionable & Easy-to-Follow – No fluff, just real results.
🔒 Secure Checkout – Your Information is Safe & Protected
JUST ENTER YOUR INFO ON THIS PAGE TO GET INSTANT ACCESS!
Sharon S. LPC
I loved how practical and easy-to-follow this course was! The niche and pricing worksheets were game-changers for me!$kj$, updated_at = now()
 WHERE slug = 'private-practice-starter-suite' AND (title, description) IS DISTINCT FROM ($kj$Private Practice Starter Suite$kj$, $kj$You're One Step Away from Launching Your Private Practice With Clarity & Confidence!
✅ Get instant access to the step-by-step system that takes you from feeling stuck to signing your first paying client—without overwhelm or confusion.
What You’ll Get:
✔ 3-Step Private Practice Kickstart Video Course – The exact roadmap to launch your practice with confidence ($597 Value)
✔ Mindset Shift Worksheet – Overcome fear and step into your CEO role with confidence ($67 Value)
✔ Niche & Business Model Clarity Worksheet – Get crystal clear on your ideal clients and pricing ($97 Value)
✔ Client Attraction Quick-Start Checklist – Actionable steps to get your first clients fast ($47 Value)
LIMITED-TIME BONUSES!
🎁 Private Practice Starter Checklist – A complete step-by-step roadmap to launch ($57 Value)
🎁 Pricing Formula Cheat Sheet – Set your rates with confidence—no more second-guessing! ($37 Value)
🎁 “From Employee to CEO” Mindset Affirmations – Shift fear & imposter syndrome into confidence ($27 Value)
💰 Total Value: $929
🔥 Today’s Price: Just $27!
No Risk – Just Results!
✅ Lifetime Access – Learn at your own pace, anytime.
✅ Instant Delivery – Gain access immediately after purchase.
✅ Actionable & Easy-to-Follow – No fluff, just real results.
🔒 Secure Checkout – Your Information is Safe & Protected
JUST ENTER YOUR INFO ON THIS PAGE TO GET INSTANT ACCESS!
Sharon S. LPC
I loved how practical and easy-to-follow this course was! The niche and pricing worksheets were game-changers for me!$kj$);
UPDATE offers SET title = $kj$The Practice Protection Pack$kj$, updated_at = now()
 WHERE slug = 'private-practice-protection-pack' AND title IS DISTINCT FROM $kj$The Practice Protection Pack$kj$;  -- LgBvvUYg (Kajabi page has no copy; keep ours)
-- VNLoQkj7
UPDATE offers SET title = $kj$From Profile to Profit: Get Your Therapist Profile Noticed$kj$, description = $kj$Get the secrets to a standout therapist profile today! Elevate your online presence, attract more clients, and watch your practice thrive. Don't wait – start transforming your profile into a client magnet now!
What You'll Get:
Comprehensive Profile Optimization Strategies
Learn the best practices for crafting a compelling and professional therapist profile that stands out in crowded directories.
Proven Techniques to Increase Visibility and Engagement
Discover how to use keywords, visuals, and testimonials effectively to attract and retain potential clients.
Step-by-Step Guide and video tutorial to Enhance Your Online Reputation
Build a trustworthy and authoritative online presence that sets you apart from the competition.
Additional Details:
Instant digital download, accessible from any device.
Practical tips and real-world examples tailored for therapists.
Please note: Due to the nature of digital products, all sales are final and non-refundable.$kj$, updated_at = now()
 WHERE slug = 'from-profile-to-profit' AND (title, description) IS DISTINCT FROM ($kj$From Profile to Profit: Get Your Therapist Profile Noticed$kj$, $kj$Get the secrets to a standout therapist profile today! Elevate your online presence, attract more clients, and watch your practice thrive. Don't wait – start transforming your profile into a client magnet now!
What You'll Get:
Comprehensive Profile Optimization Strategies
Learn the best practices for crafting a compelling and professional therapist profile that stands out in crowded directories.
Proven Techniques to Increase Visibility and Engagement
Discover how to use keywords, visuals, and testimonials effectively to attract and retain potential clients.
Step-by-Step Guide and video tutorial to Enhance Your Online Reputation
Build a trustworthy and authoritative online presence that sets you apart from the competition.
Additional Details:
Instant digital download, accessible from any device.
Practical tips and real-world examples tailored for therapists.
Please note: Due to the nature of digital products, all sales are final and non-refundable.$kj$);
-- pDxJj6iA
UPDATE offers SET title = $kj$Ramp Up Rate Pricing Formula$kj$, description = $kj$You're One Step Away From Charging What You're Worth
You’ve been undercharging for too long.
Now it’s time to price with confidence and build a private practice that actually supports you.
Here’s What You’re Getting:
✅ Step-by-Step Rate Setting System
Know exactly what to charge—no more guessing, Googling, or settling for “what everyone else charges.”
✅ Value-Based Pricing Strategies
Learn how to price in alignment with your expertise and the transformation you offer your clients.
✅ Market Research Tool Training
Finally understand how to assess your area, niche, and positioning—without the awkward phone calls or comparing yourself to underpaid peers.
✅ Money Mindset Training
Release guilt. Confront money fears. Step fully into your role as a well-paid, well-resourced CEO.
🎁 Plus These Bonuses:
✨ Ramp-Up Rate Calculator
Plug in your goals and numbers and let the tool tell you what you should be charging.
✨ Rate Comparison Calculator
See exactly how different rates impact your annual revenue—before you make a change.
✨ Ramp-Up Revenue Workbook
Your personal pricing playbook. Track your decisions, journal through mindset blocks, and map out your growth.
You’re Not Just Buying a Tool—You’re Making a Shift
This isn’t just about dollars. It’s about your energy, your peace of mind, and your ability to create a business that works for you, not against you.
You can earn this investment back in just one session.
Even better? It's tax-deductible.
Ready to confidently charge what you're worth?
Click the purchase button to grab the Ramp-Up Revenue Pricing Formula and start transforming your business today.
🔒 Secure Checkout | 💳 One-Time Payment | 🎯 Instant Access
Your future thriving practice starts right here. Let’s do this!$kj$, updated_at = now()
 WHERE slug = 'ramp-up-rate-formula' AND (title, description) IS DISTINCT FROM ($kj$Ramp Up Rate Pricing Formula$kj$, $kj$You're One Step Away From Charging What You're Worth
You’ve been undercharging for too long.
Now it’s time to price with confidence and build a private practice that actually supports you.
Here’s What You’re Getting:
✅ Step-by-Step Rate Setting System
Know exactly what to charge—no more guessing, Googling, or settling for “what everyone else charges.”
✅ Value-Based Pricing Strategies
Learn how to price in alignment with your expertise and the transformation you offer your clients.
✅ Market Research Tool Training
Finally understand how to assess your area, niche, and positioning—without the awkward phone calls or comparing yourself to underpaid peers.
✅ Money Mindset Training
Release guilt. Confront money fears. Step fully into your role as a well-paid, well-resourced CEO.
🎁 Plus These Bonuses:
✨ Ramp-Up Rate Calculator
Plug in your goals and numbers and let the tool tell you what you should be charging.
✨ Rate Comparison Calculator
See exactly how different rates impact your annual revenue—before you make a change.
✨ Ramp-Up Revenue Workbook
Your personal pricing playbook. Track your decisions, journal through mindset blocks, and map out your growth.
You’re Not Just Buying a Tool—You’re Making a Shift
This isn’t just about dollars. It’s about your energy, your peace of mind, and your ability to create a business that works for you, not against you.
You can earn this investment back in just one session.
Even better? It's tax-deductible.
Ready to confidently charge what you're worth?
Click the purchase button to grab the Ramp-Up Revenue Pricing Formula and start transforming your business today.
🔒 Secure Checkout | 💳 One-Time Payment | 🎯 Instant Access
Your future thriving practice starts right here. Let’s do this!$kj$);
-- 9npNMM3P
UPDATE offers SET title = $kj$Provider Partnership Guide$kj$, description = $kj$Turn Doctor Referrals Into Ideal Clients — With Confidence
Build a simple, proven referral system that helps you consistently attract aligned clients without relying on social media or marketing overwhelm.
The Provider Partnership Guide shows you exactly how to connect with doctors, introduce your services professionally, and build long-term referral relationships that fill your caseload.
What You Get Inside
✔️ Provider Partnership Guide Your step-by-step roadmap for identifying ideal referral partners, making confident outreach, and becoming the therapist physicians trust.
✔️ Done-For-You Scripts Emails, phone scripts, and follow-up templates that take the guesswork out of what to say.
✔️ Professional Introduction Package Template Learn exactly what to include in your one-pager and how to present yourself as a strong clinical partner.
✔️ Private Pay Referral Strategies Know how to answer questions about insurance, private pay, and client eligibility with confidence.
✔️ Referral Form Template A ready-to-use form to streamline referrals and make working with you simple for providers.
🎁 BONUS: Referral Tracking Spreadsheet (FREE)
Stay organized with an easy system to track outreach, follow-ups, and referrals — so you always know who’s referring and where to focus your energy.
Perfect For Therapists Who Want:
A steady flow of aligned clients
A professional, non-salesy outreach plan
A repeatable system that grows with their practice
To reduce marketing stress and rely on trusted referral partners instead
Ready to Build Your Referral System?
Click the link to get instant access and start turning provider relationships into your strongest source of new clients.$kj$, updated_at = now()
 WHERE slug = 'provider-partnership-guide' AND (title, description) IS DISTINCT FROM ($kj$Provider Partnership Guide$kj$, $kj$Turn Doctor Referrals Into Ideal Clients — With Confidence
Build a simple, proven referral system that helps you consistently attract aligned clients without relying on social media or marketing overwhelm.
The Provider Partnership Guide shows you exactly how to connect with doctors, introduce your services professionally, and build long-term referral relationships that fill your caseload.
What You Get Inside
✔️ Provider Partnership Guide Your step-by-step roadmap for identifying ideal referral partners, making confident outreach, and becoming the therapist physicians trust.
✔️ Done-For-You Scripts Emails, phone scripts, and follow-up templates that take the guesswork out of what to say.
✔️ Professional Introduction Package Template Learn exactly what to include in your one-pager and how to present yourself as a strong clinical partner.
✔️ Private Pay Referral Strategies Know how to answer questions about insurance, private pay, and client eligibility with confidence.
✔️ Referral Form Template A ready-to-use form to streamline referrals and make working with you simple for providers.
🎁 BONUS: Referral Tracking Spreadsheet (FREE)
Stay organized with an easy system to track outreach, follow-ups, and referrals — so you always know who’s referring and where to focus your energy.
Perfect For Therapists Who Want:
A steady flow of aligned clients
A professional, non-salesy outreach plan
A repeatable system that grows with their practice
To reduce marketing stress and rely on trusted referral partners instead
Ready to Build Your Referral System?
Click the link to get instant access and start turning provider relationships into your strongest source of new clients.$kj$);
-- S7FaR5BM
UPDATE offers SET title = $kj$THE DIRECTORY MAKEOVER AUDIT - Single Profile Audit$kj$, description = $kj$You’re listed on directories… but the inquiries aren’t coming in.
And you’re wondering:
“Is something wrong with my profile?”
“Why do other therapists get more clicks?”
“Do people even understand what I offer?”
You’re not alone — and you’re not doing anything wrong.
Most therapist directory profiles sound too generic, too clinical, or too unclear for the clients who are searching for help.
That’s where the Directory Makeover Audit comes in.
This isn’t a rewrite.
This isn’t a generic template.
This is a professional audit of your existing profile so you can make strategic changes that actually get you noticed.
What You Get Inside Your Directory Makeover Audit
Within 3–5 business days, you’ll receive a personalized video review where I walk you through:
✔ What’s working — and what’s not on your current profile
✔ Where potential clients are dropping off
✔ How clearly you're communicating your niche, tone, and approach
✔ Whether your headline is attracting or repelling clients
✔ How to optimize your intro paragraph for client connection
✔ If your specialties and issues list are hurting your visibility
✔ Profile structure tweaks that increase conversions instantly
✔ What small changes you can make TODAY to improve inquiries
No guessing.
No vague advice.
Just a clear, personalized breakdown of how to make your profile more visible, more relatable, and more effective.
You Choose Your Audit Type
✔ Single Profile Audit — $67
Perfect for Psychology Today, Therapy Den, Therapy for Black Girls, or any one platform.
✔ Two-Profile Bundle — $97
Get both profiles reviewed + compared so you can show up consistently and clearly on every platform.
✔ Full Visibility Audit (3 Profiles) — $147
For therapists listed everywhere who want a complete visibility upgrade across all platforms.
This Audit Is Perfect For You If…
✔ You’re not getting enough inquiries
✔ You’re getting inquiries from clients who aren’t aligned
✔ Your profile feels “blah” or too generic
✔ You don’t know what clients actually see when they read it
✔ You’ve edited it 10 times and still feel stuck
✔ You want real feedback from a therapist who understands marketing
How It Works
1️⃣ Choose Your Audit Level + Check Out
↓
2️⃣ Complete the short intake form with your profile link(s)
↓
3️⃣ I audit your profile(s) within 3–5 business days
↓
4️⃣ You receive a personalized audit video with clear guidance + exact instructions
↓
5️⃣ You apply the changes and watch your inquiries improve
Ready for your Directory Makeover Audit?
Check out now to get started and finally feel confident that your profile works as hard as you do.$kj$, updated_at = now()
 WHERE slug = 'directory-makeover-audit' AND (title, description) IS DISTINCT FROM ($kj$THE DIRECTORY MAKEOVER AUDIT - Single Profile Audit$kj$, $kj$You’re listed on directories… but the inquiries aren’t coming in.
And you’re wondering:
“Is something wrong with my profile?”
“Why do other therapists get more clicks?”
“Do people even understand what I offer?”
You’re not alone — and you’re not doing anything wrong.
Most therapist directory profiles sound too generic, too clinical, or too unclear for the clients who are searching for help.
That’s where the Directory Makeover Audit comes in.
This isn’t a rewrite.
This isn’t a generic template.
This is a professional audit of your existing profile so you can make strategic changes that actually get you noticed.
What You Get Inside Your Directory Makeover Audit
Within 3–5 business days, you’ll receive a personalized video review where I walk you through:
✔ What’s working — and what’s not on your current profile
✔ Where potential clients are dropping off
✔ How clearly you're communicating your niche, tone, and approach
✔ Whether your headline is attracting or repelling clients
✔ How to optimize your intro paragraph for client connection
✔ If your specialties and issues list are hurting your visibility
✔ Profile structure tweaks that increase conversions instantly
✔ What small changes you can make TODAY to improve inquiries
No guessing.
No vague advice.
Just a clear, personalized breakdown of how to make your profile more visible, more relatable, and more effective.
You Choose Your Audit Type
✔ Single Profile Audit — $67
Perfect for Psychology Today, Therapy Den, Therapy for Black Girls, or any one platform.
✔ Two-Profile Bundle — $97
Get both profiles reviewed + compared so you can show up consistently and clearly on every platform.
✔ Full Visibility Audit (3 Profiles) — $147
For therapists listed everywhere who want a complete visibility upgrade across all platforms.
This Audit Is Perfect For You If…
✔ You’re not getting enough inquiries
✔ You’re getting inquiries from clients who aren’t aligned
✔ Your profile feels “blah” or too generic
✔ You don’t know what clients actually see when they read it
✔ You’ve edited it 10 times and still feel stuck
✔ You want real feedback from a therapist who understands marketing
How It Works
1️⃣ Choose Your Audit Level + Check Out
↓
2️⃣ Complete the short intake form with your profile link(s)
↓
3️⃣ I audit your profile(s) within 3–5 business days
↓
4️⃣ You receive a personalized audit video with clear guidance + exact instructions
↓
5️⃣ You apply the changes and watch your inquiries improve
Ready for your Directory Makeover Audit?
Check out now to get started and finally feel confident that your profile works as hard as you do.$kj$);
-- uGqHXnvS
UPDATE offers SET title = $kj$Credential With Confidence Kit$kj$, description = $kj$Introducing the Credential with Confidence Kit—your all-in-one solution to mastering the credentialing process with ease and efficiency.
What You'll Learn:
Streamline Credentialing: Efficiently manage credentialing for yourself or your team, ensuring compliance and reducing administrative burdens.
Master CAQH Profiles: Navigate and maintain CAQH profiles with confidence, ensuring all information is up-to-date and accurate.
Track Essential Documents: Keep licenses, malpractice insurance, and renewal deadlines organized to avoid lapses and ensure continuous service delivery.
Navigate Insurance Panels: Understand the requirements and processes for various insurance panels, reducing errors and avoiding delays.
Who Is This Kit For? Designed specifically for therapists and private practice owners who:
Are ready to take control of their credentialing process.
Want to ensure compliance with insurance and legal requirements.
Need practical tools to manage documentation and deadlines with ease.
Desire to expand their practice by efficiently adding new providers.
Why Choose the Credential with Confidence Kit?
Save Time: Implement efficient systems to simplify credentialing tasks.
Stay Organized: Utilize tools designed to keep all your documentation and deadlines in one accessible place.
Gain Confidence: Acquire the knowledge to handle credentialing and billing processes without hesitation.
Grow Your Practice: Expand your services by adding new providers seamlessly.
What's Included in the Kit?
CAQH Checklist: A comprehensive guide to setting up and maintaining your CAQH profile accurately.
Credentialing Panel Tracker: An organized system to monitor applications, approvals, and renewals for various insurance panels.
Pre-Recorded Video Trainings:
Credential with Confidence: Step-by-step guidance through the credentialing process, from start to finish.
Boss Billing Blueprint: Insights into effective billing practices, including supervisory billing and connecting providers to your group.
Total Value: Over $500
Take the stress out of credentialing and elevate your practice today!
Secure Your Credential with Confidence Kit Now
Due to the digital nature of this product, all sales are final.
For assistance, contact us at support@profitableprivatepractices.com.$kj$, updated_at = now()
 WHERE slug = 'credential-with-confidence' AND (title, description) IS DISTINCT FROM ($kj$Credential With Confidence Kit$kj$, $kj$Introducing the Credential with Confidence Kit—your all-in-one solution to mastering the credentialing process with ease and efficiency.
What You'll Learn:
Streamline Credentialing: Efficiently manage credentialing for yourself or your team, ensuring compliance and reducing administrative burdens.
Master CAQH Profiles: Navigate and maintain CAQH profiles with confidence, ensuring all information is up-to-date and accurate.
Track Essential Documents: Keep licenses, malpractice insurance, and renewal deadlines organized to avoid lapses and ensure continuous service delivery.
Navigate Insurance Panels: Understand the requirements and processes for various insurance panels, reducing errors and avoiding delays.
Who Is This Kit For? Designed specifically for therapists and private practice owners who:
Are ready to take control of their credentialing process.
Want to ensure compliance with insurance and legal requirements.
Need practical tools to manage documentation and deadlines with ease.
Desire to expand their practice by efficiently adding new providers.
Why Choose the Credential with Confidence Kit?
Save Time: Implement efficient systems to simplify credentialing tasks.
Stay Organized: Utilize tools designed to keep all your documentation and deadlines in one accessible place.
Gain Confidence: Acquire the knowledge to handle credentialing and billing processes without hesitation.
Grow Your Practice: Expand your services by adding new providers seamlessly.
What's Included in the Kit?
CAQH Checklist: A comprehensive guide to setting up and maintaining your CAQH profile accurately.
Credentialing Panel Tracker: An organized system to monitor applications, approvals, and renewals for various insurance panels.
Pre-Recorded Video Trainings:
Credential with Confidence: Step-by-step guidance through the credentialing process, from start to finish.
Boss Billing Blueprint: Insights into effective billing practices, including supervisory billing and connecting providers to your group.
Total Value: Over $500
Take the stress out of credentialing and elevate your practice today!
Secure Your Credential with Confidence Kit Now
Due to the digital nature of this product, all sales are final.
For assistance, contact us at support@profitableprivatepractices.com.$kj$);
-- Jgx2ULVA
UPDATE offers SET title = $kj$MARKETING MASTERY FOR THERAPISTS$kj$, description = $kj$Your simple, step-by-step system to finally start getting consistent clients — without posting every day or running ads.
You don’t need to be “good at marketing."
You just need a system that works.
If you feel like you're doing all the things but still struggling to get consistent client inquiries… you’re not alone. Most therapists were never taught how to market themselves in a way that feels ethical, aligned, and actually effective.
That’s exactly why I created Marketing Mastery for Therapists — the simple, no-overwhelm starter kit that helps you get visible, get confident, and get clients.
What You Get Inside Marketing Mastery for Therapists
🎥 Mini Training: How to Get Your First 5 Clients Without Paid Ads
A short, powerful training that shows you exactly what to do this week to start generating real leads.
🗓 30-Day Content Calendar + Caption Starters
Never wonder what to post again. A complete month of plug-and-play prompts written for therapists.
🔍 SEO Checklist for Therapists
Simple SEO steps so clients can actually find you on Google.
📣 Referral Scripts + Email Templates
Know exactly what to say when reaching out to referral partners — without feeling awkward or pushy.
⭐ Ethical Review Builder
A guide that shows you how to ethically gather social proof without violating HIPAA or board rules.
🧭 The 5-Step Therapy Marketing Plan Guide
A simple roadmap that tells you what to focus on — and what to ignore — so you stop spinning your wheels.
📝 Psychology Today Profile Checklist
Quick, effective adjustments that help your PT profile rank better and convert more clicks into inquiries.
🤝 Referral Network Quickstart Guide
A short, no-fluff guide to start building a network of professionals who refer clients to you.
This is perfect for therapists who:
✔ Feel overwhelmed by all the marketing advice out there ✔ Want a simple plan they can actually stick to ✔ Want to grow without relying on Instagram or ads ✔ Are new to private practice OR ready to finally get consistent referrals ✔ Want templates, scripts, and checklists that save hours of time
Imagine Having…
✨ A content plan for the entire month ✨ A Psychology Today profile that works FOR you ✨ A simple SEO checklist you can follow in 10 minutes ✨ Scripts to reach out to referrals without overthinking ✨ A 5-step marketing plan that makes sense ✨ Actual inquiries — not just profile views
This is what Marketing Mastery was built for.
YOUR PRICE TODAY: $67
(Regular Price: $147)
Instant access. Lifetime updates. No overwhelm.
Ready to finally market your practice with confidence?
Click the check-out button and get everything you need to start showing up like the therapist clients have been searching for.$kj$, updated_at = now()
 WHERE slug = 'marketing-mastery-for-therapists' AND (title, description) IS DISTINCT FROM ($kj$MARKETING MASTERY FOR THERAPISTS$kj$, $kj$Your simple, step-by-step system to finally start getting consistent clients — without posting every day or running ads.
You don’t need to be “good at marketing."
You just need a system that works.
If you feel like you're doing all the things but still struggling to get consistent client inquiries… you’re not alone. Most therapists were never taught how to market themselves in a way that feels ethical, aligned, and actually effective.
That’s exactly why I created Marketing Mastery for Therapists — the simple, no-overwhelm starter kit that helps you get visible, get confident, and get clients.
What You Get Inside Marketing Mastery for Therapists
🎥 Mini Training: How to Get Your First 5 Clients Without Paid Ads
A short, powerful training that shows you exactly what to do this week to start generating real leads.
🗓 30-Day Content Calendar + Caption Starters
Never wonder what to post again. A complete month of plug-and-play prompts written for therapists.
🔍 SEO Checklist for Therapists
Simple SEO steps so clients can actually find you on Google.
📣 Referral Scripts + Email Templates
Know exactly what to say when reaching out to referral partners — without feeling awkward or pushy.
⭐ Ethical Review Builder
A guide that shows you how to ethically gather social proof without violating HIPAA or board rules.
🧭 The 5-Step Therapy Marketing Plan Guide
A simple roadmap that tells you what to focus on — and what to ignore — so you stop spinning your wheels.
📝 Psychology Today Profile Checklist
Quick, effective adjustments that help your PT profile rank better and convert more clicks into inquiries.
🤝 Referral Network Quickstart Guide
A short, no-fluff guide to start building a network of professionals who refer clients to you.
This is perfect for therapists who:
✔ Feel overwhelmed by all the marketing advice out there ✔ Want a simple plan they can actually stick to ✔ Want to grow without relying on Instagram or ads ✔ Are new to private practice OR ready to finally get consistent referrals ✔ Want templates, scripts, and checklists that save hours of time
Imagine Having…
✨ A content plan for the entire month ✨ A Psychology Today profile that works FOR you ✨ A simple SEO checklist you can follow in 10 minutes ✨ Scripts to reach out to referrals without overthinking ✨ A 5-step marketing plan that makes sense ✨ Actual inquiries — not just profile views
This is what Marketing Mastery was built for.
YOUR PRICE TODAY: $67
(Regular Price: $147)
Instant access. Lifetime updates. No overwhelm.
Ready to finally market your practice with confidence?
Click the check-out button and get everything you need to start showing up like the therapist clients have been searching for.$kj$);
-- wMz5RNgn
UPDATE offers SET title = $kj$THERAPIST NICHE CLARITY ACCELERATOR$kj$, description = $kj$Get clear, get confident, and attract the clients you’re meant to serve.
If you’ve been struggling to choose your niche — or worried you’ll “lock yourself in” — this accelerator gives you the exact framework to find a profitable, aligned niche that feels good and actually works in the real world.
This is the step most therapists skip… and it’s the step that changes everything.
Say goodbye to confusion, second-guessing, and feeling “too general.”
Walk away with a niche that attracts your ideal clients — effortlessly.*
Inside the Therapist Niche Accelerator
This powerful mini-training gives you everything you need to get clear, confident, and client-ready:
✅ Discovering Your Niche Workbook
A guided workbook to help you uncover your strengths, passions, and aligned client population — without feeling boxed in.
✅ How to Find Your Niche & Attract Clients (Mini Training)
A step-by-step video lesson that shows you how to select a niche that is both profitable and authentic — no guessing required.
✅ Market Research Made Simple (YouTube + Amazon Method)
Learn how to validate your niche in 15 minutes by analyzing what real people are searching for, buying, and struggling with.
✅ Bonus: Ideal Client Identifier Template
A quick-fill template that eliminates guesswork and helps you speak directly to the people you want to serve.
By the end of the Therapist Niche Accelerator, you will:
✨ Know exactly who you serve ✨ Understand the problem you solve ✨ Feel confident speaking about your work ✨ Show up more clearly online ✨ Become more referable ✨ Attract aligned clients faster ✨ Stop wasting time, energy, and money on generic marketing that doesn’t work
This is the foundation of a profitable private practice — and now it’s finally clear, simple, and doable.
Ready to get clear, confident, and attract aligned clients?
Your niche is the foundation of your success.
Let’s build it — the right way.$kj$, updated_at = now()
 WHERE slug = 'therapist-niche-clarity-accelerator' AND (title, description) IS DISTINCT FROM ($kj$THERAPIST NICHE CLARITY ACCELERATOR$kj$, $kj$Get clear, get confident, and attract the clients you’re meant to serve.
If you’ve been struggling to choose your niche — or worried you’ll “lock yourself in” — this accelerator gives you the exact framework to find a profitable, aligned niche that feels good and actually works in the real world.
This is the step most therapists skip… and it’s the step that changes everything.
Say goodbye to confusion, second-guessing, and feeling “too general.”
Walk away with a niche that attracts your ideal clients — effortlessly.*
Inside the Therapist Niche Accelerator
This powerful mini-training gives you everything you need to get clear, confident, and client-ready:
✅ Discovering Your Niche Workbook
A guided workbook to help you uncover your strengths, passions, and aligned client population — without feeling boxed in.
✅ How to Find Your Niche & Attract Clients (Mini Training)
A step-by-step video lesson that shows you how to select a niche that is both profitable and authentic — no guessing required.
✅ Market Research Made Simple (YouTube + Amazon Method)
Learn how to validate your niche in 15 minutes by analyzing what real people are searching for, buying, and struggling with.
✅ Bonus: Ideal Client Identifier Template
A quick-fill template that eliminates guesswork and helps you speak directly to the people you want to serve.
By the end of the Therapist Niche Accelerator, you will:
✨ Know exactly who you serve ✨ Understand the problem you solve ✨ Feel confident speaking about your work ✨ Show up more clearly online ✨ Become more referable ✨ Attract aligned clients faster ✨ Stop wasting time, energy, and money on generic marketing that doesn’t work
This is the foundation of a profitable private practice — and now it’s finally clear, simple, and doable.
Ready to get clear, confident, and attract aligned clients?
Your niche is the foundation of your success.
Let’s build it — the right way.$kj$);
-- 7n6FFEe2
UPDATE offers SET title = $kj$Rate Renegotiate Letter Templates$kj$, description = $kj$Steal My Exact Letters That Got Insurance Panels to Raise My Rates
2 Proven Templates I Personally Use to Negotiate Higher Rates With Insurance Companies (even for my group practice)
TODAY’S PRICE: $7
HERE’S WHAT YOU GET
📄 General Insurance Rate Negotiation Letter
The go-to template you can send to any insurance panel to request and negotiate higher reimbursement rates. This is the exact framework I’ve used to open doors and increase pay across multiple panels. ($47 value)
📄 Cigna / Evernorth-Specific Rate Negotiation Letter
A tailored template crafted for Cigna/Evernorth panels—showing you exactly how to communicate effectively with their system for the best chance at success. ($47 value)
✨ BONUS Tips Inside Each Letter
I’ve included my personal formatting notes and subtle wording tweaks that make a huge difference when dealing with provider relations teams. ($27 value)
WHY YOU NEED THIS
Insurance companies aren’t going to hand you a raise—you have to ask for it the right way. These letters take away the stress, save you hours of writing, and give you a proven script that works.
Whether you’re brand-new to credentialing or you’ve been paneled for years, this shortcut helps you:
Save time (no drafting from scratch)
Sound professional and confident
Increase your chances of approval
Put more money back into your practice
TODAY ONLY: Just $7 for Both Templates
(Value: $121)
✔️ Instant download
✔️ Copy + paste ready
✔️ Yours forever
👉 Check out now to grab your templates and start negotiating higher rates today!$kj$, updated_at = now()
 WHERE slug = 'rate-negotiation-letter-template' AND (title, description) IS DISTINCT FROM ($kj$Rate Renegotiate Letter Templates$kj$, $kj$Steal My Exact Letters That Got Insurance Panels to Raise My Rates
2 Proven Templates I Personally Use to Negotiate Higher Rates With Insurance Companies (even for my group practice)
TODAY’S PRICE: $7
HERE’S WHAT YOU GET
📄 General Insurance Rate Negotiation Letter
The go-to template you can send to any insurance panel to request and negotiate higher reimbursement rates. This is the exact framework I’ve used to open doors and increase pay across multiple panels. ($47 value)
📄 Cigna / Evernorth-Specific Rate Negotiation Letter
A tailored template crafted for Cigna/Evernorth panels—showing you exactly how to communicate effectively with their system for the best chance at success. ($47 value)
✨ BONUS Tips Inside Each Letter
I’ve included my personal formatting notes and subtle wording tweaks that make a huge difference when dealing with provider relations teams. ($27 value)
WHY YOU NEED THIS
Insurance companies aren’t going to hand you a raise—you have to ask for it the right way. These letters take away the stress, save you hours of writing, and give you a proven script that works.
Whether you’re brand-new to credentialing or you’ve been paneled for years, this shortcut helps you:
Save time (no drafting from scratch)
Sound professional and confident
Increase your chances of approval
Put more money back into your practice
TODAY ONLY: Just $7 for Both Templates
(Value: $121)
✔️ Instant download
✔️ Copy + paste ready
✔️ Yours forever
👉 Check out now to grab your templates and start negotiating higher rates today!$kj$);
-- JfvDGdjF
UPDATE offers SET title = $kj$Prepare to Profit: Guided Meditation Journal For Therapists$kj$, description = $kj$Prepare to Profit
A Guided Meditation & Mindset Journal for Therapists
A powerful 5-step digital journal designed to help therapists release fear, quiet self-doubt, and step confidently into CEO energy — whether you’re starting or scaling your private practice.
What You Get
✔ Guided meditations to ground your nervous system & visualize success ✔ Therapeutic writing prompts for clarity + mindset breakthroughs ✔ Gratitude & reflection pages to stay centered ✔ Motivational affirmations to support your inner CEO ✔ A simple mindset framework to help you take action with confidence
Use it daily, weekly, or anytime you need to get aligned and tap back into your purpose.
Perfect For Therapists Who…
Are preparing to leave agency work
Are ready to step into private practice with confidence
Feel stuck in self-doubt or fear
Want to strengthen their mindset before building or scaling their practice
This journal helps you shift internally so you can take bold action externally.$kj$, updated_at = now()
 WHERE slug = 'prepare-to-profit-journal' AND (title, description) IS DISTINCT FROM ($kj$Prepare to Profit: Guided Meditation Journal For Therapists$kj$, $kj$Prepare to Profit
A Guided Meditation & Mindset Journal for Therapists
A powerful 5-step digital journal designed to help therapists release fear, quiet self-doubt, and step confidently into CEO energy — whether you’re starting or scaling your private practice.
What You Get
✔ Guided meditations to ground your nervous system & visualize success ✔ Therapeutic writing prompts for clarity + mindset breakthroughs ✔ Gratitude & reflection pages to stay centered ✔ Motivational affirmations to support your inner CEO ✔ A simple mindset framework to help you take action with confidence
Use it daily, weekly, or anytime you need to get aligned and tap back into your purpose.
Perfect For Therapists Who…
Are preparing to leave agency work
Are ready to step into private practice with confidence
Feel stuck in self-doubt or fear
Want to strengthen their mindset before building or scaling their practice
This journal helps you shift internally so you can take bold action externally.$kj$);
-- Yhc3aisz
UPDATE offers SET title = $kj$Client Consultation Call Script$kj$, description = $kj$This is the exact system I use to ensure my consultation calls are impactful and client-focused. Add the Client Consultation Call Script to your toolkit today, and gain instant access to a resource that will take your calls—and your practice—to the next level!
When using the Client Consultation Call Script you will be able to:
Take the Guesswork Out of Consultations: Know exactly what to say and when to say it.
Boost Your Confidence: Approach every call with a clear plan and feel prepared to handle any situation.
Increase Your Client Conversion Rate: Turn more inquiries into bookings with a professional, effective approach.
Save Time: Eliminate the need to overthink or reinvent the wheel for every consultation.
What you'll get:
A proven, step-by-step guided script to turn consultation calls into paying clients.
Build confidence on calls without coming across as pushy or sales-driven.
Attract and work with the kind of clients you truly enjoy serving.
Save significant time, energy, and resources by using a tried-and-tested script.$kj$, updated_at = now()
 WHERE slug = 'client-consultation-call-script' AND (title, description) IS DISTINCT FROM ($kj$Client Consultation Call Script$kj$, $kj$This is the exact system I use to ensure my consultation calls are impactful and client-focused. Add the Client Consultation Call Script to your toolkit today, and gain instant access to a resource that will take your calls—and your practice—to the next level!
When using the Client Consultation Call Script you will be able to:
Take the Guesswork Out of Consultations: Know exactly what to say and when to say it.
Boost Your Confidence: Approach every call with a clear plan and feel prepared to handle any situation.
Increase Your Client Conversion Rate: Turn more inquiries into bookings with a professional, effective approach.
Save Time: Eliminate the need to overthink or reinvent the wheel for every consultation.
What you'll get:
A proven, step-by-step guided script to turn consultation calls into paying clients.
Build confidence on calls without coming across as pushy or sales-driven.
Attract and work with the kind of clients you truly enjoy serving.
Save significant time, energy, and resources by using a tried-and-tested script.$kj$);

-- Kajabi sells the three audit tiers as three offers (S7FaR5BM $67, ETdu5ctJ
-- $97, wCanMVm6 $147); here they are one offer with two extra ways to pay, so
-- the option labels take Kajabi's tier names.
UPDATE offer_pricing_options po SET label = 'Two-Profile Bundle', updated_at = now()
  FROM offers o WHERE o.id = po.offer_id AND o.slug = 'directory-makeover-audit'
   AND po.amount_cents = 9700 AND po.label <> 'Two-Profile Bundle';
UPDATE offer_pricing_options po SET label = 'Full Visibility Audit (3 Profiles)', updated_at = now()
  FROM offers o WHERE o.id = po.offer_id AND o.slug = 'directory-makeover-audit'
   AND po.amount_cents = 14700 AND po.label <> 'Full Visibility Audit (3 Profiles)';
UPDATE offers SET checkout_headline = 'Single Profile Audit', updated_at = now()
 WHERE slug = 'directory-makeover-audit' AND checkout_headline = 'One profile';

-- 3. Kajabi offers with a public title and price that had no row here. Drafts:
--    nothing is purchasable until the owner attaches what they deliver and puts
--    them live.
-- tzgjALKU
INSERT INTO offers (title, slug, status, description, thumbnail_url, currency, pricing_type, amount_cents, collect_address)
VALUES ($kj$The Club$kj$, 'the-club', 'draft', $kj$You're One Step Away From the Club
The 6-month coaching program where therapists build a private practice that replaces their salary, without losing their security to get there.
Everything you need to make your boss move:
✅ The Boss Move Signature Program - All 5 modules with 4 NBCC clock hours. The exact build order that works: foundation, clients, income, systems. Move at your pace, earn continuing education credit while you build.
✅ 2 Live Coaching Calls Per Month with Yvette - Twelve live calls across your six months. Real questions, real answers, from a strategist who built a multi-six-figure group practice from your exact starting point.
✅ A Community Built for Your Stage - Your cohort of clinicians building in the same season you are, with six full months of support so you are never building alone.
✅ The First 30 Days Success Planner + Readiness Tracker - Momentum from day one, with every milestone mapped so you always know what comes next.
✅ Every Template You Need - Checklists, client and provider letter templates, plus done-for-you branding and marketing materials including business cards, postcards, email signatures, and 250 blog article ideas.
✅ The Prepare to Profit Guided Meditation Journal - The mindset work that keeps the build moving when fear shows up.
Plus these bonuses, included when you enroll:
🎁 BONUS #1: The Therapist Niche Clarity Accelerator
Know exactly who you serve before you see your first client. The guided workbook, mini-training, 15-minute market research method, and Ideal Client Identifier that take you from "too general" to clear, confident, and referable. (Sold separately on our site; yours free with enrollment. Does not carry NBCC credit.)
🎁 BONUS #2: The Boss Move Kickstart Call
A personal 15-minute call with Yvette herself, before you dive in. You'll leave knowing your first three moves. Because you shouldn't start this alone.
🎁 BONUS #3 - FAST ACTION: The Ramp-Up Rate Pricing Formula
Enroll within 72 hours  and get the complete rate-setting system free: the Rate-Setting Blueprint, mindset reset training, Ramp-Up Rate Calculator, Rate Comparison Calculator, and workbook, so you charge with confidence from your very first client. ($197 value, sold separately. Does not carry NBCC credit.)
The Boss Move is approved by NBCC under the program title "Profitable Private Practices: Training for Clinically-Aligned Private Practices" for 4 clock hours. Your certificate of completion will carry the approved program title. Boss Clinician, LLC has been approved by NBCC as an Approved Continuing Education Provider, ACEP No. 7998. Programs that do not qualify for NBCC credit are clearly identified. Boss Clinician, LLC is solely responsible for all aspects of the programs. Continuing education credit applies to this course only; coaching calls, community access, and bonus materials do not carry NBCC credit. CE grievance, refund, and cancellation policies are available at [LINK] or by request at support@bossclinician.com.$kj$, '/uploads/707a6db0c61b5a83.jpg', 'usd', 'one_time', 199700, true)
ON CONFLICT (slug) DO NOTHING;
INSERT INTO offer_pricing_options (offer_id, label, pricing_type, amount_cents, currency, interval, interval_count, installment_count, sort)
SELECT o.id, $kj$$397.00 every month for 6 months ($2,382 total)$kj$, 'payment_plan', 39700, 'usd', 'month', 1, 6, 1 FROM offers o
 WHERE o.slug = 'the-club'
   AND NOT EXISTS (SELECT 1 FROM offer_pricing_options x
                    WHERE x.offer_id = o.id AND x.pricing_type = 'payment_plan'
                      AND x.amount_cents = 39700 AND x.installment_count = 6);
-- 5RwMdHLj
INSERT INTO offers (title, slug, status, description, thumbnail_url, currency, pricing_type, amount_cents, collect_address)
VALUES ($kj$The Lounge | Boss Clinician$kj$, 'the-lounge', 'draft', $kj$You're One Step Away From the Boss Clinician Lounge
The membership where fully booked clinicians restructure the practice they built: rates, income sources, systems, and sustainability.
Everything you need to elevate your practice:
✅ The Practice Elevation Signature Curriculum - All four modules built on the B.O.S.S Blueprint. Audit what your practice is actually paying you, restructure your rates and income sources, build systems that run without you, and pay yourself like the CEO you are.
✅ Monthly Live Strategy Sessions with Yvette - 90 minutes of teaching, hot seats, and open Q&A every month. Replays posted within 24 hours, organized by topic in your Replay Vault.
✅ The Boss Clinician Toolkit - Over 20 plug-and-play workbooks, swipe files, and trackers: rate increase email templates, the Insurance Panel Audit Tracker, the Platform Exit Roadmap, SOP templates, the PTO income calculator, and more.
✅ The Lounge Community - Your growth circle of clinicians who understand exactly what it means to be fully booked and still underpaid.
✅ The Replay Vault-A growing library of past kits, recorded coaching calls, and bonus trainings — all saved and ready when you are. No pressure to keep up, just plug in when you need it. The longer you stay, the more value you unlock.
🎁 BONUS #1:The Private Practice Business Plan –Your fillable, lender-ready business plan built section by section as you move through the curriculum. By the end of Module 04, you hold a complete document you can hand to a bank, a grant committee, or your own annual review..
🎟️ BONUS #2: Live Challenge Access – Members get free access to live Lounge challenges throughout the year. Focused sprints designed to help you implement faster, together.$kj$, '/uploads/770d690d2853e30c.png', 'usd', 'one_time', 199700, true)
ON CONFLICT (slug) DO NOTHING;
INSERT INTO offer_pricing_options (offer_id, label, pricing_type, amount_cents, currency, interval, interval_count, installment_count, sort)
SELECT o.id, $kj$$197.00 every month for 6 months ($1,182 total)$kj$, 'payment_plan', 19700, 'usd', 'month', 1, 6, 1 FROM offers o
 WHERE o.slug = 'the-lounge'
   AND NOT EXISTS (SELECT 1 FROM offer_pricing_options x
                    WHERE x.offer_id = o.id AND x.pricing_type = 'payment_plan'
                      AND x.amount_cents = 19700 AND x.installment_count = 6);
-- awvKo5oi
INSERT INTO offers (title, slug, status, description, thumbnail_url, currency, pricing_type, amount_cents, collect_address)
VALUES ($kj$The Lounge | VIP$kj$, 'the-lounge-vip', 'draft', $kj$The Lounge VIP
Everything in the Lounge Membership:
✅ The Practice Elevation signature curriculum (all four modules)
✅ Monthly live Strategy Sessions with Yvette + full Replay Vault
✅ The Practice Elevation Dashboard with the quarterly Practice Health Assessment
✅ The Boss Clinician Toolkit (20+ workbooks, swipe files, and trackers)
✅ The Private Practice Business Plan
✅ Live challenge access throughout the year
Plus your three monthly VIP benefits:
⭐ The VIP Strategy Call Series - Three private 30-minute calls with Yvette, mapped to your journey: your Kickoff Call when you join, your 90-Day Momentum Call, and your 6-Month Elevation Review. Your dashboard is our shared screen, so every call starts with your real numbers. Short, structured, and focused entirely on your practice.
⭐ Monthly Voice Note from Yvette - Submit one question each month and receive my personal voice note response. Direct input on your specific situation, between calls.
⭐ Monthly Materials Review - Submit one item each month: your niche statement, Psychology Today profile, website copy, pricing, or marketing material. You receive one complete recorded review: my full assessment, what to change, and why, in a single pass built for you to implement from.
⭐ Priority Hot Seat - Your hot seat on the monthly call, guaranteed every quarter. Submit in advance, get coached live.
Also included: your private VIP submission portal and early access to new content before general release.
Year commitment $3,497
6 month commitment $347 per month for 6 months
What happens after checkout: You'll receive your welcome email with login details right away. Your Lounge dashboard, The Practice Elevation curriculum, and your VIP Access portal unlock immediately. Book your Kickoff Call and send your first submissions this week.$kj$, '/uploads/a52e03177d02b45f.png', 'usd', 'one_time', 349700, true)
ON CONFLICT (slug) DO NOTHING;
INSERT INTO offer_pricing_options (offer_id, label, pricing_type, amount_cents, currency, interval, interval_count, installment_count, sort)
SELECT o.id, $kj$$347.00 every month for 6 months ($2,082 total)$kj$, 'payment_plan', 34700, 'usd', 'month', 1, 6, 1 FROM offers o
 WHERE o.slug = 'the-lounge-vip'
   AND NOT EXISTS (SELECT 1 FROM offer_pricing_options x
                    WHERE x.offer_id = o.id AND x.pricing_type = 'payment_plan'
                      AND x.amount_cents = 34700 AND x.installment_count = 6);
-- EGheHSbL
INSERT INTO offers (title, slug, status, description, thumbnail_url, currency, pricing_type, amount_cents, collect_address)
VALUES ($kj$Practice Reset Intensive$kj$, 'practice-reset-intensive', 'draft', $kj$You bring the clinical skill — I'll bring the business blueprint. You're one step away from securing your spot.
The Boss Clinician Practice Reset Intensive is a high-touch, 3-month private strategy experience designed to help therapists get clear, get structured, and start building a profitable private practice — without guessing, piecing it together, or doing it alone.
Over the next 3 months, we will build:
✔ Your Ideal Client Profile and Niche Positioning (so you stop marketing to everyone and start attracting the right people)
✔ Your Pricing Strategy and Signature Offer (clear rates, packaged services, and an offer that reflects your expertise)
✔ Your Marketing Foundation and Client Attraction Plan (so aligned, consistent clients know exactly how to find you)
✔ Your Business Systems and CEO Confidence (so your practice runs professionally from day one)
This program is for therapists who are ready to stop guessing and start building strategically — whether you're in your first year of practice or you've been grinding without a real plan and need a complete reset.
INCLUDES:
✔ (6) 1:1 Bi-Weekly Coaching and Strategy Sessions (50 minutes each)
✔ Practice Clarity Assessment — completed before we begin so we hit the ground running
✔ Personalized Practice Strategy Roadmap built around your specific goals
✔ Pricing, Offer, and Revenue Planning Tools
✔ Marketing Foundation and Client Attraction Templates
✔ Accountability, Support, and Expert Feedback
✔ Private Client Portal Access and Resources
DONE-FOR-YOU DELIVERABLES
Psychology Today profile — fully rewritten for you
Personalized website audit with a custom template you can implement yourself or hand to a designer
Video bio script written for you to record and use on your website or Psychology Today profile
Once your payment is submitted, you’ll receive your welcome email, onboarding details, and immediate access to your client portal.
I can’t wait to help you build the practice you’ve been dreaming of—with clarity, confidence, and a plan that actually works.
Let’s build it — together.$kj$, '/images/b3a2f3cdf3bb.png', 'usd', 'one_time', 350000, true)
ON CONFLICT (slug) DO NOTHING;
INSERT INTO offer_products (offer_id, product_id, sort)
SELECT o.id, p.id, 0 FROM offers o JOIN products p ON p.id = 10
 WHERE o.slug = 'practice-reset-intensive'
ON CONFLICT (offer_id, product_id) DO NOTHING;
INSERT INTO offer_pricing_options (offer_id, label, pricing_type, amount_cents, currency, interval, interval_count, installment_count, sort)
SELECT o.id, $kj$3 monthly payments of $1,250 ($3,750 total)$kj$, 'payment_plan', 125000, 'usd', 'month', 1, 3, 1 FROM offers o
 WHERE o.slug = 'practice-reset-intensive'
   AND NOT EXISTS (SELECT 1 FROM offer_pricing_options x
                    WHERE x.offer_id = o.id AND x.pricing_type = 'payment_plan'
                      AND x.amount_cents = 125000 AND x.installment_count = 3);
-- ykWzVqDZ
INSERT INTO offers (title, slug, status, description, thumbnail_url, currency, pricing_type, amount_cents, collect_address)
VALUES ($kj$Scale and Reclaim Suite$kj$, 'scale-and-reclaim-suite', 'draft', $kj$You bring the clinical skill — I’ll bring the business blueprint.
You’re one step away from securing your spot.
The Boss Clinician Scale and Reclaim Suite is a high-touch, 6-month private coaching experience designed to help therapists build, grow, or expand a profitable, sustainable private practice—without guessing, piecing it together, or doing it alone.
Over the next 6 months, we will build:
✔ Your Personalized Practice Roadmap
(startup, growth, or expansion—no matter where you are)
✔ Your Pricing, Profit, and Revenue Plan
(clear rates, income goals, and financial structure)
✔ Your Marketing, Messaging & Client Attraction Strategy
(so you attract aligned, consistent, and full-pay clients)
✔ Your Systems, Workflows & CEO Structure
(so your practice runs smoothly—without burnout)
This program is for therapists who are ready to step into CEO leadership—whether starting from scratch, refining an existing practice, or preparing to expand into a group or team model.
INCLUDES:
✔ (12) 1:1 Bi-Weekly Coaching & Strategy Sessions (6 month)
✔ Personalized Practice Roadmap & CEO Blueprint
✔ Pricing, Profit & Revenue Planning Tools
✔ Systems, Workflow & Marketing Templates
✔ Accountability, Support & Expert Feedback
✔ Private Client Portal Access & Resources
DONE-FOR-YOU DELIVERABLES
Psychology Today profile — fully rewritten for you
Personalized website audit with custom template — implement yourself or we coordinate with your designer
Video bio script written for you
Marketing materials review and edit — bring what you have and we'll sharpen it
Custom referral template built for your specific niche and practice
Once your payment is submitted, you’ll receive your welcome email, onboarding details, and immediate access to your client portal.
I can’t wait to help you build the practice you’ve been dreaming of—with clarity, confidence, and a plan that actually works.
Let’s build it — together.$kj$, '/images/52c45a6b0f9f.png', 'usd', 'one_time', 650000, true)
ON CONFLICT (slug) DO NOTHING;
INSERT INTO offer_products (offer_id, product_id, sort)
SELECT o.id, p.id, 0 FROM offers o JOIN products p ON p.id = 11
 WHERE o.slug = 'scale-and-reclaim-suite'
ON CONFLICT (offer_id, product_id) DO NOTHING;
INSERT INTO offer_pricing_options (offer_id, label, pricing_type, amount_cents, currency, interval, interval_count, installment_count, sort)
SELECT o.id, $kj$6 monthly payments of $1,150 ($6,900 total)$kj$, 'payment_plan', 115000, 'usd', 'month', 1, 6, 1 FROM offers o
 WHERE o.slug = 'scale-and-reclaim-suite'
   AND NOT EXISTS (SELECT 1 FROM offer_pricing_options x
                    WHERE x.offer_id = o.id AND x.pricing_type = 'payment_plan'
                      AND x.amount_cents = 115000 AND x.installment_count = 6);
-- GSWsHBTx
INSERT INTO offers (title, slug, status, description, thumbnail_url, currency, pricing_type, amount_cents, collect_address)
VALUES ($kj$The Boss Boardroom$kj$, 'the-boss-boardroom', 'draft', $kj$You bring the clinical skill. I'll bring the business blueprint.
You are one step away from securing your spot.
You didn't build your practice this far to stay stuck.
The Boss Clinician Boss Boardroom is a high-touch 12 month private consulting experience designed for clinicians who are ready to stop working in their practice and start leading it — with the systems, strategy, and CEO structure to match.
This is not a course. This is not a group program. This is a deeply personalized, one-on-one partnership built entirely around your practice, your goals, and the specific season you are in right now.
Over the next 12 months we will build:
✔ Your CEO Practice Roadmap — a clear, personalized strategy for where your practice is going and exactly how to get there
✔ Your Pricing, Profit and Revenue Plan — raise your rates, stabilize your income, and build toward consistent multi-six figure revenue
✔ Your Client Attraction and Marketing Strategy — attract aligned, consistent, and cash pay clients without burning out on content or guessing what works
✔ Your Hiring and Team Structure — build and lead a sustainable team, navigate the 1099 to W2 transition, and stop being the only engine running your practice
✔ Your Systems, Workflows and Operational Infrastructure — create the protocols and processes that let your practice run smoothly with or without you in every room
✔ Your Leadership and CEO Identity — step fully into your role as the decision maker, the visionary, and the leader your practice needs you to be
What's Included:
✔ 24 private 1:1 strategy sessions (50 minutes each, biweekly)
✔ Quarterly 90-day CEO planning and full practice audit
✔ Priority Voxer access — voice and text messaging between sessions so you are never stuck waiting two weeks for an answer
✔ Complete practice audit and personalized rebuild roadmap
✔ Advanced scaling strategy — hiring, team structure, group practice growth
✔ W2 vs 1099 transition support and compliance guidance
✔ Leadership identity and CEO confidence coaching
✔ Income stabilization and multiple revenue stream development
✔ Insurance credentialing support via admin team
✔ Templates, systems, tracking tools and resources throughout
✔ Private client portal access with all program materials
DONE-FOR-YOU DELIVERABLES
Psychology Today profile — fully rewritten for you
Full website audit — custom template provided, optional designer collaboration available
Video bio script written for you
Marketing materials review and complete edit
Custom referral template built for your practice
Hiring documents and job description templates — ready to use when you're ready to hire
Insurance credentialing handled entirely by admin team — including follow-up until panels are complete
QUARTERLY AUDIT INCLUDES
Caseload and capacity review — are you seeing the right clients at the right volume
Marketing and visibility check — what's generating inquiries and what needs to change
Systems and operations check — are your workflows running smoothly
CEO goals review — did you hit your 90 day targets and what's next
Written 90 day action plan delivered after each audit session
Clients are encouraged to work alongside their accountant or bookkeeper for detailed financial reporting
Once your payment is submitted you will receive your welcome email, onboarding details, and a link to schedule your first session. We get to work immediately.
I am ready to help you build the practice you have been working toward — with clarity, confidence, and a strategy that is built entirely around you.
Let's build your legacy. Together.$kj$, '/images/8dfa5308c9c5.png', 'usd', 'one_time', 1200000, true)
ON CONFLICT (slug) DO NOTHING;
INSERT INTO offer_products (offer_id, product_id, sort)
SELECT o.id, p.id, 0 FROM offers o JOIN products p ON p.id = 12
 WHERE o.slug = 'the-boss-boardroom'
ON CONFLICT (offer_id, product_id) DO NOTHING;
-- bwdYiyDK
INSERT INTO offers (title, slug, status, description, thumbnail_url, currency, pricing_type, amount_cents, collect_address)
VALUES ($kj$The Private Practice Blueprint-VIP$kj$, 'private-practice-blueprint-vip', 'draft', $kj$Everything You’ll Get
Even with free access, you’ll walk away with everything you need to build a strong foundation for your private practice and start seeing private clients:
Bonus #1: Access to the Live Training
$3,500 Value
Bonus #2: Worksheets
$197 Value
Special Bonus: Private Practice Income Calculator
$197 Value
General Admission Value
$3,900 Value
Bonus #3: VIP-Only FB Group
$297 Value
Bonus #4: Private VIP Q&A Sessions with Yvette
$1,000 Value
Bonus #5: Unlimited Replays of All Sessions
$5,000 Value
Bonus #6: Prepare to Profit Guided Meditation Journal
$297 Value
Bonus #7: Full Private Practice Blueprint Workbook
$297 Value
Special Bonus: Private Practice Income Calculator
$97 Value
VIP Access Value
$7,100 Value
VIP Access: $97
Secure your spot today and start building your private practice!
Due to the nature of this being a live challenge all sales are final and a refund will not be provided.$kj$, '/uploads/484947cfe6c8bb42.png', 'usd', 'one_time', 9700, true)
ON CONFLICT (slug) DO NOTHING;
