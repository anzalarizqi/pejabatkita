-- Enable RLS and add public read access for kasus table
ALTER TABLE kasus ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_kasus" ON kasus FOR SELECT TO anon USING (true);
