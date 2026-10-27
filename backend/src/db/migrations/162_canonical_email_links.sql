-- Row 192: only exact retired-public HTTP(S) URL origins in email body fields.
-- Preserve template wording/configuration, automation state, recipients and history.
-- Token-wise scanning avoids changing nested old URLs in third-party redirect URLs.
CREATE OR REPLACE FUNCTION pg_temp.bc192_email_links(body text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $fn$
DECLARE
  remaining text := body;
  result text := '';
  matched text[];
  token text;
  pos integer;
BEGIN
  IF body IS NULL THEN RETURN NULL; END IF;
  LOOP
    matched := regexp_match(remaining, $re$(https?://[^[:space:]<>"'`]+)$re$, 'i');
    IF matched IS NULL THEN RETURN result || remaining; END IF;
    token := matched[1];
    pos := strpos(remaining, token);
    result := result || substr(remaining, 1, pos - 1);
    IF token ~* $re$^(http://bossclinician[.]callsphere[.]site(:80)?|https://bossclinician[.]callsphere[.]site(:443)?)([/?#]|$)$re$ THEN
      result := result || regexp_replace(token,
        $re$^https?://bossclinician[.]callsphere[.]site(:80|:443)?$re$,
        'https://www.bossclinician.com', 'i');
    ELSE
      result := result || token;
    END IF;
    remaining := substr(remaining, pos + length(token));
  END LOOP;
END;
$fn$;

UPDATE automation_actions
SET config = jsonb_set(config, '{bodyMd}', to_jsonb(pg_temp.bc192_email_links(config->>'bodyMd')))
WHERE action_type = 'send_email'
  AND jsonb_typeof(config->'bodyMd') = 'string'
  AND pg_temp.bc192_email_links(config->>'bodyMd') IS DISTINCT FROM config->>'bodyMd';

UPDATE email_templates
SET body_md = pg_temp.bc192_email_links(body_md)
WHERE pg_temp.bc192_email_links(body_md) IS DISTINCT FROM body_md;

DROP FUNCTION pg_temp.bc192_email_links(text);
