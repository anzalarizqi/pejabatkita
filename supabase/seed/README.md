# Seed Data

## 001_wilayah_provinsi.sql
Seeds all 38 provinces with BPS codes. Run after `001_schema.sql`.

## Kabupaten/Kota Data (~514 entries)

The full kab/kota list is too large to maintain manually. Import it from the official BPS source:

1. Download from BPS API: https://sig.bps.go.id/rest-bridging/getwilayah?level=kab&id_parent=<kode_provinsi>
2. Or use the BPS static CSV: https://www.bps.go.id/id/statistics-table/2/NDMxIzI=/luas-daerah-kabupaten-kota.html

A helper script to generate the seed SQL from the BPS API will be added in Phase 2 at `supabase/seed/generate_wilayah.py`.
