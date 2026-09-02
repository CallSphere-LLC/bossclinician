-- An episode with nothing to play must never appear in a public podcast feed.
-- Repair the legacy rows first, then make the rule true for every write path,
-- including API clients that do not use the admin form.
UPDATE podcast_episodes
   SET published = false, published_at = NULL, updated_at = now()
 WHERE published AND btrim(audio_url) = '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'podcast_episode_live_has_audio'
       AND conrelid = 'podcast_episodes'::regclass
  ) THEN
    ALTER TABLE podcast_episodes
      ADD CONSTRAINT podcast_episode_live_has_audio
      CHECK (NOT published OR btrim(audio_url) <> '');
  END IF;
END $$;
