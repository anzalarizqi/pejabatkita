"""
Cleanup duplicate/stray jabatan rows that cause >100% coverage.

Problems fixed:
  1. Duplicate posisi rows per wilayah (e.g. "Bupati" + "BUPATI BATU BARA" same seat)
  2. Wrong-type posisi (e.g. "Walikota" in a Kabupaten)
  3. Ghost province entries (e.g. "Gubernur Papua Barat Daya" linked to Papua Barat wilayah)
  4. Non-jabatan posisi strings (e.g. "Ketua DPD Partai NasDem ...")
  5. Legitimately vacant placeholders (Wakil Walikota Jakarta Barat, Wakil Bupati Ciamis)

Run with --dry-run first.
"""

from __future__ import annotations
import argparse
import os
import re
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")
from supabase import create_client

# ---------------------------------------------------------------------------
# Posisi classification helpers
# ---------------------------------------------------------------------------

KEPALA_RE = re.compile(
    r"^(Gubernur|Bupati|Walikota|Wali Kota)\b",
    re.IGNORECASE,
)
WAKIL_RE = re.compile(
    r"^(Wakil Gubernur|Wakil Bupati|Wakil Walikota|Wakil Wali Kota)\b",
    re.IGNORECASE,
)
PLACEHOLDER_RE = re.compile(
    r"^(Bupati|Walikota|Wali Kota|Wakil Bupati|Wakil Walikota|Wakil Wali Kota|"
    r"Gubernur|Wakil Gubernur|Penjabat|Pj\.?)\s+\S",
    re.IGNORECASE,
)
LLM_ERR_RE = re.compile(r"^\[LLM Error\]", re.IGNORECASE)

CANONICAL_KEPALA = {
    "provinsi": "Gubernur",
    "kabupaten": "Bupati",
    "kota": "Walikota",
}
CANONICAL_WAKIL = {
    "provinsi": "Wakil Gubernur",
    "kabupaten": "Wakil Bupati",
    "kota": "Wakil Walikota",
}

# Kepala posisi allowed per wilayah level
KEPALA_FOR_LEVEL = {
    "provinsi": {"gubernur"},
    "kabupaten": {"bupati"},
    "kota": {"walikota", "wali kota"},
}
WAKIL_FOR_LEVEL = {
    "provinsi": {"wakil gubernur"},
    "kabupaten": {"wakil bupati"},
    "kota": {"wakil walikota", "wakil wali kota"},
}


def posisi_tier(posisi: str) -> str | None:
    """Return 'kepala', 'wakil', or None (not a valid jabatan posisi)."""
    p = posisi.strip().lower()
    if WAKIL_RE.match(posisi):
        return "wakil"
    if KEPALA_RE.match(posisi):
        return "kepala"
    return None


def is_placeholder(name: str | None) -> bool:
    if not name or not name.strip():
        return True
    return bool(LLM_ERR_RE.match(name)) or bool(PLACEHOLDER_RE.match(name))


def posisi_matches_level(posisi: str, level: str) -> bool:
    """True if the posisi is appropriate for the wilayah level."""
    p = posisi.strip().lower()
    tier = posisi_tier(posisi)
    if tier == "kepala":
        allowed = KEPALA_FOR_LEVEL.get(level, set())
        return any(p.startswith(a) for a in allowed)
    if tier == "wakil":
        allowed = WAKIL_FOR_LEVEL.get(level, set())
        return any(p.startswith(a) for a in allowed)
    return False


def score_jabatan(j: dict, name: str | None) -> int:
    """Higher = better candidate to keep. Real name + canonical posisi wins."""
    score = 0
    if not is_placeholder(name):
        score += 10
    # Prefer short canonical posisi strings
    posisi = j["posisi"].strip()
    if posisi in ("Gubernur", "Wakil Gubernur", "Bupati", "Wakil Bupati",
                  "Walikota", "Wakil Walikota", "Wali Kota", "Wakil Wali Kota"):
        score += 5
    elif len(posisi) < 20:
        score += 2
    return score


