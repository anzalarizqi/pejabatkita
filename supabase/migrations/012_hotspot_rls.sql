-- supabase/migrations/012_hotspot_rls.sql
-- Allow anon (public) to read hotspot_events for /pulse page.

ALTER TABLE hotspot_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_hotspot_events" ON hotspot_events FOR SELECT TO anon USING (true);
