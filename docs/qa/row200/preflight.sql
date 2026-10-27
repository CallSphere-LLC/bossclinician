-- Read-only, no endpoints/secrets or customer data in output.
BEGIN READ ONLY;
SELECT trigger_type, count(*) AS active_rules,
 count(*) FILTER (WHERE trigger_type <> 'form_submitted' OR COALESCE(trigger_config->>'formId','') IN ('','0')) AS unscoped_rules
FROM automations WHERE status='active' AND trigger_type IN ('form_submitted','contact_created','member_created','member_granted_access')
GROUP BY trigger_type ORDER BY trigger_type;
SELECT e.event_type, count(w.id) AS matching_enabled_webhooks
FROM unnest(ARRAY['form.submitted','contact.created','contact.updated','member.created','member.granted_access']) e(event_type)
LEFT JOIN webhook_endpoints w ON w.enabled AND (cardinality(w.event_types)=0 OR e.event_type=ANY(w.event_types))
GROUP BY e.event_type ORDER BY e.event_type;
DO $guard$
DECLARE form_id integer;
BEGIN
 SELECT id INTO form_id FROM forms WHERE slug='boss-move-intake-survey' AND NOT published AND NOT notify_on_submit AND NOT create_lead;
 IF form_id IS NULL THEN RAISE EXCEPTION 'Native survey missing or notification/public/lead configuration changed'; END IF;
 IF NOT EXISTS (SELECT 1 FROM course_lessons l JOIN course_modules m ON m.id=l.module_id JOIN products p ON p.course_id=m.course_id
   WHERE l.id=249 AND l.slug='start-here-welcome-to-the-boss-clinician-club-program'
     AND l.tool_key='form-boss-move-intake-survey' AND l.published AND p.id=44 AND p.course_id=52 AND p.slug='the-boss-move')
 THEN RAISE EXCEPTION 'Expected production welcome/product/course mapping changed'; END IF;
 IF EXISTS (SELECT 1 FROM automations WHERE status='active' AND (
   trigger_type IN ('contact_created','member_created','member_granted_access') OR
   (trigger_type='form_submitted' AND (COALESCE(trigger_config->>'formId','') !~ '^[1-9][0-9]*$' OR trigger_config->>'formId'=form_id::text))))
 THEN RAISE EXCEPTION 'Matching active automation: use display-only Chrome QA pending review'; END IF;
 IF EXISTS (SELECT 1 FROM webhook_endpoints WHERE enabled AND
   (cardinality(event_types)=0 OR event_types && ARRAY['form.submitted','contact.created','contact.updated','member.created','member.granted_access']))
 THEN RAISE EXCEPTION 'Matching outbound webhook: use display-only Chrome QA pending review'; END IF;
END
$guard$;
SELECT 'PASS: current configuration permits isolated synthetic form QA; rerun immediately before use' AS result;
ROLLBACK;
