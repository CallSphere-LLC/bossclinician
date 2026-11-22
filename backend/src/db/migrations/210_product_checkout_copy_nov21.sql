-- Sheet row 245 (21-Nov website copy), generated from assets/r245B/r245E-B.sql; guarded updates, no-ops when already applied.
-- r245E agent B: approved copy edits (no price/billing/access fields touched)
-- Dos & Don'ts replay: remove stale pending-approval wording (CE approval confirmed by Yvette, doc s.15 item 4)
UPDATE courses SET sales_page = jsonb_set(sales_page, '{hero,highlights,2}', to_jsonb($q$3.5 Ethics CE hours$q$::text)), updated_at = now()
 WHERE slug = 'dos-and-donts-of-clinical-documentation-replay' AND sales_page #>> '{hero,highlights,2}' = $q$3.5 Ethics CE hours — subject to final approval$q$;
UPDATE courses SET sales_page = jsonb_set(sales_page, '{sections,0,list,1}', to_jsonb($q$Continuing Education: 3.5 CE contact hours (Ethics)$q$::text)), updated_at = now()
 WHERE slug = 'dos-and-donts-of-clinical-documentation-replay' AND sales_page #>> '{sections,0,list,1}' = $q$Continuing Education: 3.5 CE contact hours (Ethics), subject to final approval of this on-demand offering$q$;
UPDATE courses SET sales_page = jsonb_set(sales_page, '{sections,5,notes}', '[]'::jsonb), updated_at = now()
 WHERE slug = 'dos-and-donts-of-clinical-documentation-replay' AND sales_page #>> '{sections,5,notes,0}' = $q$Continuing education approval details, required passing score, and certificate procedures will be provided according to the approved on-demand program.$q$;
-- offers.description (checkout summaries) subtractive edits
UPDATE offers SET description = replace(description, ($q$ with this exclusive one-time offer!$q$), ($q$!$q$)), updated_at = now()
 WHERE slug = ($q$fully-booked-toolkit$q$) AND strpos(description, ($q$ with this exclusive one-time offer!$q$)) > 0;
UPDATE offers SET description = replace(description, ($q$ today only$q$||chr(10)||$q$$q$), ($q$$q$||chr(10)||$q$$q$)), updated_at = now()
 WHERE slug = ($q$fully-booked-toolkit$q$) AND strpos(description, ($q$ today only$q$||chr(10)||$q$$q$)) > 0;
UPDATE offers SET description = replace(description, ($q$Turn Doctor Referrals Into Ideal Clients — With Confidence$q$||chr(10)||$q$$q$), ($q$Know What to Say When You Reach Out to Referral Partners.$q$||chr(10)||$q$$q$)), updated_at = now()
 WHERE slug = ($q$provider-partnership-guide$q$) AND strpos(description, ($q$Turn Doctor Referrals Into Ideal Clients — With Confidence$q$||chr(10)||$q$$q$)) > 0;
UPDATE offers SET description = replace(description, ($q$ and build long-term referral relationships that fill your caseload.$q$), ($q$ and build long-term referral relationships.$q$)), updated_at = now()
 WHERE slug = ($q$provider-partnership-guide$q$) AND strpos(description, ($q$ and build long-term referral relationships that fill your caseload.$q$)) > 0;
UPDATE offers SET description = replace(description, ($q$A steady flow of aligned clients$q$||chr(10)||$q$$q$), ($q$$q$)), updated_at = now()
 WHERE slug = ($q$provider-partnership-guide$q$) AND strpos(description, ($q$A steady flow of aligned clients$q$||chr(10)||$q$$q$)) > 0;
UPDATE offers SET description = replace(description, ($q$You're One Step Away From Charging What You're Worth$q$||chr(10)||$q$$q$), ($q$Set a Session Rate Using Your Practice’s Numbers.$q$||chr(10)||$q$$q$)), updated_at = now()
 WHERE slug = ($q$ramp-up-rate-formula$q$) AND strpos(description, ($q$You're One Step Away From Charging What You're Worth$q$||chr(10)||$q$$q$)) > 0;
