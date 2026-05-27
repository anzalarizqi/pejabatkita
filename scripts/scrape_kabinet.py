#!/usr/bin/env python3
"""
Scrape Prabowo cabinet from Wikipedia and upsert into Supabase.
Re-runnable: upserts by (nama_lengkap, posisi) pair.
Usage: python scripts/scrape_kabinet.py [--dry-run] [--debug]

Sources:
  - Wikipedia Kabinet Merah Putih (party-grouped tables)
  - Hardcoded supplement for officials Wikipedia omits (confirmed from setkab.go.id)
  - Reflects post-April 2026 reshuffle state
"""
import argparse
import os
import re
import sys

import httpx
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))

SUPABASE_URL = os.environ.get("SUPABASE_URL") or os.environ["NEXT_PUBLIC_SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
WIKIPEDIA_URL = "https://id.wikipedia.org/wiki/Kabinet_Merah_Putih"

HEADERS = {"apikey": SUPABASE_SERVICE_KEY, "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}"}

# Officials confirmed from setkab.go.id that Wikipedia's party tables omit.
# These are added AFTER the Wikipedia scrape and deduplicated by (nama_lengkap, posisi).
# Last verified: May 2026 (post-April 2026 reshuffle).
SUPPLEMENT = [
    # Presiden & Wapres
    {"nama_lengkap": "Prabowo Subianto", "posisi": "Presiden", "partai": "Gerindra"},
    {"nama_lengkap": "Gibran Rakabuming Raka", "posisi": "Wakil Presiden", "partai": None},
    # Menko absent from Wikipedia party tables
    {"nama_lengkap": "Pratikno", "posisi": "Menteri Koordinator Bidang Pembangunan Manusia dan Kebudayaan", "partai": None},
    # Menteri absent from Wikipedia party tables
    {"nama_lengkap": "Sjafrie Sjamsoeddin", "posisi": "Menteri Pertahanan", "partai": None},
    {"nama_lengkap": "Muhammad Tito Karnavian", "posisi": "Menteri Dalam Negeri", "partai": None},
    {"nama_lengkap": "Natalius Pigai", "posisi": "Menteri Hak Asasi Manusia", "partai": None},
    {"nama_lengkap": "Agus Andrianto", "posisi": "Menteri Imigrasi dan Pemasyarakatan", "partai": None},
    {"nama_lengkap": "Purbaya Yudhi Sadewa", "posisi": "Menteri Keuangan", "partai": None},
    {"nama_lengkap": "Rosan Perkasa Roeslani", "posisi": "Menteri Investasi dan Hilirisasi", "partai": None},
    {"nama_lengkap": "Abdul Mu'ti", "posisi": "Menteri Pendidikan Dasar dan Menengah", "partai": None},
    {"nama_lengkap": "Brian Yuliarto", "posisi": "Menteri Pendidikan Tinggi, Sains, dan Teknologi", "partai": None},
    {"nama_lengkap": "Budi Gunadi Sadikin", "posisi": "Menteri Kesehatan", "partai": None},
    {"nama_lengkap": "Yassierli", "posisi": "Menteri Ketenagakerjaan", "partai": None},
    {"nama_lengkap": "Amran Sulaiman", "posisi": "Menteri Pertanian", "partai": None},
    {"nama_lengkap": "Mohammad Jumhur Hidayat", "posisi": "Menteri Lingkungan Hidup", "partai": None},
    {"nama_lengkap": "Widiyanti Putri", "posisi": "Menteri Pariwisata", "partai": None},
    {"nama_lengkap": "Arifatul Choiri Fauzi", "posisi": "Menteri Pemberdayaan Perempuan dan Perlindungan Anak", "partai": None},
    {"nama_lengkap": "Erick Thohir", "posisi": "Menteri Pemuda dan Olahraga", "partai": None},
    {"nama_lengkap": "Rini Widyantini", "posisi": "Menteri Pendayagunaan Aparatur Negara dan Reformasi Birokrasi", "partai": None},
    # Pejabat Setingkat Menteri
    {"nama_lengkap": "Teddy Indra Wijaya", "posisi": "Sekretaris Kabinet", "partai": None},
    {"nama_lengkap": "Dadan Hindayana", "posisi": "Kepala Badan Gizi Nasional", "partai": None},
    # Wakil Menteri — sourced from Kompas complete list (post-Sept 2025 reshuffle)
    # plus Wikipedia tables (already in DB) and Wikipedia supplement
    {"nama_lengkap": "Otto Hasibuan", "posisi": "Wakil Menteri Koordinator Bidang Hukum, HAM, Imigrasi, dan Pemasyarakatan", "partai": None},
    {"nama_lengkap": "Bambang Eko Suharyanto", "posisi": "Wakil Menteri Sekretaris Negara", "partai": None},
    {"nama_lengkap": "Juri Ardiantoro", "posisi": "Wakil Menteri Sekretaris Negara", "partai": None},
    {"nama_lengkap": "Ribka Haluk", "posisi": "Wakil Menteri Dalam Negeri", "partai": None},
    {"nama_lengkap": "Akhmad Wiyagus", "posisi": "Wakil Menteri Dalam Negeri", "partai": None},
    {"nama_lengkap": "Arrmanatha Christiawan Nasir", "posisi": "Wakil Menteri Luar Negeri", "partai": None},
    {"nama_lengkap": "Arif Havas Oegroseno", "posisi": "Wakil Menteri Luar Negeri", "partai": None},
    {"nama_lengkap": "Doni Hermawan", "posisi": "Wakil Menteri Pertahanan", "partai": None},
    {"nama_lengkap": "Edward Omar Sharif Hiariej", "posisi": "Wakil Menteri Hukum", "partai": None},
    {"nama_lengkap": "Mugiyanto", "posisi": "Wakil Menteri Hak Asasi Manusia", "partai": None},
    {"nama_lengkap": "Silmy Karim", "posisi": "Wakil Menteri Imigrasi dan Pemasyarakatan", "partai": None},
    {"nama_lengkap": "Thomas Djiwandono", "posisi": "Wakil Menteri Keuangan", "partai": None},
    {"nama_lengkap": "Suahasil Nazara", "posisi": "Wakil Menteri Keuangan", "partai": None},
    {"nama_lengkap": "Anggito Abimanyu", "posisi": "Wakil Menteri Keuangan", "partai": None},
    {"nama_lengkap": "Fajar Riza Ul Haq", "posisi": "Wakil Menteri Pendidikan Dasar dan Menengah", "partai": None},
    {"nama_lengkap": "Atip Latipulhayat", "posisi": "Wakil Menteri Pendidikan Dasar dan Menengah", "partai": None},
    {"nama_lengkap": "Fauzan", "posisi": "Wakil Menteri Pendidikan Tinggi, Sains, dan Teknologi", "partai": None},
    {"nama_lengkap": "Stella Christie", "posisi": "Wakil Menteri Pendidikan Tinggi, Sains, dan Teknologi", "partai": None},
    {"nama_lengkap": "Dante Saksono Harbuwono", "posisi": "Wakil Menteri Kesehatan", "partai": None},
    {"nama_lengkap": "Dzulfikar Ahmad Tawalla", "posisi": "Wakil Menteri Pelindungan Pekerja Migran Indonesia", "partai": None},
    {"nama_lengkap": "Yuliot", "posisi": "Wakil Menteri Energi dan Sumber Daya Mineral", "partai": None},
    {"nama_lengkap": "Diana Kusumastuti", "posisi": "Wakil Menteri Pekerjaan Umum", "partai": None},
    {"nama_lengkap": "Suntana", "posisi": "Wakil Menteri Perhubungan", "partai": None},
    {"nama_lengkap": "Nezar Patria", "posisi": "Wakil Menteri Komunikasi dan Digital", "partai": None},
    {"nama_lengkap": "Didit Herdiawan", "posisi": "Wakil Menteri Kelautan dan Perikanan", "partai": None},
    {"nama_lengkap": "Febrian Alphyanto Ruddyard", "posisi": "Wakil Menteri Perencanaan Pembangunan Nasional", "partai": None},
    {"nama_lengkap": "Purwadi Arianto", "posisi": "Wakil Menteri Pendayagunaan Aparatur Negara dan Reformasi Birokrasi", "partai": None},
    {"nama_lengkap": "Kartiko Wirjoatmodjo", "posisi": "Wakil Menteri Badan Usaha Milik Negara", "partai": None},
    {"nama_lengkap": "Aminuddin Ma'ruf", "posisi": "Wakil Menteri Badan Usaha Milik Negara", "partai": None},
    {"nama_lengkap": "Dony Oskaria", "posisi": "Wakil Menteri Badan Usaha Milik Negara", "partai": None},
    {"nama_lengkap": "Todotua Pasaribu", "posisi": "Wakil Menteri Investasi dan Hilirisasi", "partai": None},
    {"nama_lengkap": "Ni Luh Enik Ernawati", "posisi": "Wakil Menteri Pariwisata", "partai": None},
    {"nama_lengkap": "Irene Umar", "posisi": "Wakil Menteri Ekonomi Kreatif", "partai": None},
    {"nama_lengkap": "Dahnil Anzar Simanjuntak", "posisi": "Wakil Menteri Haji dan Umrah", "partai": None},
]


def fetch_wikipedia() -> list[dict]:
    """Fetch and parse the Kabinet Merah Putih Wikipedia page via Jina reader."""
    jina_url = f"https://r.jina.ai/{WIKIPEDIA_URL}"
    resp = httpx.get(jina_url, timeout=60, headers={"Accept": "application/json"})
    resp.raise_for_status()
    data = resp.json()
    content = data.get("data", {}).get("content", "")
    return parse_cabinet_text(content)


def _strip_links(s: str) -> str:
    """Remove markdown links and image markup, keeping display text."""
    result = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", s).strip()
    result = re.sub(r'!\[[^\]]*\]\([^)]+\)', "", result).strip()
    result = re.sub(r'\s*"[^"]*"\)', "", result).strip()
    result = re.sub(r'\s*"[^"]*"$', "", result).strip()
    return result


def _extract_section(text: str, marker: str) -> str:
    """
    Extract section from marker until the next markdown heading (## or ###),
    allowing blank lines between party groups inside the section.
    """
    idx = text.find(marker)
    if idx == -1:
        return ""
    after = text[idx + len(marker):]
    next_heading = re.search(r'\n#{1,3} ', after)
    if next_heading:
        return text[idx: idx + len(marker) + next_heading.start()]
    return text[idx:]


def _parse_section(section: str) -> list[dict]:
    """
    Parse a minister/wakil-menteri section.

    Wikipedia uses a 3-column party-grouped table:
      - First row per party: | (empty) | Party | Name | Posisi |   → 3 non-empty cells
      - Subsequent rows:     | Name | Posisi |                     → 2 non-empty cells
    """
    officials = []
    row_pattern = re.compile(r"^\|(.+)\|$", re.MULTILINE)
    for m in row_pattern.finditer(section):
        cells = [c.strip() for c in m.group(1).split("|")]
        non_empty = [c for c in cells if c and c != "---"]

        if len(non_empty) == 2:
            nama_raw, posisi_raw = non_empty[0], non_empty[1]
        elif len(non_empty) == 3:
            # Party group first-member row: party | name | posisi
            _, nama_raw, posisi_raw = non_empty
        else:
            continue

        nama = _strip_links(nama_raw)
        posisi = _strip_links(posisi_raw)

        if not nama or len(nama) < 4:
            continue
        if re.search(r"^(Partai|Nama|Jabatan|---|Menteri|Wakil|Setingkat|No\.)", nama, re.I):
            continue
        if "![" in nama or nama.startswith("[![") or "**" in nama:
            continue
        if not posisi or len(posisi) < 4:
            continue

        # Fix known Wikipedia typos
        posisi = posisi.replace("Ketenangakerjaan", "Ketenagakerjaan")

        officials.append({"nama_lengkap": nama, "posisi": posisi, "partai": None})
    return officials


def parse_cabinet_text(text: str) -> list[dict]:
    """
    Extract (nama, posisi) pairs from Jina markdown of Wikipedia cabinet page.
    Handles the party-grouped 3-column Wikipedia table format.
    """
    officials = []

    for marker in ["| Partai | Menteri |", "| Partai | Wakil Menteri |"]:
        section_text = _extract_section(text, marker)
        if section_text:
            officials.extend(_parse_section(section_text))

    return officials


def merge_with_supplement(wiki_officials: list[dict]) -> list[dict]:
    """
    Merge Wikipedia officials with the hardcoded supplement list.
    Deduplicates by nama_lengkap (case-insensitive).
    Supplement entries are inserted at the front (Presiden, Wapres first).
    """
    wiki_names = {o["nama_lengkap"].lower() for o in wiki_officials}
    combined = list(SUPPLEMENT)  # supplement first (Presiden/Wapres at top)
    for o in wiki_officials:
        if o["nama_lengkap"].lower() not in {s["nama_lengkap"].lower() for s in SUPPLEMENT}:
            combined.append(o)

    # Deduplicate by nama_lengkap keeping first occurrence
    seen = set()
    unique = []
    for o in combined:
        key = o["nama_lengkap"].lower()
        if key not in seen:
            seen.add(key)
            unique.append(o)
    return unique


def get_nasional_wilayah_id(client: httpx.Client) -> str:
    resp = client.get(
        f"{SUPABASE_URL}/rest/v1/wilayah",
        params={"level": "eq.nasional", "select": "id"},
        headers=HEADERS,
    )
    resp.raise_for_status()
    rows = resp.json()
    if not rows:
        raise RuntimeError("Nasional wilayah not found. Run migration 007 first.")
    return rows[0]["id"]


def get_existing_pusat(client: httpx.Client) -> dict[str, str]:
    """Returns {nama_lengkap: pejabat_id} for all existing pusat pejabat."""
    resp = client.get(
        f"{SUPABASE_URL}/rest/v1/pejabat",
        params={"level": "eq.pusat", "select": "id,nama_lengkap"},
        headers=HEADERS,
    )
    resp.raise_for_status()
    return {row["nama_lengkap"]: row["id"] for row in resp.json()}


def upsert_pejabat(client: httpx.Client, nama: str) -> str:
    """Insert pejabat if not exists, return id."""
    resp = client.post(
        f"{SUPABASE_URL}/rest/v1/pejabat",
        headers={**HEADERS, "Content-Type": "application/json", "Prefer": "return=representation"},
        json={"nama_lengkap": nama, "level": "pusat", "biodata": {}, "pendidikan": [], "metadata": {}},
    )
    if resp.status_code == 409:
        get_resp = client.get(
            f"{SUPABASE_URL}/rest/v1/pejabat",
            params={"nama_lengkap": f"eq.{nama}", "level": "eq.pusat", "select": "id"},
            headers=HEADERS,
        )
        return get_resp.json()[0]["id"]
    resp.raise_for_status()
    return resp.json()[0]["id"]


def upsert_jabatan(client: httpx.Client, pejabat_id: str, posisi: str, partai: str | None, wilayah_id: str):
    resp = client.post(
        f"{SUPABASE_URL}/rest/v1/jabatan",
        headers={**HEADERS, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates"},
        json={
            "pejabat_id": pejabat_id,
            "wilayah_id": wilayah_id,
            "posisi": posisi,
            "partai": partai,
            "status": "aktif",
        },
    )
    if resp.status_code not in (200, 201):
        print(f"  WARN: jabatan upsert {resp.status_code}: {resp.text[:120]}", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--debug", action="store_true", help="Print parsed list without DB ops")
    args = parser.parse_args()

    print("Fetching Wikipedia cabinet page via Jina...")
    wiki_officials = fetch_wikipedia()
    print(f"  Wikipedia parsed: {len(wiki_officials)} officials")

    officials = merge_with_supplement(wiki_officials)
    print(f"  After supplement merge: {len(officials)} officials total")

    if args.debug:
        for o in officials:
            print(f"  {o['nama_lengkap']} — {o['posisi']}")
        return

    with httpx.Client(timeout=30) as client:
        existing = get_existing_pusat(client)
        wilayah_id = get_nasional_wilayah_id(client)
        print(f"  Existing pusat pejabat: {len(existing)}")
        print(f"  Nasional wilayah id: {wilayah_id}")

        added, updated = 0, 0
        for off in officials:
            nama = off["nama_lengkap"]
            posisi = off["posisi"]
            partai = off["partai"]

            if args.dry_run:
                status = "UPDATE" if nama in existing else "NEW"
                print(f"  [DRY-RUN] {status}: {nama} — {posisi}")
                continue

            if nama in existing:
                pejabat_id = existing[nama]
                upsert_jabatan(client, pejabat_id, posisi, partai, wilayah_id)
                updated += 1
            else:
                pejabat_id = upsert_pejabat(client, nama)
                upsert_jabatan(client, pejabat_id, posisi, partai, wilayah_id)
                added += 1

        if not args.dry_run:
            scraped_names = {o["nama_lengkap"] for o in officials}
            removed = [n for n in existing if n not in scraped_names]
            if removed:
                print(f"\nRemovals detected (not auto-deleted — review manually):")
                for n in removed:
                    print(f"  - {n}")
            print(f"\nDone: {added} added, {updated} updated")


if __name__ == "__main__":
    main()
