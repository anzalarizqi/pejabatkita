#!/usr/bin/env python3
"""
Scrape Prabowo cabinet from Wikipedia and upsert into Supabase.
Re-runnable: upserts by (nama_lengkap, posisi) pair.
Usage: python scripts/scrape_kabinet.py [--dry-run]
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


def fetch_wikipedia() -> list[dict]:
    """Fetch and parse the Kabinet Merah Putih Wikipedia page via Jina reader."""
    jina_url = f"https://r.jina.ai/{WIKIPEDIA_URL}"
    resp = httpx.get(jina_url, timeout=60, headers={"Accept": "application/json"})
    resp.raise_for_status()
    data = resp.json()
    content = data.get("data", {}).get("content", "")
    return parse_cabinet_text(content)


def _strip_links(s: str) -> str:
    """Remove markdown links, keeping display text. Also strip trailing disambiguation text."""
    result = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", s).strip()
    # Remove trailing disambiguation like: Sugiono "Sugiono (politikus)")
    result = re.sub(r'\s*"[^"]*"\)', "", result).strip()
    result = re.sub(r'\s*"[^"]*"$', "", result).strip()
    return result


def _parse_section(section: str, posisi_prefix: str) -> list[dict]:
    """
    Parse a minister/wakil-menteri section.
    Rows have exactly 2 cells: | [Name] | [Posisi] |
    Rows with 4+ cells are party group headers — skip them.
    """
    officials = []
    row_pattern = re.compile(r"^\|(.+)\|$", re.MULTILINE)
    for m in row_pattern.finditer(section):
        cells = [c.strip() for c in m.group(1).split("|")]
        # Skip header/separator rows and party-group rows (more than 2 non-empty cells)
        non_empty = [c for c in cells if c and c != "---"]
        if len(non_empty) != 2:
            continue
        nama_raw, posisi_raw = non_empty[0], non_empty[1]
        nama = _strip_links(nama_raw)
        posisi = _strip_links(posisi_raw)
        # Skip if nama looks like a header or is too short
        if not nama or len(nama) < 4:
            continue
        if re.search(r"^(Partai|Nama|Jabatan|---|Menteri|Wakil)", nama, re.I):
            continue
        # Skip if nama contains image markup
        if "![" in nama or nama.startswith("[!["):
            continue
        officials.append({"nama_lengkap": nama, "posisi": posisi, "partai": None})
    return officials


def parse_cabinet_text(text: str) -> list[dict]:
    """
    Extract (nama, posisi) pairs from Jina markdown of Wikipedia cabinet page.
    Finds the '| Partai | Menteri |' and '| Partai | Wakil Menteri |' tables,
    then parses 2-column rows as (nama, posisi).
    """
    officials = []

    # Find the two minister tables by their headers
    menteri_marker = "| Partai | Menteri |"
    wakil_marker = "| Partai | Wakil Menteri |"

    for marker, prefix in [(menteri_marker, "Menteri"), (wakil_marker, "Wakil Menteri")]:
        idx = text.find(marker)
        if idx == -1:
            continue
        # Extract section: from marker to next blank line followed by non-table content
        section_text = text[idx:]
        # Section ends when we hit two consecutive newlines not followed by a |
        end_match = re.search(r"\n\n(?!\|)", section_text)
        if end_match:
            section_text = section_text[: end_match.start()]
        officials.extend(_parse_section(section_text, prefix))

    # Also include Presiden and Wakil Presiden from the infobox
    presiden_match = re.search(
        r"\|\s*\[Presiden\][^\|]+\|\s*\[([^\]]+)\]\([^)]+\)", text
    )
    wapres_match = re.search(
        r"\|\s*\[Wakil Presiden\][^\|]+\|\s*\[([^\]]+)\]\([^)]+\)", text
    )
    if presiden_match:
        officials.insert(0, {"nama_lengkap": presiden_match.group(1), "posisi": "Presiden", "partai": "Gerindra"})
    if wapres_match:
        officials.insert(1, {"nama_lengkap": wapres_match.group(1), "posisi": "Wakil Presiden", "partai": None})

    return officials


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
    args = parser.parse_args()

    print("Fetching Wikipedia cabinet page via Jina...")
    officials = fetch_wikipedia()
    print(f"  Parsed {len(officials)} officials")

    if not officials:
        print("ERROR: No officials parsed. Check Wikipedia page structure.", file=sys.stderr)
        sys.exit(1)

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