UPDATE offers SET description = replace(description, ($q$You can earn this investment back in just one session.$q$||chr(10)||$q$Even better? It's tax-deductible.$q$||chr(10)||$q$$q$), ($q$$q$)), updated_at = now()
 WHERE slug = ($q$ramp-up-rate-formula$q$) AND strpos(description, ($q$You can earn this investment back in just one session.$q$||chr(10)||$q$Even better? It's tax-deductible.$q$||chr(10)||$q$$q$)) > 0;
UPDATE offers SET description = replace(description, ($q$Ready to confidently charge what you're worth?$q$||chr(10)||$q$$q$), ($q$Ready to set your rates with confidence?$q$||chr(10)||$q$$q$)), updated_at = now()
 WHERE slug = ($q$ramp-up-rate-formula$q$) AND strpos(description, ($q$Ready to confidently charge what you're worth?$q$||chr(10)||$q$$q$)) > 0;
UPDATE offers SET description = replace(description, ($q$Legally-Sound, Plug-and-Play Forms & Templates for Mental Health Therapists.$q$||chr(10)||$q$$q$), ($q$Editable Forms to Help You Organize Your Practice Paperwork.$q$||chr(10)||$q$$q$)), updated_at = now()
 WHERE slug = ($q$private-practice-protection-pack$q$) AND strpos(description, ($q$Legally-Sound, Plug-and-Play Forms & Templates for Mental Health Therapists.$q$||chr(10)||$q$$q$)) > 0;
UPDATE offers SET description = replace(description, ($q$designed to keep your practice legally protected, professionally organized, and ethically sound.$q$), ($q$designed to keep your practice professionally organized.$q$)), updated_at = now()
 WHERE slug = ($q$private-practice-protection-pack$q$) AND strpos(description, ($q$designed to keep your practice legally protected, professionally organized, and ethically sound.$q$)) > 0;
UPDATE offers SET description = replace(description, ($q$Every document is crafted to help you stay compliant, set clear boundaries, and reduce liability —without$q$), ($q$Every document is crafted to help you set clear boundaries —without$q$)), updated_at = now()
 WHERE slug = ($q$private-practice-protection-pack$q$) AND strpos(description, ($q$Every document is crafted to help you stay compliant, set clear boundaries, and reduce liability —without$q$)) > 0;
UPDATE offers SET description = replace(description, ($q$Every document is designed to protect your practice, streamline your processes, and keep you compliant.$q$), ($q$Every document is designed to streamline your processes.$q$)), updated_at = now()
 WHERE slug = ($q$private-practice-protection-pack$q$) AND strpos(description, ($q$Every document is designed to protect your practice, streamline your processes, and keep you compliant.$q$)) > 0;
UPDATE offers SET description = replace(description, ($q$✔️ Legal Protection Forms – Reduce liability and safeguard your practice.$q$), ($q$✔️ Legal Protection Forms$q$)), updated_at = now()
 WHERE slug = ($q$private-practice-protection-pack$q$) AND strpos(description, ($q$✔️ Legal Protection Forms – Reduce liability and safeguard your practice.$q$)) > 0;
UPDATE offers SET description = replace(description, ($q$✔️ Telehealth Consent Form – Ensure compliance for virtual sessions.$q$), ($q$✔️ Telehealth Consent Form$q$)), updated_at = now()
 WHERE slug = ($q$private-practice-protection-pack$q$) AND strpos(description, ($q$✔️ Telehealth Consent Form – Ensure compliance for virtual sessions.$q$)) > 0;
UPDATE offers SET description = replace(description, ($q$ —your quick-reference guide to ensuring your practice meets legal requirements.$q$), ($q$ —your quick-reference guide.$q$)), updated_at = now()
 WHERE slug = ($q$private-practice-protection-pack$q$) AND strpos(description, ($q$ —your quick-reference guide to ensuring your practice meets legal requirements.$q$)) > 0;
UPDATE offers SET description = replace(description, ($q$ Every form has been carefully crafted and reviewed by legal professionals to meet ethical and compliance standards.$q$), ($q$$q$)), updated_at = now()
 WHERE slug = ($q$private-practice-protection-pack$q$) AND strpos(description, ($q$ Every form has been carefully crafted and reviewed by legal professionals to meet ethical and compliance standards.$q$)) > 0;
UPDATE offers SET description = replace(description, ($q$✅ Lawyer-Reviewed & Compliant – Protect yourself from liability and legal risks.$q$), ($q$✅ Lawyer-Reviewed$q$)), updated_at = now()
 WHERE slug = ($q$private-practice-protection-pack$q$) AND strpos(description, ($q$✅ Lawyer-Reviewed & Compliant – Protect yourself from liability and legal risks.$q$)) > 0;
UPDATE offers SET description = replace(description, ($q$Get the forms you need to stay protected and legally secure—all for$q$), ($q$Get the forms you need—all for$q$)), updated_at = now()
 WHERE slug = ($q$private-practice-protection-pack$q$) AND strpos(description, ($q$Get the forms you need to stay protected and legally secure—all for$q$)) > 0;
UPDATE offers SET description = replace(description, ($q$✔️ Private practice owners who need legally sound documentation$q$||chr(10)||$q$$q$), ($q$✔️ Private practice owners$q$||chr(10)||$q$$q$)), updated_at = now()
 WHERE slug = ($q$private-practice-protection-pack$q$) AND strpos(description, ($q$✔️ Private practice owners who need legally sound documentation$q$||chr(10)||$q$$q$)) > 0;
UPDATE offers SET description = replace(description, ($q$✔️ Anyone who wants to protect their practice and stay compliant$q$||chr(10)||$q$$q$), ($q$$q$)), updated_at = now()
 WHERE slug = ($q$private-practice-protection-pack$q$) AND strpos(description, ($q$✔️ Anyone who wants to protect their practice and stay compliant$q$||chr(10)||$q$$q$)) > 0;
UPDATE offers SET description = replace(description, ($q$A: Yes! These documents are designed with HIPAA compliance in mind.$q$), ($q$A: These documents are designed with HIPAA compliance in mind.$q$)), updated_at = now()
 WHERE slug = ($q$private-practice-protection-pack$q$) AND strpos(description, ($q$A: Yes! These documents are designed with HIPAA compliance in mind.$q$)) > 0;
UPDATE offers SET description = replace(description, ($q$takes you from feeling stuck to signing your first paying client—without$q$), ($q$takes you from feeling stuck to a first-client strategy—without$q$)), updated_at = now()
 WHERE slug = ($q$private-practice-starter-suite$q$) AND strpos(description, ($q$takes you from feeling stuck to signing your first paying client—without$q$)) > 0;
UPDATE offers SET description = replace(description, ($q$No Risk – Just Results!$q$||chr(10)||$q$$q$), ($q$$q$)), updated_at = now()
 WHERE slug = ($q$private-practice-starter-suite$q$) AND strpos(description, ($q$No Risk – Just Results!$q$||chr(10)||$q$$q$)) > 0;
UPDATE offers SET description = replace(description, ($q$Insider tips to save time, reduce errors, and avoid delays with insurance panels.$q$), ($q$Insider tips to save time and reduce errors with insurance panels.$q$)), updated_at = now()
 WHERE slug = ($q$credentialing-success-formula$q$) AND strpos(description, ($q$Insider tips to save time, reduce errors, and avoid delays with insurance panels.$q$)) > 0;
UPDATE offers SET description = replace(description, ($q$Expand your team and scale your services effortlessly.$q$), ($q$Expand your team and scale your services.$q$)), updated_at = now()
 WHERE slug = ($q$credentialing-success-formula$q$) AND strpos(description, ($q$Expand your team and scale your services effortlessly.$q$)) > 0;
UPDATE offers SET description = replace(description, ($q$Continuing Education: 3.5 CE contact hours (Ethics), subject to final approval of this on-demand offering.$q$), ($q$Continuing Education: 3.5 CE contact hours (Ethics).$q$)), updated_at = now()
 WHERE slug = ($q$dos-and-donts-of-clinical-documentation-replay-free$q$) AND strpos(description, ($q$Continuing Education: 3.5 CE contact hours (Ethics), subject to final approval of this on-demand offering.$q$)) > 0;
