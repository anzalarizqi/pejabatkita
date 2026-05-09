"""
Phase 9A v2 — Batch verification using Z.AI + Python search pipeline.

Flow:
  1. Pull placeholder pejabat from Supabase (filtered by province / low coverage)
  2. For each target: run 2 targeted searches via existing websearch.py (DDG/Jina)
  3. Batch 5 targets + their snippets into one Z.AI call with a "verify this list" prompt
  4. Parse structured JSON response → update DB

Key differences from agent.py:
  - Batch: 5 rows per LLM call instead of 1
  - Framing: verification ("is this name correct?") not generation
  - No citation verification step — instead we store source URLs from search results
    and flag confidence based on snippet quality

Usage:
    python scripts/run_zai_batch_verify.py --provinsi "Sulawesi Tenggara" --limit 10
    python scripts/run_zai_batch_verify.py --provinsi "Sulawesi Tenggara" --limit 10 --dry-run
    python scripts/run_zai_batch_verify.py --low-coverage --limit 50
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import re
import sys
import time
from pathlib import Path
from urllib.parse import quote

import httpx
import yaml
from dotenv import load_dotenv

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / ".env")

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("zai_verify")
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)

PLACEHOLDER_RE = re.compile(
    r"^(Bupati|Walikota|Wali Kota|Wakil Bupati|Wakil Walikota|Wakil Wali Kota|"
    r"Gubernur|Wakil Gubernur|Penjabat|Pj\.?)\s+\S",
    re.IGNORECASE,
)
LLM_ERR_RE = re.compile(r"^\[LLM Error\]", re.IGNORECASE)

BATCH_SIZE = 5
SNIPPETS_PER_TARGET = 3   # search result snippets fed to LLM per row
CHARS_PER_SNIPPET = 800


def is_placeholder(name: str | None) -> bool:
    if not name or not name.strip():
        return True
    return bool(LLM_ERR_RE.match(name)) or bool(PLACEHOLDER_RE.match(name))


# ─── Supabase ─────────────────────────────────────────────────────────────────

def get_supabase():
    from supabase import create_client
    return create_client(
        os.environ["NEXT_PUBLIC_SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )


def fetch_placeholder_targets(supabase, provinsi: str | None, low_coverage: bool, limit: int) -> list[dict]:
    """
    Returns list of dicts: {pejabat_id, nama_lengkap, posisi, wilayah_nama, provinsi_nama, jabatan_id}
    """
    # Get all pejabat with placeholder names + their jabatan
    q = (
        supabase.table("pejabat")
        .select("id, nama_lengkap, jabatan(id, posisi, wilayah:wilayah_id(id, nama, kode_bps, level))")
        .limit(5000)
        .execute()
    )

    targets: list[dict] = []
    for p in (q.data or []):
        if not is_placeholder(p.get("nama_lengkap")):
            continue
        for j in (p.get("jabatan") or []):
            w = j.get("wilayah") or {}
            kode = w.get("kode_bps", "")
            provinsi_kode = kode[:2] if kode else ""

            # Map provinsi_kode to name (we need this for filtering)
            targets.append({
                "pejabat_id": p["id"],
                "nama_lengkap": p["nama_lengkap"],
                "posisi": j.get("posisi", ""),
                "wilayah_id": w.get("id", ""),
                "wilayah_nama": w.get("nama", ""),
                "wilayah_level": w.get("level", ""),
                "kode_bps": kode,
                "provinsi_kode": provinsi_kode,
                "jabatan_id": j["id"],
            })

    # Attach province names via a wilayah lookup
    prov_res = supabase.table("wilayah").select("kode_bps, nama").eq("level", "provinsi").execute()
    prov_map: dict[str, str] = {w["kode_bps"]: w["nama"] for w in (prov_res.data or [])}
    for t in targets:
        t["provinsi_nama"] = prov_map.get(t["provinsi_kode"], t["provinsi_kode"])

    # Filter
    if provinsi:
        prov_lower = provinsi.lower()
        targets = [t for t in targets if prov_lower in t["provinsi_nama"].lower()]

    if low_coverage:
        # Only kepala daerah roles (easier to verify online than wakil)
        targets = [t for t in targets if not re.search(r"wakil", t["posisi"], re.IGNORECASE)]

    # Prioritise kepala daerah over wakil within results
    targets.sort(key=lambda t: (
        0 if not re.search(r"wakil", t["posisi"], re.IGNORECASE) else 1,
        t["provinsi_nama"],
    ))

    return targets[:limit]


# ─── Search ───────────────────────────────────────────────────────────────────

async def _jina_fetch(url: str, timeout: float = 20.0) -> str:
    jina_url = f"https://r.jina.ai/{url}"
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.get(jina_url, headers={"Accept": "text/plain"})
            if r.status_code == 200:
                return r.text[:3000]
    except Exception as e:
        logger.debug("Jina fetch failed for %s: %s", url, e)
    return ""


async def search_target(posisi: str, wilayah: str) -> list[dict]:
    """Run 2 DDG queries via Jina, return list of {url, snippet}."""
    queries = [
        f'{posisi} "{wilayah}" 2024 2025 nama',
        f'pilkada 2024 {wilayah} {posisi} terpilih dilantik',
    ]
    results: list[dict] = []
    seen_urls: set[str] = set()

    for q in queries:
        ddg_url = f"https://html.duckduckgo.com/html/?q={quote(q)}"
        text = await _jina_fetch(ddg_url, timeout=25.0)
        if not text:
            continue

        # Extract result URLs + snippets from DDG HTML (Jina renders as text)
        url_pattern = re.compile(r"https?://[^\s)>\"']+")
        lines = text.split("\n")
        for i, line in enumerate(lines):
            urls = url_pattern.findall(line)
            for url in urls:
                # Skip DDG internal, ads, images
                if any(x in url for x in ["duckduckgo.com", ".png", ".jpg", ".gif", "ad_domain"]):
                    continue
                if url in seen_urls:
                    continue
                seen_urls.add(url)
                # Grab surrounding lines as snippet
                snippet_lines = lines[max(0, i-1):i+4]
                snippet = " ".join(snippet_lines).strip()[:CHARS_PER_SNIPPET]
                results.append({"url": url, "snippet": snippet})
                if len(results) >= SNIPPETS_PER_TARGET:
                    break
            if len(results) >= SNIPPETS_PER_TARGET:
                break

    return results[:SNIPPETS_PER_TARGET]


async def gather_all_snippets(targets: list[dict]) -> dict[str, list[dict]]:
    """Returns {pejabat_id: [{url, snippet}, ...]} for all targets."""
    tasks = {
        t["pejabat_id"]: search_target(t["posisi"], t["wilayah_nama"])
        for t in targets
    }
    results = await asyncio.gather(*tasks.values(), return_exceptions=True)
    out: dict[str, list[dict]] = {}
    for pid, result in zip(tasks.keys(), results):
        if isinstance(result, Exception):
            logger.warning("Search failed for %s: %s", pid, result)
            out[pid] = []
        else:
            out[pid] = result
    return out


# ─── Z.AI batch LLM call ──────────────────────────────────────────────────────

def _load_zai_config() -> tuple[str, str, str]:
    with open(ROOT / "config.yaml", encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    agent_cfg = cfg.get("agent_llm", {})
    base_url = agent_cfg.get("base_url", "https://api.z.ai/api/coding/paas/v4")
    model = agent_cfg.get("model", "glm-4.5-air")
    api_key = os.getenv(agent_cfg.get("api_key_env", "ZHIPUAI_API_KEY"), "")
    return base_url, model, api_key


SYSTEM_PROMPT = """
Kamu adalah sistem verifikasi data pejabat publik Indonesia.
Tugasmu: untuk setiap entri dalam daftar berikut, tentukan nama lengkap pejabat yang SAAT INI menjabat (per 2025-2026), berdasarkan cuplikan web yang disediakan.

