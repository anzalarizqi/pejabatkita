#!/usr/bin/env python3
from __future__ import annotations

import asyncio
import json
import logging
import sys
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

import yaml
from dotenv import load_dotenv

# Reuse scraper's core + pipeline - no duplication
sys.path.insert(0, str(Path(__file__).parent.parent / "scraper"))

from core.confidence import calculate as calc_confidence
from core.schema import (
    Biodata, ConfidenceScore, Jabatan, Metadata, Pejabat,
    Pendidikan, Source, SourceType,
)
from pipeline.llm import chat
from pipeline.websearch import read_url, search

_CONFIG_PATH = Path(__file__).parent.parent / "config.yaml"
load_dotenv(_CONFIG_PATH.parent / ".env")


# ─── Config ──────────────────────────────────────────────────────────────────

@dataclass
class VerifierConfig:
    delay: float
    max_retries: int
    confidence_threshold: float


def load_config() -> VerifierConfig:
    with open(_CONFIG_PATH, encoding="utf-8") as f:
        raw = yaml.safe_load(f).get("scraper", {})
    return VerifierConfig(
        delay=raw.get("delay_between_requests", 2),
        max_retries=raw.get("max_retries", 3),
        confidence_threshold=raw.get("confidence_threshold_review", 0.5),
    )


# ─── VerificationResult ──────────────────────────────────────────────────────

@dataclass
class VerificationResult:
    confirmed_fields: list[str] = field(default_factory=list)
    conflicted_fields: list[dict] = field(default_factory=list)
    new_fields: dict = field(default_factory=dict)
    notes: str = ""
    sources_confirmed: list[str] = field(default_factory=list)

    @property
    def has_conflict(self) -> bool:
        return len(self.conflicted_fields) > 0


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _domain(url: str) -> str:
    try:
        return urlparse(url).netloc
    except Exception:
        return url


def _source_type(url: str) -> SourceType:
    d = _domain(url).lower()
    if "wikipedia" in d:
        return SourceType.wikipedia
    if "kpu" in d:
        return SourceType.kpu
    if "kpk" in d:
        return SourceType.kpk
    if any(x in d for x in ("kompas", "tempo", "cnnindonesia", "detik", "tribun")):
        return SourceType.news
    if any(x in d for x in (".go.id", "pemda", "prov.", "kab.", "kota.")):
        return SourceType.pemda
    return SourceType.other


def _calc_completeness(p: Pejabat) -> float:
    score = 0
    if p.nama_lengkap and not p.nama_lengkap.startswith("["):
        score += 1
    if p.jabatan:
        j = p.jabatan[0]
        if j.posisi:
            score += 1
        if j.wilayah:
            score += 1
        if j.partai:
            score += 1
    if p.biodata.tanggal_lahir:
        score += 1
    if p.biodata.tempat_lahir:
        score += 1
    if p.biodata.jenis_kelamin:
        score += 1
    if p.pendidikan:
        score += 1
    return score / 8


def _apply_new_fields(p: Pejabat, new_fields: dict) -> Pejabat:
    """Merge flat-key new fields into pejabat. Never overwrite existing non-null values."""
    if not new_fields:
        return p

    biodata_updates: dict = {}
    jabatan_updates: dict = {}

    for key, value in new_fields.items():
        if value is None:
            continue
        if key.startswith("biodata."):
            field_name = key[len("biodata."):]
            current = getattr(p.biodata, field_name, None)
            if current is None:
                biodata_updates[field_name] = value
        elif key.startswith("jabatan.") and p.jabatan:
            field_name = key[len("jabatan."):]
            current = getattr(p.jabatan[0], field_name, None)
            if current is None:
                jabatan_updates[field_name] = value

    if not biodata_updates and not jabatan_updates:
        return p

    new_biodata = p.biodata.model_copy(update=biodata_updates) if biodata_updates else p.biodata
    new_jabatan = p.jabatan.copy()
    if jabatan_updates and new_jabatan:
        new_jabatan[0] = new_jabatan[0].model_copy(update=jabatan_updates)

    return p.model_copy(update={"biodata": new_biodata, "jabatan": new_jabatan})


# ─── LLM Verification ────────────────────────────────────────────────────────

