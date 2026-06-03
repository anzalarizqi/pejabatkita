-- supabase/migrations/015_hotspot_story_id.sql
-- Event clustering: group multi-source articles into one "story".
-- Canonical (first-seen) row of a cluster has story_id = event_id.

-- ON DELETE SET NULL: if a canonical event is removed, its sources orphan to
-- their own story (read layer falls back to event_id) rather than blocking the delete.
ALTER TABLE hotspot_events
    ADD COLUMN IF NOT EXISTS story_id UUID REFERENCES hotspot_events(event_id) ON DELETE SET NULL;

-- Existing rows each become their own story until the backfill regroups them.
UPDATE hotspot_events SET story_id = event_id WHERE story_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_hotspot_story_id ON hotspot_events(story_id);
