-- Sheet row 245 (21-Nov website copy), generated from assets/r245-agentD/blog-update.sql; guarded updates, no-ops when already applied.

-- audit-ready-documentation-private-practice
UPDATE blog_posts SET
  body_md = replace(replace(body_md, $q$This is why I’m hosting Audit Proof Your Practice on January 30.$q$, $q$This is why I created Audit Proof Your Practice, now available as an [on-demand training](/courses/audit-proof-your-practice-on-demand).$q$), $q$In this live training, you’ll learn how to:$q$, $q$In this training, you’ll learn how to:$q$),
  updated_at = now()
WHERE slug = 'audit-ready-documentation-private-practice'
  AND position($q$This is why I’m hosting Audit Proof Your Practice on January 30.$q$ in body_md) > 0
  AND position($q$In this live training, you’ll learn how to:$q$ in body_md) > 0;

-- clinical-notes-vs-audit-ready-notes
UPDATE blog_posts SET
  body_md = replace(body_md, $q$This is exactly what I will be teaching inside **Audit Proof Your Practice** on January 30.$q$, $q$This is exactly what I teach inside **Audit Proof Your Practice**, now available as an [on-demand training](/courses/audit-proof-your-practice-on-demand).$q$),
  updated_at = now()
WHERE slug = 'clinical-notes-vs-audit-ready-notes'
  AND position($q$This is exactly what I will be teaching inside **Audit Proof Your Practice** on January 30.$q$ in body_md) > 0;

-- dont-let-fear-delay-your-private-practice
UPDATE blog_posts SET
  body_md = replace(body_md, $q$[apply to work with me](/work-with-me)$q$, $q$[watch the free Practice Prep Training](/practicepreptraining)$q$),
  updated_at = now()
WHERE slug = 'dont-let-fear-delay-your-private-practice'
  AND position($q$[apply to work with me](/work-with-me)$q$ in body_md) > 0;