Aturan ketat:
1. Nama harus berupa nama orang Indonesia yang nyata (bukan placeholder seperti "Bupati Kabupaten X")
2. Prioritaskan info paling baru (pasca-Pilkada 2024)
3. Jika cuplikan web tidak memuat nama yang jelas → kembalikan null untuk nama itu
4. Jangan mengarang atau menggunakan pengetahuan internal — hanya gunakan cuplikan yang diberikan
5. Kembalikan JSON murni, tidak ada teks lain

Format output JSON:
{
  "results": [
    {
      "pejabat_id": "...",
      "nama_ditemukan": "Nama Lengkap" atau null,
      "sumber_url": "URL dari cuplikan yang memuat nama" atau null,
      "keyakinan": "tinggi" | "sedang" | "rendah" | "tidak_ada"
    }
  ]
}
""".strip()


def _build_batch_prompt(batch: list[dict], snippets: dict[str, list[dict]]) -> str:
    lines = ["Verifikasi nama pejabat berikut berdasarkan cuplikan web:\n"]
    for i, t in enumerate(batch, 1):
        lines.append(f"--- Entri {i} ---")
        lines.append(f"pejabat_id: {t['pejabat_id']}")
        lines.append(f"posisi: {t['posisi']}")
        lines.append(f"wilayah: {t['wilayah_nama']} ({t['provinsi_nama']})")
        lines.append(f"nama_saat_ini_di_DB: {t['nama_lengkap']} (kemungkinan placeholder)")

        srcs = snippets.get(t["pejabat_id"], [])
        if srcs:
            lines.append("Cuplikan web:")
            for j, s in enumerate(srcs, 1):
                lines.append(f"  [{j}] {s['url']}")
                lines.append(f"      {s['snippet'][:400]}")
        else:
            lines.append("Cuplikan web: tidak ada hasil pencarian")
        lines.append("")

    lines.append("Kembalikan JSON sesuai format di atas untuk semua entri.")
    return "\n".join(lines)


def _extract_json(text: str) -> dict:
    text = re.sub(r"//[^\n]*", "", text)  # strip JS comments
    text = re.sub(r",\s*([}\]])", r"\1", text)  # strip trailing commas

    # Find outermost { ... }
    start = text.find("{")
    if start == -1:
        raise ValueError("No JSON object found")
    depth = 0
    for i, ch in enumerate(text[start:], start):
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return json.loads(text[start:i+1])
    raise ValueError("Unbalanced JSON")


def call_zai_batch(batch: list[dict], snippets: dict[str, list[dict]]) -> list[dict]:
    base_url, model, api_key = _load_zai_config()
    prompt = _build_batch_prompt(batch, snippets)

    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        "max_tokens": 1024,
        "temperature": 0.1,
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    with httpx.Client(timeout=90.0) as client:
        r = client.post(f"{base_url}/chat/completions", json=body, headers=headers)

    if r.status_code != 200:
        raise RuntimeError(f"Z.AI HTTP {r.status_code}: {r.text[:300]}")

    data = r.json()
    content = data["choices"][0]["message"]["content"] or ""

    parsed = _extract_json(content)
    return parsed.get("results", [])


# ─── DB write ─────────────────────────────────────────────────────────────────

def apply_result(supabase, target: dict, result: dict, dry_run: bool) -> str:
    """Returns: 'updated' | 'skipped' | 'flagged'"""
    nama = result.get("nama_ditemukan")
    keyakinan = result.get("keyakinan", "tidak_ada")
    sumber = result.get("sumber_url")

    if not nama or keyakinan == "tidak_ada":
        if not dry_run:
            supabase.table("flags").upsert({
                "pejabat_id": target["pejabat_id"],
                "type": "agent_unresolved",
                "reason": f"[zai_batch] No name found for {target['posisi']} @ {target['wilayah_nama']}",
                "status": "pending",
            }, on_conflict="pejabat_id,type").execute()
        return "flagged"

    if is_placeholder(nama):
        return "skipped"

    if not dry_run:
        metadata = {
            "sources": [{"url": sumber, "method": "zai_batch"}] if sumber else [],
            "confidence": {"tinggi": 0.85, "sedang": 0.65, "rendah": 0.45}.get(keyakinan, 0.4),
            "verified_by": "zai_batch_verify",
        }
        supabase.table("pejabat").update({
            "nama_lengkap": nama,
            "metadata": metadata,
        }).eq("id", target["pejabat_id"]).execute()

    return "updated"


# ─── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--provinsi", help="Filter to one province")
    ap.add_argument("--low-coverage", action="store_true", help="Only kepala daerah (non-wakil) roles")
    ap.add_argument("--limit", type=int, default=10)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    supabase = get_supabase()

    logger.info("Fetching placeholder targets...")
    targets = fetch_placeholder_targets(supabase, args.provinsi, args.low_coverage, args.limit)
    logger.info("  %d targets found", len(targets))

    if not targets:
        logger.info("Nothing to do.")
        return

    # Show what we're working on
    for t in targets:
        logger.info("  → %s @ %s (%s)", t["posisi"], t["wilayah_nama"], t["provinsi_nama"])

    logger.info("\nGathering search snippets...")
    snippets = asyncio.run(gather_all_snippets(targets))
    for pid, srcs in snippets.items():
        logger.info("  %s: %d snippets", pid[:8], len(srcs))

    stats = {"updated": 0, "skipped": 0, "flagged": 0, "errors": 0}
    all_results: list[dict] = []

    # Process in batches
    for batch_start in range(0, len(targets), BATCH_SIZE):
        batch = targets[batch_start:batch_start + BATCH_SIZE]
        logger.info("\nBatch %d-%d / %d — calling Z.AI...",
                    batch_start + 1, batch_start + len(batch), len(targets))
        try:
            results = call_zai_batch(batch, snippets)
        except Exception as e:
            logger.error("Z.AI call failed: %s", e)
            stats["errors"] += len(batch)
            continue

        # Match results back to targets by pejabat_id
        result_map = {r["pejabat_id"]: r for r in results}
        for target in batch:
            result = result_map.get(target["pejabat_id"])
            if not result:
                logger.warning("  No result returned for %s", target["pejabat_id"][:8])
                stats["errors"] += 1
                continue

            status = apply_result(supabase, target, result, args.dry_run)
            stats[status] = stats.get(status, 0) + 1
            prefix = "[dry-run] " if args.dry_run else ""
            nama = result.get("nama_ditemukan") or "—"
            key = result.get("keyakinan", "?")
            logger.info("  %s%s | %s @ %s → %s (%s)",
                        prefix, status.upper(), target["posisi"],
                        target["wilayah_nama"], nama, key)
            all_results.append({
                "target": target,
                "result": result,
                "status": status,
            })

        time.sleep(1.0)

    print("\n" + "="*60)
    print(f"Run summary: {stats['updated']} updated, {stats['skipped']} skipped, "
          f"{stats['flagged']} flagged, {stats['errors']} errors (of {len(targets)} targets)")
    if args.dry_run:
        print("[dry-run] Nothing was written.")


if __name__ == "__main__":
    main()
