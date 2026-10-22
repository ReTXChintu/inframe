-- Push notifications to the phone app.
--
-- A phone's Firebase Cloud Messaging token belongs to whoever signed in on
-- it last; it goes when they sign out there or Firebase says it's gone.
CREATE TABLE device_tokens (
  token        text PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  platform     text NOT NULL DEFAULT 'android',
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX device_tokens_user_idx ON device_tokens (user_id);

-- New photos are told in batches: "12 new photos in Goa", at most once per
-- event per person every 30 minutes. A ready photo adds to `pending` for
-- everyone who may see it; the API process sends what's due and resets it.
CREATE TABLE photo_push_batches (
  event_id     uuid NOT NULL REFERENCES events ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  pending      integer NOT NULL DEFAULT 0,
  last_sent_at timestamptz,
  PRIMARY KEY (event_id, user_id)
);
CREATE INDEX photo_push_batches_due_idx ON photo_push_batches (last_sent_at) WHERE pending > 0;
