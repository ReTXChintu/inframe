-- How much each guest (a member who isn't a host) may add to an event:
-- a number of photos and videos, and a total size. NULL = no limit. The
-- owner changes both in the event's settings; existing events get the
-- defaults, which is what a new event starts with too.
ALTER TABLE events
  ADD COLUMN guest_max_items integer CHECK (guest_max_items IS NULL OR guest_max_items > 0) DEFAULT 300,
  ADD COLUMN guest_max_bytes bigint  CHECK (guest_max_bytes IS NULL OR guest_max_bytes > 0) DEFAULT 2147483648;
