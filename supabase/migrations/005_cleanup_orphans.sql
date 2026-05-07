-- Cleanup: remove orphan pejabat (no jabatan link).
-- Idempotent — safe to re-run after any import.
-- Note: [LLM Error]-prefixed names with valid jabatan are intentionally kept;
-- the web layer filters placeholders from public views, and these rows preserve
-- the "seat exists" signal for future re-scrapes.

DELETE FROM pejabat
WHERE id NOT IN (SELECT DISTINCT pejabat_id FROM jabatan);
