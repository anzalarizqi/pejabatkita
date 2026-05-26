-- supabase/migrations/007_pusat_korupsi_hotspot.sql

-- 1. pejabat.level
ALTER TABLE pejabat ADD COLUMN IF NOT EXISTS level VARCHAR NOT NULL DEFAULT 'daerah';
CREATE INDEX IF NOT EXISTS idx_pejabat_level ON pejabat(level);

-- 2. Seed the national wilayah (safe to run multiple times)
INSERT INTO wilayah (kode_bps, nama, level, parent_id)
VALUES ('00', 'Indonesia', 'nasional', NULL)
ON CONFLICT (kode_bps) DO NOTHING;

-- 3. kasus table
CREATE TABLE IF NOT EXISTS kasus (
    kasus_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pejabat_id  UUID NOT NULL REFERENCES pejabat(id) ON DELETE CASCADE,
    jenis       TEXT,
    lembaga     TEXT,
    status      TEXT NOT NULL CHECK (status IN ('tersangka','terdakwa','terpidana')),
    tahun       INT,
    ringkasan   TEXT,
    url_sumber  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kasus_pejabat_id ON kasus(pejabat_id);

-- 4. hotspot_events table
CREATE TABLE IF NOT EXISTS hotspot_events (
    event_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    judul        TEXT NOT NULL,
    ringkasan    TEXT,
    kategori     TEXT,
    lokasi_nama  TEXT,
    wilayah_id   UUID REFERENCES wilayah(id),
    pejabat_id   UUID REFERENCES pejabat(id),
    url_sumber   TEXT,
    sumber_nama  TEXT,
    crawled_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_manual    BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_hotspot_wilayah_id ON hotspot_events(wilayah_id);
CREATE INDEX IF NOT EXISTS idx_hotspot_crawled_at ON hotspot_events(crawled_at);

-- 5. settings table
CREATE TABLE IF NOT EXISTS settings (
    key    TEXT PRIMARY KEY,
    value  TEXT
);
INSERT INTO settings (key, value) VALUES
    ('llm_provider', 'zhipu'),
    ('llm_model', 'glm-4.5-air'),
    ('hotspot_keywords', '[]')
ON CONFLICT (key) DO NOTHING;
