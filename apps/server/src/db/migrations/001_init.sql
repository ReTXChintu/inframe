CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         citext NOT NULL UNIQUE,
  name          text NOT NULL,
  password_hash text NOT NULL,
  -- Bumped on password change/reset: every outstanding token stops working.
  token_version integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- One row per signed-in browser. Only a hash of the refresh token is kept.
CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,
  user_agent   text,
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE password_resets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Faces a user can search for: themselves ("self", exactly one) and any
-- family members they enrol. The embedding is L2-normalised.
CREATE TABLE people (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('self', 'family')),
  name        text NOT NULL,
  relation    text,
  embedding   vector(512),
  has_selfie  boolean NOT NULL DEFAULT false,
  enrolled_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX people_one_self_idx ON people (owner_id) WHERE kind = 'self';
CREATE INDEX people_owner_idx ON people (owner_id);

-- A user's linked Google Drive / MEGA account. `secret` is AES-GCM
-- encrypted JSON (a Google refresh token, or MEGA email + password).
CREATE TABLE storage_connections (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  provider      text NOT NULL CHECK (provider IN ('gdrive', 'mega')),
  account_label text NOT NULL,
  secret        text NOT NULL,
  status        text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'error')),
  last_error    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX storage_connections_user_idx ON storage_connections (user_id);

CREATE TABLE events (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id              uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  name                  text NOT NULL,
  kind                  text NOT NULL DEFAULT 'other'
                        CHECK (kind IN ('trip', 'wedding', 'party', 'other')),
  starts_on             date,
  ends_on               date,
  cover_photo_id        uuid,
  join_code             text NOT NULL UNIQUE,
  join_enabled          boolean NOT NULL DEFAULT true,
  guest_uploads         boolean NOT NULL DEFAULT true,
  guests_see_all        boolean NOT NULL DEFAULT true,
  face_search           boolean NOT NULL DEFAULT true,
  storage_connection_id uuid REFERENCES storage_connections ON DELETE SET NULL,
  storage_folder_id     text,
  storage_folder_name   text,
  storage_folder_url    text,
  sync_state            text NOT NULL DEFAULT 'idle' CHECK (sync_state IN ('idle', 'syncing', 'error')),
  sync_error            text,
  last_synced_at        timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_owner_idx ON events (owner_id);

CREATE TABLE event_members (
  event_id  uuid NOT NULL REFERENCES events ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  role      text NOT NULL CHECK (role IN ('owner', 'cohost', 'member')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id)
);
CREATE INDEX event_members_user_idx ON event_members (user_id);

CREATE TABLE event_invites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid NOT NULL REFERENCES events ON DELETE CASCADE,
  email       citext NOT NULL,
  role        text NOT NULL CHECK (role IN ('cohost', 'member')),
  token_hash  text NOT NULL UNIQUE,
  invited_by  uuid REFERENCES users ON DELETE SET NULL,
  expires_at  timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX event_invites_open_idx ON event_invites (event_id, email) WHERE accepted_at IS NULL;
CREATE INDEX event_invites_email_idx ON event_invites (email) WHERE accepted_at IS NULL;

-- Albums inside an event. Each maps to a sub-folder of the event's storage
-- folder (created lazily on first upload, or discovered by sync).
CREATE TABLE folders (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          uuid NOT NULL REFERENCES events ON DELETE CASCADE,
  name              text NOT NULL,
  storage_folder_id text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX folders_event_name_idx ON folders (event_id, lower(name));

CREATE TABLE photos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid NOT NULL REFERENCES events ON DELETE CASCADE,
  folder_id       uuid REFERENCES folders ON DELETE SET NULL,
  uploader_id     uuid REFERENCES users ON DELETE SET NULL,
  source          text NOT NULL CHECK (source IN ('upload', 'storage')),
  original_name   text NOT NULL,
  mime_type       text,
  size_bytes      bigint,
  width           integer,
  height          integer,
  taken_at        timestamptz,
  -- Gallery order: when the photo was taken if known, else when added.
  sort_at         timestamptz NOT NULL DEFAULT now(),
  storage_file_id text,
  -- Browser upload not yet in Drive/MEGA: where the file waits on local disk.
  tmp_path        text,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'processing', 'ready', 'failed')),
  face_status     text NOT NULL DEFAULT 'pending'
                  CHECK (face_status IN ('pending', 'processing', 'done', 'failed')),
  face_count      integer NOT NULL DEFAULT 0,
  error           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX photos_event_file_idx ON photos (event_id, storage_file_id) WHERE storage_file_id IS NOT NULL;
CREATE INDEX photos_event_sort_idx ON photos (event_id, sort_at DESC, id DESC);
CREATE INDEX photos_uploader_idx ON photos (uploader_id);

ALTER TABLE events
  ADD CONSTRAINT events_cover_photo_fk FOREIGN KEY (cover_photo_id) REFERENCES photos ON DELETE SET NULL;

-- Every face the model found, as an L2-normalised 512-d embedding.
CREATE TABLE faces (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  photo_id   uuid NOT NULL REFERENCES photos ON DELETE CASCADE,
  event_id   uuid NOT NULL REFERENCES events ON DELETE CASCADE,
  embedding  vector(512) NOT NULL,
  det_score  real
);
CREATE INDEX faces_photo_idx ON faces (photo_id);
CREATE INDEX faces_event_idx ON faces (event_id);

-- Which people (self / family) appear in which photos. Rebuilt for a photo
-- when its faces change, and for a person when their selfie changes.
CREATE TABLE photo_matches (
  photo_id   uuid NOT NULL REFERENCES photos ON DELETE CASCADE,
  person_id  uuid NOT NULL REFERENCES people ON DELETE CASCADE,
  score      real NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (photo_id, person_id)
);
CREATE INDEX photo_matches_person_idx ON photo_matches (person_id);

CREATE TABLE favorites (
  user_id    uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  photo_id   uuid NOT NULL REFERENCES photos ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, photo_id)
);
CREATE INDEX favorites_photo_idx ON favorites (photo_id);
