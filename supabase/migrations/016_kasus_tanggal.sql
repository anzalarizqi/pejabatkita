-- supabase/migrations/016_kasus_tanggal.sql
-- Precise case date (penetapan tersangka / OTT). Nullable: older cases may only
-- have a year. Enables the Prabowo-era filter (>= 2024-10-20) for Keranjang Koruptor.
ALTER TABLE kasus ADD COLUMN IF NOT EXISTS tanggal_kasus DATE;
CREATE INDEX IF NOT EXISTS idx_kasus_tanggal ON kasus(tanggal_kasus);
