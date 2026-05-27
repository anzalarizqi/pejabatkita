#!/usr/bin/env python3
"""
Export all pejabat (name + jabatan + provinsi) to CSV for LLM corruption screening.
Usage: python scripts/export_pejabat_for_llm.py [--out pejabat_export.csv]
"""
import argparse
import csv
import os
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv

ROOT = Path(__file__).parent.parent
load_dotenv(ROOT / ".env")

SUPABASE_URL = os.environ.get("SUPABASE_URL") or os.environ["NEXT_PUBLIC_SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
HEADERS = {
    "apikey": SUPABASE_SERVICE_KEY,
    "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
}


def fetch_all(client: httpx.Client, table: str, select: str) -> list[dict]:
    rows, offset = [], 0
    while True:
        resp = client.get(
            f"{SUPABASE_URL}/rest/v1/{table}",
            params={"select": select, "limit": 1000, "offset": offset},
            headers={**HEADERS, "Range-Unit": "items", "Prefer": "count=none"},
        )
        resp.raise_for_status()
        batch = resp.json()
        rows.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
    return rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="scripts/pejabat_export.csv")
    args = parser.parse_args()

    with httpx.Client(timeout=60) as client:
        pejabat = fetch_all(client, "pejabat", "id,nama_lengkap,gelar_depan,gelar_belakang")
        jabatan = fetch_all(client, "jabatan", "pejabat_id,posisi,wilayah_id")
        wilayah = fetch_all(client, "wilayah", "id,nama,level,parent_id")

    wilayah_by_id = {w["id"]: w for w in wilayah}

    def province_name(wilayah_id: str | None) -> str:
        if not wilayah_id:
            return ""
        w = wilayah_by_id.get(wilayah_id)
        if not w:
            return ""
        if w["level"] == "provinsi":
            return w["nama"]
        if w["level"] == "nasional":
            return "Nasional"
        parent = wilayah_by_id.get(w.get("parent_id") or "")
        return parent["nama"] if parent else ""

    # Use first jabatan per pejabat
    first_jabatan: dict[str, dict] = {}
    for j in jabatan:
        pid = j["pejabat_id"]
        if pid not in first_jabatan:
            first_jabatan[pid] = j

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["pejabat_id", "nama_lengkap", "jabatan", "provinsi"])
        writer.writeheader()
        for p in pejabat:
            j = first_jabatan.get(p["id"], {})
            gelar_depan = (p.get("gelar_depan") or "").strip()
            nama = p["nama_lengkap"].strip()
            gelar_belakang = (p.get("gelar_belakang") or "").strip()
            full_name = " ".join(filter(None, [gelar_depan, nama, gelar_belakang]))
            writer.writerow({
                "pejabat_id": p["id"],
                "nama_lengkap": full_name,
                "jabatan": (j.get("posisi") or "").strip(),
                "provinsi": province_name(j.get("wilayah_id")),
            })

    total = sum(1 for _ in open(out_path, encoding="utf-8")) - 1  # subtract header
    print(f"Exported {total} pejabat to {out_path}")


if __name__ == "__main__":
    main()