# ---------------------------------------------------------------------------
# Fetch helpers
# ---------------------------------------------------------------------------

def fetch_all(sb, table: str, columns: str, page_size: int = 1000) -> list[dict]:
    rows: list[dict] = []
    offset = 0
    while True:
        res = sb.table(table).select(columns).range(offset, offset + page_size - 1).execute()
        chunk = res.data or []
        rows.extend(chunk)
        if len(chunk) < page_size:
            break
        offset += page_size
    return rows


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main(dry_run: bool) -> None:
    sb = create_client(os.environ["NEXT_PUBLIC_SUPABASE_URL"],
                       os.environ["SUPABASE_SERVICE_ROLE_KEY"])

    print("Fetching data...")
    wilayah_rows = fetch_all(sb, "wilayah", "id,nama,level,parent_id,kode_bps")
    pejabat_rows = fetch_all(sb, "pejabat", "id,nama_lengkap")
    jabatan_rows = fetch_all(sb, "jabatan", "id,pejabat_id,wilayah_id,posisi,status")

    w_by_id = {w["id"]: w for w in wilayah_rows}
    p_by_id = {p["id"]: p["nama_lengkap"] for p in pejabat_rows}

    to_delete: list[dict] = []  # {id, reason}

    # ------------------------------------------------------------------
    # Pass 1: invalid posisi strings (not kepala or wakil at all)
    # e.g. "Ketua DPD Partai NasDem ..."
    # ------------------------------------------------------------------
    for j in jabatan_rows:
        tier = posisi_tier(j["posisi"])
        if tier is None:
            to_delete.append({"id": j["id"], "reason": f"invalid posisi: '{j['posisi']}'"})

    deleted_ids = {d["id"] for d in to_delete}

    # ------------------------------------------------------------------
    # Pass 2: wrong-type posisi for wilayah level
    # e.g. "Walikota" jabatan linked to a kabupaten wilayah
    # ------------------------------------------------------------------
    for j in jabatan_rows:
        if j["id"] in deleted_ids:
            continue
        w = w_by_id.get(j["wilayah_id"])
        if not w:
            continue
        if not posisi_matches_level(j["posisi"], w["level"]):
            name = p_by_id.get(j["pejabat_id"], "")
            to_delete.append({
                "id": j["id"],
                "reason": f"wrong posisi type '{j['posisi']}' for {w['level']} {w['nama']}",
            })
            deleted_ids.add(j["id"])

    # ------------------------------------------------------------------
    # Pass 3: ghost province entries
    # posisi string mentions a different province name than the linked wilayah
    # e.g. "Gubernur Papua Barat Daya" linked to Papua Barat wilayah
    # ------------------------------------------------------------------
    province_names = {w["nama"].lower() for w in wilayah_rows if w["level"] == "provinsi"}

    for j in jabatan_rows:
        if j["id"] in deleted_ids:
            continue
        w = w_by_id.get(j["wilayah_id"])
        if not w or w["level"] != "provinsi":
            continue
        posisi_lower = j["posisi"].lower()
        # Check if posisi mentions any province name other than the linked one
        linked_name = w["nama"].lower()
        for pname in province_names:
            if pname == linked_name:
                continue
            if pname in posisi_lower:
                to_delete.append({
                    "id": j["id"],
                    "reason": f"ghost entry: posisi '{j['posisi']}' mentions '{pname}' but linked to '{w['nama']}'",
                })
                deleted_ids.add(j["id"])
                break

    # ------------------------------------------------------------------
    # Pass 4: duplicate kepala/wakil per wilayah — keep best, delete rest
    # ------------------------------------------------------------------
    from collections import defaultdict
    by_wilayah_tier: dict[tuple, list[dict]] = defaultdict(list)

    for j in jabatan_rows:
        if j["id"] in deleted_ids:
            continue
        tier = posisi_tier(j["posisi"])
        if tier:
            by_wilayah_tier[(j["wilayah_id"], tier)].append(j)

    for (wilayah_id, tier), group in by_wilayah_tier.items():
        if len(group) <= 1:
            continue
        # Score each, keep highest
        scored = sorted(
            group,
            key=lambda j: score_jabatan(j, p_by_id.get(j["pejabat_id"])),
            reverse=True,
        )
        keep = scored[0]
        for loser in scored[1:]:
            w = w_by_id.get(wilayah_id, {})
            name = p_by_id.get(loser["pejabat_id"], "")
            to_delete.append({
                "id": loser["id"],
                "reason": (
                    f"duplicate {tier} in {w.get('nama','?')} "
                    f"(keeping '{keep['posisi']}' / '{p_by_id.get(keep['pejabat_id'],'')}', "
                    f"dropping '{loser['posisi']}' / '{name}')"
                ),
            })
            deleted_ids.add(loser["id"])

    # ------------------------------------------------------------------
    # Pass 5: legitimately vacant seats — placeholder names for known
    # empty positions
    # ------------------------------------------------------------------
    VACANT = [
        ("Jakarta Barat", "wakil"),
        ("Ciamis", "wakil"),
    ]

    for j in jabatan_rows:
        if j["id"] in deleted_ids:
            continue
        name = p_by_id.get(j["pejabat_id"], "")
        if not is_placeholder(name):
            continue
        w = w_by_id.get(j["wilayah_id"])
        if not w:
            continue
        tier = posisi_tier(j["posisi"])
        for (wname, wtier) in VACANT:
            if wname.lower() in w["nama"].lower() and tier == wtier:
                to_delete.append({
                    "id": j["id"],
                    "reason": f"legitimately vacant: {tier} in {w['nama']} (seat is empty per official sources)",
                })
                deleted_ids.add(j["id"])

    # ------------------------------------------------------------------
    # Report
    # ------------------------------------------------------------------
    print(f"\nTotal jabatan rows: {len(jabatan_rows)}")
    print(f"Rows to delete: {len(to_delete)}")
    print()

    for d in to_delete:
        j = next(x for x in jabatan_rows if x["id"] == d["id"])
        w = w_by_id.get(j["wilayah_id"], {})
        name = p_by_id.get(j["pejabat_id"], "")
        print(f"  DEL jabatan/{j['id'][:8]}  {w.get('nama','?'):30s}  '{j['posisi']:30s}'  name='{name}'")
        print(f"       reason: {d['reason']}")

    if dry_run:
        print("\n[DRY RUN] No changes made. Re-run without --dry-run to apply.")
        return

    # ------------------------------------------------------------------
    # Apply deletions
    # ------------------------------------------------------------------
    ids = [d["id"] for d in to_delete]
    batch = 50
    deleted = 0
    for i in range(0, len(ids), batch):
        chunk = ids[i:i + batch]
        sb.table("jabatan").delete().in_("id", chunk).execute()
        deleted += len(chunk)
        print(f"  Deleted {deleted}/{len(ids)} jabatan rows...")

    # Clean up orphan pejabat (no remaining jabatan)
    remaining_jab = fetch_all(sb, "jabatan", "pejabat_id")
    active_pejabat_ids = {j["pejabat_id"] for j in remaining_jab}
    all_pejabat_ids = {p["id"] for p in pejabat_rows}
    orphan_ids = list(all_pejabat_ids - active_pejabat_ids)
    if orphan_ids:
        print(f"\nCleaning up {len(orphan_ids)} orphan pejabat rows...")
        for i in range(0, len(orphan_ids), batch):
            chunk = orphan_ids[i:i + batch]
            sb.table("pejabat").delete().in_("id", chunk).execute()
        print(f"  Deleted {len(orphan_ids)} orphan pejabat.")

    print(f"\nDone. Deleted {len(ids)} jabatan rows.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Preview only, no DB changes")
    args = parser.parse_args()
    main(dry_run=args.dry_run)
