-- Snapshot of the party a pejabat belonged to AT THE TIME of a corruption case
-- (party-at-time-of-case attribution). Nullable: untagged cases fall into the
-- "belum dikaitkan" bucket in the read layer, never silently dropped.
ALTER TABLE kasus ADD COLUMN IF NOT EXISTS partai varchar;
