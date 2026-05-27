-- Add verification columns to kasus table
-- verified: null=pending, true=confirmed, false=rejected
ALTER TABLE kasus ADD COLUMN IF NOT EXISTS verified      BOOLEAN;
ALTER TABLE kasus ADD COLUMN IF NOT EXISTS verified_at   TIMESTAMPTZ;
ALTER TABLE kasus ADD COLUMN IF NOT EXISTS verified_note TEXT;