_VERIFY_SYSTEM = """
Kamu adalah sistem verifikasi data pejabat Indonesia.
Tugasmu: bandingkan data yang diklaim dengan sumber web, laporkan apa yang terkonfirmasi,
apa yang bertentangan, dan informasi baru yang ditemukan.
Kembalikan JSON saja - tidak ada teks lain di luar JSON.
""".strip()


def _build_claimed_summary(p: Pejabat) -> dict:
    jabatan = p.jabatan[0] if p.jabatan else None
    return {
        "nama_lengkap": p.nama_lengkap,
        "jabatan.posisi": jabatan.posisi if jabatan else None,
        "jabatan.wilayah": jabatan.wilayah if jabatan else None,
        "jabatan.partai": jabatan.partai if jabatan else None,
        "jabatan.status": jabatan.status.value if jabatan else None,
        "jabatan.mulai_jabatan": str(jabatan.mulai_jabatan) if jabatan and jabatan.mulai_jabatan else None,
        "biodata.tempat_lahir": p.biodata.tempat_lahir,
        "biodata.tanggal_lahir": str(p.biodata.tanggal_lahir) if p.biodata.tanggal_lahir else None,
        "biodata.jenis_kelamin": p.biodata.jenis_kelamin.value if p.biodata.jenis_kelamin else None,
        "biodata.agama": p.biodata.agama,
        "pendidikan_count": len(p.pendidikan),
    }


def _call_llm_verify(p: Pejabat, sources_text: dict[str, str]) -> VerificationResult:
    claimed = json.dumps(_build_claimed_summary(p), ensure_ascii=False, indent=2)
    sources_block = "\n\n".join(
        f"=== Sumber: {url} ===\n{text[:2500]}"
        for url, text in sources_text.items()
    )

    prompt = f"""
Data yang diklaim:
{claimed}

Teks dari sumber web:
{sources_block}

Kembalikan JSON dengan struktur ini:
{{
  "confirmed_fields": ["nama_lengkap", "jabatan.posisi", ...],
  "conflicted_fields": [
    {{"field": "jabatan.partai", "claimed": "Golkar", "found": "Gerindra"}}
  ],
  "new_fields": {{
    "biodata.tanggal_lahir": "1970-05-15"
  }},
  "notes": "ringkasan singkat temuan verifikasi",
  "sources_confirmed": ["url1", "url2"]
}}

Hanya kembalikan JSON. Field yang tidak bisa dikonfirmasi maupun tidak bertentangan - abaikan saja.
""".strip()

    response = chat(
        messages=[{"role": "user", "content": prompt}],
        system_prompt=_VERIFY_SYSTEM,
    )

    cleaned = response.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[-1]
        cleaned = cleaned.rsplit("```", 1)[0]

    raw = json.loads(cleaned.strip())
    return VerificationResult(
        confirmed_fields=raw.get("confirmed_fields") or [],
        conflicted_fields=raw.get("conflicted_fields") or [],
        new_fields=raw.get("new_fields") or {},
        notes=raw.get("notes") or "",
        sources_confirmed=raw.get("sources_confirmed") or [],
    )


# ─── Per-pejabat verification ─────────────────────────────────────────────────

