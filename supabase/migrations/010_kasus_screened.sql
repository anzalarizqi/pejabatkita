-- supabase/migrations/010_kasus_screened.sql
-- Track screening history for every pejabat (including "bersih" results)
-- so resume logic can skip recently-screened officials regardless of outcome.

CREATE TABLE IF NOT EXISTS kasus_screened (
    pejabat_id        UUID PRIMARY KEY REFERENCES pejabat(id) ON DELETE CASCADE,
    last_screened_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_result       TEXT NOT NULL CHECK (last_result IN ('found','bersih','error')),
    last_keyakinan    TEXT
);

CREATE INDEX IF NOT EXISTS idx_kasus_screened_at ON kasus_screened(last_screened_at);

-- RLS: service-role only (no public read needed)
ALTER TABLE kasus_screened ENABLE ROW LEVEL SECURITY;
