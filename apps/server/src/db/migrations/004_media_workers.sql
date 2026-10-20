-- Videos alongside photos, uploads that are queued on the server before a
-- worker process sends them on to Drive/MEGA, and duplicate detection.

ALTER TABLE photos
  ADD COLUMN media_type         text NOT NULL DEFAULT 'image' CHECK (media_type IN ('image', 'video')),
  ADD COLUMN duration_ms        integer,
  -- Browser/app upload waiting on the server's disk for a worker to store it.
  ADD COLUMN spool_path         text,
  -- The file's date on the uploader's device (last modified / created). With
  -- the name and size it identifies "the same file" when someone re-uploads.
  ADD COLUMN client_modified_at timestamptz;

-- Videos are never face-scanned.
ALTER TABLE photos DROP CONSTRAINT IF EXISTS photos_face_status_check;
ALTER TABLE photos
  ADD CONSTRAINT photos_face_status_check CHECK (face_status IN ('pending', 'processing', 'done', 'failed', 'skipped'));

CREATE INDEX photos_spool_idx ON photos (id) WHERE spool_path IS NOT NULL;
CREATE INDEX photos_duplicate_idx ON photos (event_id, lower(original_name), size_bytes);
