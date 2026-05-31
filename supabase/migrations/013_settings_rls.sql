-- 013 — Lock down the settings table (security audit PK-H3)
-- settings was created in 007 WITHOUT row level security. In Supabase, a public-
-- schema table without RLS is reachable through the public anon key per default
-- grants (flagged as an error by the Security Advisor). No anon policy is added:
-- settings is admin-only and reached exclusively via the service-role key in API
-- routes, which bypasses RLS.
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
