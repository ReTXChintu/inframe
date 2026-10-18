-- The first account ever created is the super admin.
ALTER TABLE users ADD COLUMN is_admin boolean NOT NULL DEFAULT false;

-- Databases that already have users: promote the earliest one.
UPDATE users SET is_admin = true
 WHERE id = (SELECT id FROM users ORDER BY created_at, id LIMIT 1)
   AND NOT EXISTS (SELECT 1 FROM users WHERE is_admin);

-- Server settings the admin edits in the app (Google OAuth client, SMTP, face
-- model). A row overrides the matching .env value. Secret values are stored
-- AES-GCM encrypted with ENCRYPTION_KEY.
CREATE TABLE app_settings (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  is_secret  boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES users ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