async def verify_one(
    p: Pejabat,
    config: VerifierConfig,
    verbose: bool,
) -> Pejabat:
    log = logging.getLogger(__name__)
    jabatan = p.jabatan[0] if p.jabatan else None
    label = f"{jabatan.posisi if jabatan else '?'} {jabatan.wilayah if jabatan else '?'} - {p.nama_lengkap}"

    if verbose:
        print(f"  Verifying: {label}")

    # Build targeted search queries
    queries = [f"{jabatan.posisi} {jabatan.wilayah} 2024 2025"] if jabatan else []
    if p.nama_lengkap and not p.nama_lengkap.startswith("["):
        queries.insert(0, p.nama_lengkap)
        queries.append(f"{p.nama_lengkap} profil biodata jabatan")

    # Gather web sources
    sources_text: dict[str, str] = {}
    existing_urls = {s.url for s in p.metadata.sources}

    for query in queries[:2]:
        results = await search(query)
        for r in results[:2]:
            if r["url"] in existing_urls or r["url"] in sources_text:
                continue
            content = await read_url(r["url"])
            if content and len(content) > 200:
                sources_text[r["url"]] = content
                if verbose:
                    print(f"    [web] {r['url'][:70]} ({len(content)} chars)")
            if len(sources_text) >= 3:
                break
        if len(sources_text) >= 3:
            break

    if not sources_text:
        log.warning("No verification sources found for: %s", label)
        # Keep original, just note it couldn't be verified
        orig_conf = p.metadata.confidence
        unverified_conf = ConfidenceScore(
            score=orig_conf.score,
            completeness=orig_conf.completeness,
            corroboration=orig_conf.corroboration,
            notes=f"[Tidak terverifikasi - tidak ada sumber ditemukan] {orig_conf.notes or ''}".strip(),
        )
        return p.model_copy(update={
            "metadata": p.metadata.model_copy(update={"confidence": unverified_conf})
        })

    # LLM fact-check
    try:
        result = _call_llm_verify(p, sources_text)
    except Exception as e:
        log.warning("LLM verification failed for %s: %s", label, e)
        return p.model_copy(update={
            "metadata": p.metadata.model_copy(update={
                "confidence": ConfidenceScore(
                    score=p.metadata.confidence.score,
                    completeness=p.metadata.confidence.completeness,
                    corroboration=p.metadata.confidence.corroboration,
                    notes=f"[Verifikasi gagal: {e}]",
                ),
                "needs_review": True,
            })
        })

    # Apply new fields (fill gaps only)
    merged = _apply_new_fields(p, result.new_fields)

    # Recompute confidence
    new_source_urls = [u for u in result.sources_confirmed if u not in existing_urls]
    total_sources = len(p.metadata.sources) + len(new_source_urls)
    new_completeness = _calc_completeness(merged)

    new_conf_base = calc_confidence(
        completeness=new_completeness,
        num_sources=total_sources,
        has_conflict=result.has_conflict,
    )
    new_conf = ConfidenceScore(
        score=new_conf_base.score,
        completeness=new_conf_base.completeness,
        corroboration=new_conf_base.corroboration,
        notes=result.notes or None,
    )

    # Append new sources
    new_sources = p.metadata.sources + [
        Source(
            url=u,
            domain=_domain(u),
            scraped_at=datetime.utcnow(),
            type=_source_type(u),
        )
        for u in new_source_urls
    ]

    new_metadata = Metadata(
        sources=new_sources,
        confidence=new_conf,
        last_updated=datetime.utcnow(),
        needs_review=new_conf.score < config.confidence_threshold or result.has_conflict,
    )

    verified = merged.model_copy(update={"metadata": new_metadata})

    if verbose:
        delta = new_conf.score - p.metadata.confidence.score
        sign = "+" if delta >= 0 else ""
        conflict_note = f" [!] {len(result.conflicted_fields)} conflict(s)" if result.has_conflict else ""
        print(f"    conf: {p.metadata.confidence.score:.2f} -> {new_conf.score:.2f} ({sign}{delta:.2f}){conflict_note}")

    return verified


# ─── Output writing ──────────────────────────────────────────────────────────

