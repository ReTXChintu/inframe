-- Nothing is kept on the server's disk any more: thumbnails and previews live
-- next to each original, in a hidden ".inframe" sub-folder of its storage
-- folder; selfies (small 512px images) live in the database.

ALTER TABLE photos DROP COLUMN IF EXISTS tmp_path;
ALTER TABLE photos
  -- Storage folder that holds the original (its ".inframe" sibling holds the derivatives).
  ADD COLUMN storage_parent_id text,
  ADD COLUMN thumb_file_id     text,
  ADD COLUMN preview_file_id   text;

ALTER TABLE people ADD COLUMN selfie_image bytea;

-- 'memory' = development-only in-memory storage (refused in production).
ALTER TABLE storage_connections DROP CONSTRAINT IF EXISTS storage_connections_provider_check;
ALTER TABLE storage_connections
  ADD CONSTRAINT storage_connections_provider_check CHECK (provider IN ('gdrive', 'mega', 'memory'));
