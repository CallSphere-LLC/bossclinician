-- Sheet row 242: the on-demand Do's & Don'ts course (63) issues Yvette's new
-- certificate design (Google Slides export, NBCC ACEP No. 7998, 3.5 CE contact
-- hours = 14 quarter-hours).
--
-- Artwork: backend/assets/certificates/dos-donts-ondemand-v2.png is the slide
-- rendered at 3x (2880x1620) with only the "{{full name}}" and "{{date}}"
-- placeholder text removed; the underlines, logo, NBCC seal and signature stay
-- in the image. The renderer draws the member's name on the upper underline,
-- the completion date on the lower one, and the verification code in the empty
-- lower-left corner. Coordinates are slide points (960x540).
--
-- Only template 4 changes. Certificates already issued keep their own
-- snapshotted artwork/provider number (none were issued for course 63 at the
-- time of writing). Eligibility (issue_on, enabled, credit hours) is unchanged.
-- Course 62's template is not touched.
UPDATE certificate_templates
   SET title = 'Certificate of Completion',
       body = 'The Do''s & Don''ts of Clinical Documentation: Ethical, Legal, and Audit-Ready Records',
       signature_name = 'Yvette Howard, LCSW',
       signature_title = 'Instructor',
       ceu_provider_number = '7998',
       ceu_provider_name = 'Boss Clinician, LLC',
       background_image = 'dos-donts-ondemand-v2.png',
       background_layout = $layout$ {
         "page":{"width":960,"height":540},
         "recipient":{"erase":[440,218,80,15],"draw":[292,214,376,21],"font":"Times-Bold","size":18,"color":"#1F3864"},
         "date":{"erase":[456,384,48,15],"draw":[365,386,230,15],"font":"Helvetica","size":12,"color":"#222222"},
         "verification":{"draw":[42,478,255,24],"size":7,"color":"#1F3864","align":"left"},
         "creditQuarterHours":14,"providerNumber":"7998"
       } $layout$::jsonb,
       updated_at = now()
 WHERE id = 4
   AND course_id = 63
   AND issue_on = 'completion'
   AND ceu_credit_quarter_hours = 14;