-- how-to-stop-seeing-25-clients-a-week-and-still-hit-your-income-goals
UPDATE blog_posts SET
  body_md = replace(replace(replace(replace(replace(body_md, $q$

**You can earn more and see fewer clients. It requires strategy — not sacrifice.**$q$, $q$$q$), $q$

**Most therapists have never done this math. They just fill their schedule and hope the numbers work out. That is not a strategy — that is survival mode.**$q$, $q$$q$), $q$

**Your caseload does not have to be a fixed weight you carry alone. With structure, it can become an opportunity for someone else — and a release valve for you.**$q$, $q$$q$), $q$Today I see my own clients bi-weekly, three days a week.$q$, $q$I currently maintain a small clinical caseload to keep my clinical skills current.$q$), $q$

\`\`\`$q$, $q$$q$),
  updated_at = now()
WHERE slug = 'how-to-stop-seeing-25-clients-a-week-and-still-hit-your-income-goals'
  AND position($q$

**You can earn more and see fewer clients. It requires strategy — not sacrifice.**$q$ in body_md) > 0
  AND position($q$

**Most therapists have never done this math. They just fill their schedule and hope the numbers work out. That is not a strategy — that is survival mode.**$q$ in body_md) > 0
  AND position($q$

**Your caseload does not have to be a fixed weight you carry alone. With structure, it can become an opportunity for someone else — and a release valve for you.**$q$ in body_md) > 0
  AND position($q$Today I see my own clients bi-weekly, three days a week.$q$ in body_md) > 0
  AND position($q$

\`\`\`$q$ in body_md) > 0;

-- money-guilt-therapists-charging-fees
UPDATE blog_posts SET
  body_md = replace(body_md, $q$[Ramp-Up Revenue Course](/rampedrevenue)$q$, $q$[Ramp-Up Rate Formula](/courses/ramp-up-rate-formula)$q$),
  updated_at = now()
WHERE slug = 'money-guilt-therapists-charging-fees'
  AND position($q$[Ramp-Up Revenue Course](/rampedrevenue)$q$ in body_md) > 0;

-- peace-of-mind-for-therapists-audit-preparedness
UPDATE blog_posts SET
  body_md = replace(replace(body_md, $q$In this live training, we will cover:$q$, $q$In this training, we will cover:$q$), $q$📅 **Audit Proof Your Practice — Live Training**  
🗓 **January 30**  
📍 **Live on Zoom**

**👉 Register here [Protect Your Practice](/courses/private-practice-protection-pack)**$q$, $q$*The January 30 live training has ended. Audit Proof Your Practice is now available on demand.*

**👉 [Audit Proof Your Practice (On-Demand Training)](/courses/audit-proof-your-practice-on-demand)**$q$),
  updated_at = now()
WHERE slug = 'peace-of-mind-for-therapists-audit-preparedness'
  AND position($q$In this live training, we will cover:$q$ in body_md) > 0
  AND position($q$📅 **Audit Proof Your Practice — Live Training**  
🗓 **January 30**  
📍 **Live on Zoom**

**👉 Register here [Protect Your Practice](/courses/private-practice-protection-pack)**$q$ in body_md) > 0;

-- what-auditors-look-for-therapist-notes
UPDATE blog_posts SET
  body_md = replace(body_md, $q$📅 **January 30, 2026**  
👉 **Register here:** [Protect Your Practice](/courses/private-practice-protection-pack)$q$, $q$*The January 30 live training has ended. Audit Proof Your Practice is now available on demand.*

👉 [**Audit Proof Your Practice (On-Demand Training)**](/courses/audit-proof-your-practice-on-demand)$q$),
  updated_at = now()
WHERE slug = 'what-auditors-look-for-therapist-notes'
  AND position($q$📅 **January 30, 2026**  
👉 **Register here:** [Protect Your Practice](/courses/private-practice-protection-pack)$q$ in body_md) > 0;

-- toolkit-before-my-audit-registration-closes-september-25
UPDATE blog_posts SET
  body_md = replace(replace(replace(replace(replace(body_md, $q$Most training sends you home with a certificate$q$, $q$*Archived post: this was written for the September 25 live training, which has ended. The training is now available as an on-demand replay: [The Do's & Don'ts of Clinical Documentation (On-Demand Replay)](/documentationondemand).*

Most training sends you home with a certificate$q$), $q$That's the whole reason I built it this way.

I get asked almost every time if I'll push the date back. I won't. Not because I'm trying to create pressure, but because the people who show up on September 25 deserve a room that's actually prepared, not one I kept propping the door open for.

$q$, $q$That's the whole reason I built it this way.

$q$), $q$A self-audit checklist.

📅 **Wednesday, September 25 · 1:00 to 4:30 PM PT · Live on Zoom**

Once the seats are full, or once the live session starts, registration closes.

$q$, $q$A self-audit checklist.

$q$), $q$### The Details

📅 **Wednesday, September 25 · 1:00 to 4:30 PM PT · Live on Zoom · $167**

**3.5 Ethics CEUs. Nevada Board Approved.**

$q$, $q$$q$), $q$👉 [**Register before seats close**](/doc-registration)$q$, $q$👉 [**Watch the on-demand replay**](/documentationondemand)$q$),
  title = CASE WHEN title = $q$The Toolkit I Wish I'd Had Before My Audit (Registration Closes September 25)$q$ THEN $q$The Toolkit I Wish I'd Had Before My Audit$q$ ELSE title END,
  excerpt = CASE WHEN excerpt = $q$Registration for The Do's and Don'ts of Clinical Documentation closes September 25th. See the toolkit included, what's inside the live training, and why I built it after my own audit.$q$ THEN $q$See the toolkit included with The Do's and Don'ts of Clinical Documentation, what's inside the training, and why I built it after my own audit.$q$ ELSE excerpt END,
  updated_at = now()
WHERE slug = 'toolkit-before-my-audit-registration-closes-september-25'
  AND position($q$Most training sends you home with a certificate$q$ in body_md) > 0
  AND position($q$That's the whole reason I built it this way.

I get asked almost every time if I'll push the date back. I won't. Not because I'm trying to create pressure, but because the people who show up on September 25 deserve a room that's actually prepared, not one I kept propping the door open for.

$q$ in body_md) > 0
  AND position($q$A self-audit checklist.

📅 **Wednesday, September 25 · 1:00 to 4:30 PM PT · Live on Zoom**

Once the seats are full, or once the live session starts, registration closes.

$q$ in body_md) > 0
  AND position($q$### The Details

📅 **Wednesday, September 25 · 1:00 to 4:30 PM PT · Live on Zoom · $167**

**3.5 Ethics CEUs. Nevada Board Approved.**

$q$ in body_md) > 0
  AND position($q$👉 [**Register before seats close**](/doc-registration)$q$ in body_md) > 0;

-- dos-and-donts-of-clinical-documentation
UPDATE blog_posts SET
  body_md = replace(replace(replace(body_md, $q$📅 **Wednesday, September 25 · 1:00 to 4:30 PM PT · Live on Zoom**

In this live training, you'll learn how to:$q$, $q$The training is now available as an on-demand replay. In it, you'll learn how to:$q$), $q$**3.5 Ethics CEUs. Nevada Board Approved.**

$q$, $q$$q$), $q$👉 [**Register here**](/doc-registration)$q$, $q$👉 [**Watch the on-demand replay**](/documentationondemand)$q$),
  updated_at = now()
WHERE slug = 'dos-and-donts-of-clinical-documentation'
  AND position($q$📅 **Wednesday, September 25 · 1:00 to 4:30 PM PT · Live on Zoom**

In this live training, you'll learn how to:$q$ in body_md) > 0
  AND position($q$**3.5 Ethics CEUs. Nevada Board Approved.**

$q$ in body_md) > 0
  AND position($q$👉 [**Register here**](/doc-registration)$q$ in body_md) > 0;

