-- Media library: alt text and tags.
--
-- `media_assets.folder` has been on the table since the first schema and nothing
-- could set it; the admin route now can (routes/admin/media.ts). These two
-- columns are the rest of what makes a library of a few hundred files findable:
-- a description of a picture for the people who cannot see it, and free-form
-- labels that cut across folders.
--
-- NOT NULL with a default, like every other text column on this table, so the
-- API never has to tell "no alt text" from "alt text not loaded".
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS alt_text TEXT NOT NULL DEFAULT '';
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';

-- `?tag=` is a containment test, which is what GIN answers.
CREATE INDEX IF NOT EXISTS idx_media_assets_tags ON media_assets USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_media_assets_folder ON media_assets (folder) WHERE folder <> '';
