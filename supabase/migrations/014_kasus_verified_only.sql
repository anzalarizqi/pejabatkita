-- 014 — Only verified corruption records are public (security audit PK-H4)
-- The 008 policy used USING (true), exposing rows where verified IS NULL (not yet
-- checked) or verified = false (rejected) to the public anon key — i.e. publishing
-- unverified allegations about named individuals. Restrict anon SELECT to confirmed
-- cases only. Service-role reads (admin tooling, the rekam-bersih map aggregate)
-- bypass RLS and are unaffected.
DROP POLICY IF EXISTS "anon_read_kasus" ON kasus;
CREATE POLICY "anon_read_kasus" ON kasus FOR SELECT TO anon USING (verified IS TRUE);
