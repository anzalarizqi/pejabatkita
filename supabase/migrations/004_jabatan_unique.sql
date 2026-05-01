-- Add unique constraint to jabatan so importer's upsert(on_conflict='pejabat_id,wilayah_id,posisi') works.
-- Without this, the jabatan upsert fails with PG error 42P10 and pejabat rows get orphaned.

ALTER TABLE jabatan
    ADD CONSTRAINT jabatan_pejabat_wilayah_posisi_uniq
    UNIQUE (pejabat_id, wilayah_id, posisi);
