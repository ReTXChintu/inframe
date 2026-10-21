-- Events linked to a trip planned in Trippin (the suite's hub). Trippin
-- creates the event, keeps its name, dates and members in step, and reads a
-- live summary back. Unlinking only clears `external_linked`: the event and
-- its photos stay as a normal event, and the source/id/url remain so the app
-- can say "Was linked to Trippin" (and Trippin can link it again).
ALTER TABLE events
  ADD COLUMN external_source text,
  ADD COLUMN external_id     text,
  ADD COLUMN external_url    text,
  ADD COLUMN external_linked boolean;
CREATE UNIQUE INDEX events_external_idx ON events (external_source, external_id)
  WHERE external_source IS NOT NULL AND external_id IS NOT NULL;

-- Storage is optional from now on: a linked event starts with no storage
-- connection and folder (the columns were already nullable) and waits for
-- its owner to pick a Drive/MEGA folder. "Storage pending" is simply
-- storage_folder_id IS NULL.

-- Who brought a member in. NULL = joined in InFrame (code, link, invite);
-- 'trippin' = added because they're on the linked trip. Trippin's member
-- changes only ever remove the members it added.
ALTER TABLE event_members ADD COLUMN source text;

-- Deliveries already handled, so a retried webhook is answered with the
-- same response and applied only once.
CREATE TABLE integration_events (
  source       text NOT NULL,
  id           text NOT NULL,
  type         text NOT NULL,
  response     jsonb NOT NULL DEFAULT '{}'::jsonb,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, id)
);