def write_verified_output(
    final_list: list[Pejabat],
    output_dir: Path,
    skipped: int,
    conf_before: float,
    conflicts: int,
    new_fields_added: int,
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)

    all_data = [p.model_dump(mode="json") for p in final_list]
    needs_review = [d for d in all_data if d["metadata"]["needs_review"]]
    avg_after = (
        sum(d["metadata"]["confidence"]["score"] for d in all_data) / len(all_data)
        if all_data else 0.0
    )

    (output_dir / "pejabat_verified.json").write_text(
        json.dumps(all_data, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (output_dir / "needs_review.json").write_text(
        json.dumps(needs_review, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    report = {
        "total_verified": len(final_list) - skipped,
        "skipped": skipped,
        "conflicts_found": conflicts,
        "new_fields_added": new_fields_added,
        "avg_confidence_before": round(conf_before, 4),
        "avg_confidence_after": round(avg_after, 4),
        "needs_review_count": len(needs_review),
        "verified_at": datetime.utcnow().isoformat() + "Z",
    }
    (output_dir / "verification_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # Update metadata.json if it exists
    meta_path = output_dir / "metadata.json"
    if meta_path.exists():
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        meta["avg_confidence"] = round(avg_after, 4)
        meta["needs_review_count"] = len(needs_review)
        meta["verified_at"] = report["verified_at"]
        meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"\nOutput written to {output_dir}/")
    print(f"  pejabat_verified.json  ({len(all_data)} entries)")
    print(f"  needs_review.json      ({len(needs_review)} entries)")
    print(f"  verification_report.json")


# ─── Main ─────────────────────────────────────────────────────────────────────

async def run(
    file_path: Path,
    output_dir: Path,
    only_needs_review: bool,
    verbose: bool,
    config: VerifierConfig,
) -> None:
    log = logging.getLogger(__name__)

    try:
        raw_list = json.loads(file_path.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"Error: cannot read {file_path}: {e}", file=sys.stderr)
        sys.exit(1)

    try:
        pejabat_list = [Pejabat.model_validate(p) for p in raw_list]
    except Exception as e:
        print(f"Error: invalid pejabat JSON structure: {e}", file=sys.stderr)
        sys.exit(1)

    if only_needs_review:
        to_verify = [p for p in pejabat_list if p.metadata.needs_review]
        skip_list = [p for p in pejabat_list if not p.metadata.needs_review]
    else:
        to_verify = pejabat_list
        skip_list = []

    if not to_verify:
        print("0 entries to verify - nothing to do.")
        return

    conf_before = (
        sum(p.metadata.confidence.score for p in pejabat_list) / len(pejabat_list)
        if pejabat_list else 0.0
    )

    print(f"\nVerifying {len(to_verify)} pejabat ({len(skip_list)} skipped)...")
    print(f"Input:  {file_path}")
    print(f"Output: {output_dir}\n")

    verified: list[Pejabat] = []
    total_conflicts = 0
    total_new_fields = 0

    for i, p in enumerate(to_verify, 1):
        jabatan = p.jabatan[0] if p.jabatan else None
        label = f"{jabatan.posisi if jabatan else '?'} - {p.nama_lengkap}"
        print(f"[{i}/{len(to_verify)}] {label}")

        v = await verify_one(p, config, verbose)
        verified.append(v)

        # Count conflicts and new fields across the run
        if v.metadata.confidence.notes and "conflict" in (v.metadata.confidence.notes or "").lower():
            total_conflicts += 1
        # Approximate new fields: if confidence improved and notes mention new info
        if v.metadata.confidence.score > p.metadata.confidence.score:
            total_new_fields += 1

        await asyncio.sleep(config.delay)

    final_list = verified + skip_list
    write_verified_output(
        final_list,
        output_dir,
        skipped=len(skip_list),
        conf_before=conf_before,
        conflicts=total_conflicts,
        new_fields_added=total_new_fields,
    )

    avg_after = sum(p.metadata.confidence.score for p in final_list) / len(final_list) if final_list else 0.0
    delta = avg_after - conf_before
    sign = "+" if delta >= 0 else ""
    print(f"\nAvg confidence: {conf_before:.2f} -> {avg_after:.2f} ({sign}{delta:.2f})")


def _setup_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.WARNING,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Peta Pejabat Indonesia - Verifier")
    parser.add_argument("--file", required=True, metavar="PATH", help="Path ke JSON output scraper")
    parser.add_argument(
        "--only-needs-review",
        action="store_true",
        help="Hanya verifikasi entri dengan needs_review=true",
    )
    parser.add_argument("--verbose", action="store_true")
    parser.add_argument(
        "--output",
        metavar="DIR",
        help="Output directory (default: same directory as --file)",
    )

    args = parser.parse_args()
    _setup_logging(args.verbose)

    file_path = Path(args.file).resolve()
    if not file_path.exists():
        print(f"Error: file not found: {file_path}", file=sys.stderr)
        sys.exit(1)

    output_dir = Path(args.output).resolve() if args.output else file_path.parent
    config = load_config()

    asyncio.run(run(file_path, output_dir, args.only_needs_review, args.verbose, config))


if __name__ == "__main__":
    main()
