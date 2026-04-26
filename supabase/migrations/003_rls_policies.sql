-- Enable RLS on all tables
ALTER TABLE wilayah ENABLE ROW LEVEL SECURITY;
ALTER TABLE pejabat ENABLE ROW LEVEL SECURITY;
ALTER TABLE jabatan ENABLE ROW LEVEL SECURITY;
ALTER TABLE scrape_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE flags ENABLE ROW LEVEL SECURITY;

-- Public read access for the 4 tables used by public-facing pages
CREATE POLICY "anon_read_wilayah"     ON wilayah     FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_pejabat"     ON pejabat     FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_jabatan"     ON jabatan     FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_scrape_runs" ON scrape_runs FOR SELECT TO anon USING (true);

-- flags: no anon access — all flag operations use service role key in API routes
-- service role bypasses RLS entirely, so no additional policies needed for admin writes
