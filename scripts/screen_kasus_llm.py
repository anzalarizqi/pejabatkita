#!/usr/bin/env python3
"""
Screen pejabat CSV for corruption records using the configured LLM.
Input:  scripts/pejabat_export.csv  (from export_pejabat_for_llm.py)
Output: scripts/kasus_screened.csv  (Y/maybe rows only, ready for human review)

Usage:
  python scripts/screen_kasus_llm.py [--input pejabat_export.csv] [--out kasus_screened.csv]
  python scripts/screen_kasus_llm.py --provinsi "Aceh"   # single province
  python scripts/screen_kasus_llm.py --resume             # skip provinces already in output
"""
import argparse
import csv
import io
import json
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from scraper.pipeline.llm import chat

CHUNK_SIZE = 50  # rows per LLM call — keep output within 2048 token limit

SYSTEM_PROMPT = """Anda adalah peneliti antikorupsi Indonesia. Tugas Anda: skrining nama pejabat publik Indonesia apakah memiliki rekam jejak kasus korupsi (setidaknya berstatus tersangka dari KPK, Kejagung, Kejati, atau Pengadilan Tipikor).

Untuk setiap baris CSV yang diberikan (format: pejabat_id,nama_lengkap,jabatan,provinsi), kembalikan JSON array. Setiap elemen:
{
  "pejabat_id": "<uuid>",
  "has_record": "Y" | "N" | "maybe",
  "jenis": "<korupsi|gratifikasi|suap|pencucian_uang|lainnya|null>",
  "lembaga": "<KPK|Kejagung|Kejati|Pengadilan Tipikor|null>",
  "status": "<tersangka|terdakwa|terpidana|null>",
  "tahun": <int|null>,
  "ringkasan": "<1-2 kalimat ringkasan kasus|null>",
  "url_sumber": "<URL sumber terpercaya|null>"
}

Aturan:
- has_record=Y: ada kasus terdokumentasi di KPK.go.id, Kejagung, atau media besar (Tempo/Kompas/Detik) dengan kata kunci tipikor/tersangka/KPK.
- has_record=maybe: ada indikasi tapi sumber tidak cukup kuat.
- has_record=N: tidak ditemukan rekam jejak.
- Kembalikan HANYA JSON array, tanpa teks lain."""


def _parse_llm_json(text: str) -> list[dict]:
    text = text.strip()
    # Strip markdown code fences
    text = re.sub(r"^```[a-z]*\n?", "", text)
    text = re.sub(r"\n?```$", "", text)
    # Find first [ ... ]
    m = re.search(r"\[.*\]", text, re.DOTALL)
    if m:
        return json.loads(m.group(0))
    raise ValueError(f"No JSON array found in LLM response: {text[:200]}")


def screen_chunk(rows: list[dict]) -> list[dict]:
    buf = io.StringIO()
    _w = csv.writer(buf)
    _w.writerow(["pejabat_id", "nama_lengkap", "jabatan", "provinsi"])
    for r in rows:
        _w.writerow([r["pejabat_id"], r["nama_lengkap"], r["jabatan"], r["provinsi"]])
    csv_text = buf.getvalue()

    messages = [{"role": "user", "content": csv_text}]
    response = chat(messages, system_prompt=SYSTEM_PROMPT)
    results = _parse_llm_json(response)

    # Filter to Y/maybe only
    return [r for r in results if r.get("has_record") in ("Y", "maybe")]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default="scripts/pejabat_export.csv")
    parser.add_argument("--out", default="scripts/kasus_screened.csv")
    parser.add_argument("--provinsi", help="Filter to a single province")
    parser.add_argument("--resume", action="store_true", help="Skip provinces already in output file")
    args = parser.parse_args()

    with open(args.input, newline="", encoding="utf-8") as f:
        all_rows = list(csv.DictReader(f))

    if args.provinsi:
        all_rows = [r for r in all_rows if r["provinsi"] == args.provinsi]

    # Group by province
    by_province: dict[str, list[dict]] = {}
    for r in all_rows:
        prov = r["provinsi"] or "Nasional"
        by_province.setdefault(prov, []).append(r)

    # Resume: load already-processed provinces from output
    done_provinces: set[str] = set()
    out_path = Path(args.out)
    if args.resume and out_path.exists():
        with open(out_path, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                done_provinces.add(row.get("provinsi", ""))

    fieldnames = ["pejabat_id", "nama_lengkap", "jabatan", "provinsi",
                  "has_record", "jenis", "lembaga", "status", "tahun", "ringkasan", "url_sumber"]

    mode = "a" if args.resume and out_path.exists() else "w"
    with open(out_path, mode, newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        if mode == "w":
            writer.writeheader()

        for prov, rows in sorted(by_province.items()):
            if prov in done_provinces:
                print(f"  SKIP (done): {prov}")
                continue

            print(f"  Screening {prov} ({len(rows)} pejabat)...", end=" ", flush=True)
            # Process in chunks
            found_total = 0
            for i in range(0, len(rows), CHUNK_SIZE):
                chunk = rows[i:i + CHUNK_SIZE]
                try:
                    results = screen_chunk(chunk)
                    # Enrich with name/jabatan/provinsi from input
                    input_map = {r["pejabat_id"]: r for r in chunk}
                    for res in results:
                        pid = res.get("pejabat_id", "")
                        src = input_map.get(pid, {})
                        if not src:
                            print(f"    WARN: LLM returned unknown pejabat_id '{pid}' — enrichment skipped", file=sys.stderr)
                        res["nama_lengkap"] = src.get("nama_lengkap", "")
                        res["jabatan"] = src.get("jabatan", "")
                        res["provinsi"] = prov
                    writer.writerows(results)
                    f.flush()
                    found_total += len(results)
                except Exception as e:
                    print(f"\n    ERROR chunk {i}-{i+CHUNK_SIZE}: {e}", file=sys.stderr)
                time.sleep(1)  # rate limit
            print(f"{found_total} flagged")

    print(f"\nDone. Results written to {out_path}")
    print("Next: review the CSV, delete rows you're not confident about, then run import_kasus.py")


if __name__ == "__main__":
    main()
