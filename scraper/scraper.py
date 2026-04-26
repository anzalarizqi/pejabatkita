#!/usr/bin/env python3
from __future__ import annotations

import asyncio
import logging
import re
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

import yaml
from dotenv import load_dotenv

from core import confidence as conf_module
from core.output import write_province_output
from core.wilayah import validate_districts, fetch_province_kode
from core.schema import (
    Biodata, ConfidenceScore, JenisKelamin, Jabatan, Jenjang,
    Level, Metadata, Pejabat, Pendidikan, Source, SourceType, StatusJabatan,
)
from pipeline import browser, llm, websearch, wikipedia

_CONFIG_PATH = Path(__file__).parent.parent / "config.yaml"

load_dotenv(_CONFIG_PATH.parent / ".env")


# ─── Config ───────────────────────────────────────────────────────────────��──

@dataclass
class ScraperConfig:
    delay: float
    max_retries: int
    confidence_threshold: float


def load_scraper_config() -> ScraperConfig:
    with open(_CONFIG_PATH, encoding="utf-8") as f:
        raw = yaml.safe_load(f).get("scraper", {})
    return ScraperConfig(
        delay=raw.get("delay_between_requests", 2),
        max_retries=raw.get("max_retries", 3),
        confidence_threshold=raw.get("confidence_threshold_review", 0.5),
    )


# ─── Helpers ────────────────────────────────��────────────────────────────────

def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def _domain(url: str) -> str:
    try:
        return urlparse(url).netloc
    except Exception:
        return url


def _source_type(url: str) -> SourceType:
    domain = _domain(url).lower()
    if "wikipedia" in domain:
        return SourceType.wikipedia
    if "kpu" in domain:
        return SourceType.kpu
    if "kpk" in domain:
        return SourceType.kpk
    if any(x in domain for x in ("kompas", "tempo", "cnnindonesia", "detik", "tribun")):
        return SourceType.news
    if any(x in domain for x in (".go.id", "pemda", "prov.", "kab.", "kota.")):
        return SourceType.pemda
    return SourceType.other


_COMPLETENESS_FIELDS = 8  # see plan for field list

def _calc_completeness(raw: dict) -> float:
    score = 0
    if raw.get("nama_lengkap"):
        score += 1
    jabatan_list = raw.get("jabatan") or []
    if jabatan_list:
        j = jabatan_list[0] if isinstance(jabatan_list[0], dict) else {}
        if j.get("posisi"):
            score += 1
        if j.get("wilayah"):
            score += 1
        if j.get("partai"):
            score += 1
    biodata = raw.get("biodata") or {}
    if biodata.get("tanggal_lahir"):
        score += 1
    if biodata.get("tempat_lahir"):
        score += 1
    if biodata.get("jenis_kelamin"):
        score += 1
    if raw.get("pendidikan"):
        score += 1
    return score / _COMPLETENESS_FIELDS


def _build_pejabat(raw: dict, sources_text: dict[str, str], threshold: float, name_hint: str = "") -> Pejabat:
    """Validate raw LLM dict into a Pejabat model, attach metadata."""
    completeness = _calc_completeness(raw)
    num_sources = len(sources_text)
    conf = conf_module.calculate(completeness, num_sources)

    sources = [
        Source(
            url=u,
            domain=_domain(u),
            scraped_at=datetime.utcnow(),
            type=_source_type(u),
        )
        for u in sources_text
    ]

    metadata = Metadata(
        sources=sources,
        confidence=conf,
        last_updated=datetime.utcnow(),
        needs_review=conf.score < threshold,
    )

    # Coerce enums safely — unknown values fall back to defaults
    def _jabatan(j: dict) -> Jabatan:
        return Jabatan(
            posisi=j.get("posisi") or "",
            level=_safe_enum(Level, j.get("level"), Level.provinsi),
            wilayah=j.get("wilayah") or "",
            kode_wilayah=j.get("kode_wilayah") or "",
            partai=_n(j.get("partai")),
            mulai_jabatan=_date(j.get("mulai_jabatan")),
            selesai_jabatan=_date(j.get("selesai_jabatan")),
            status=_safe_enum(StatusJabatan, _n(j.get("status")), StatusJabatan.aktif),
        )

    def _pendidikan(p: dict) -> Pendidikan:
        return Pendidikan(
            jenjang=_safe_enum(Jenjang, _n(p.get("jenjang")), Jenjang.lainnya),
            institusi=p.get("institusi") or "",
            jurusan=_n(p.get("jurusan")),
            tahun_lulus=_n(p.get("tahun_lulus")),
        )

    biodata_raw = raw.get("biodata") or {}
    biodata = Biodata(
        tempat_lahir=_n(biodata_raw.get("tempat_lahir")),
        tanggal_lahir=_date(biodata_raw.get("tanggal_lahir")),
        jenis_kelamin=_safe_enum(JenisKelamin, _n(biodata_raw.get("jenis_kelamin")), None),
        agama=_n(biodata_raw.get("agama")),
    )

    jabatan_raw = raw.get("jabatan") or []
    pendidikan_raw = raw.get("pendidikan") or []

    return Pejabat(
        nama_lengkap=_n(raw.get("nama_lengkap")) or name_hint or "Tidak Diketahui",
        gelar_depan=_n(raw.get("gelar_depan")),
        gelar_belakang=_n(raw.get("gelar_belakang")),
        jabatan=[_jabatan(j) for j in jabatan_raw if isinstance(j, dict)],
        biodata=biodata,
        pendidikan=[_pendidikan(p) for p in pendidikan_raw if isinstance(p, dict)],
        metadata=metadata,
    )


def _safe_enum(enum_cls, value, default):
    if value is None:
        return default
    try:
        return enum_cls(value)
    except ValueError:
        return default


def _n(value):
    """Return None if value is None or the literal string 'null'/'NULL'."""
    if value is None or (isinstance(value, str) and value.strip().lower() in ("null", "none", "")):
        return None
    return value


def _date(value):
    """Coerce LLM date strings to valid ISO dates, returning None for anything unparseable."""
    v = _n(value)
    if v is None:
        return None
    if not isinstance(v, str):
        return v
    s = v.strip()
    if re.fullmatch(r"\d{4}", s):
        return f"{s}-01-01"
    # Fix zero month or day components (e.g. "2025-00-00" -> "2025-01-01")
    m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        y, mo, d = m.group(1), int(m.group(2)), int(m.group(3))
        mo = max(1, mo)
        d = max(1, d)
        return f"{y}-{mo:02d}-{d:02d}"
    return s


# ─── Scraping pipeline for one official ──────────────────────────────────────

async def scrape_official(
    posisi: str,
    wilayah: str,
    kode_wilayah: str,
    level: Level,
    config: ScraperConfig,
    verbose: bool = False,
) -> Pejabat | None:
    log = logging.getLogger(__name__)
    query_name = f"{posisi} {wilayah}"
    log.info("Scraping: %s", query_name)

    sources_text: dict[str, str] = {}

    # Step 1: Wikipedia
    wiki_results = await wikipedia.search_wikipedia(query_name)
    if wiki_results:
        text, url = await wikipedia.get_page_text(wiki_results[0]["title"])
        if text:
            sources_text[url] = text
            if verbose:
                print(f"  [wikipedia] {url} ({len(text)} chars)")

    # Step 2: Web search if Wikipedia was thin
    if not sources_text or len(next(iter(sources_text.values()))) < 500:
        web_results = await websearch.search(f"{posisi} {wilayah} profil biodata")
        for r in web_results[:3]:
            content = await websearch.read_url(r["url"])
            if content and len(content) > 200:
                sources_text[r["url"]] = content
                if verbose:
                    print(f"  [websearch] {r['url']} ({len(content)} chars)")
                # Stop after two good web sources
                if sum(1 for v in sources_text.values() if len(v) > 200) >= 2:
                    break

    # Step 3: Browser fallback if still thin
    if not sources_text:
        fallback_results = await websearch.search(query_name)
        if fallback_results:
            text = await browser.navigate(fallback_results[0]["url"])
            if text:
                sources_text[fallback_results[0]["url"]] = text
                if verbose:
                    print(f"  [browser] {fallback_results[0]['url']} ({len(text)} chars)")

    if not sources_text:
        log.warning("No sources found for: %s", query_name)
        # Return a minimal placeholder record
        empty_conf = ConfidenceScore(score=0.0, completeness=0.0, corroboration=0.0, notes="No sources found")
        return Pejabat(
            nama_lengkap=f"[Tidak ditemukan] {query_name}",
            jabatan=[Jabatan(posisi=posisi, level=level, wilayah=wilayah, kode_wilayah=kode_wilayah, status=StatusJabatan.aktif)],
            biodata=Biodata(),
            metadata=Metadata(
                sources=[],
                confidence=empty_conf,
                last_updated=datetime.utcnow(),
                needs_review=True,
            ),
        )

    # Step 4: LLM extraction
    try:
        raw = llm.extract_pejabat(
            sources_text=sources_text,
            name_hint=query_name,
            posisi_hint=posisi,
            wilayah_hint=wilayah,
            kode_wilayah=kode_wilayah,
            level_hint=level.value,
        )
    except Exception as e:
        log.error("LLM extraction failed for %s: %s", query_name, e)
        # Return needs_review placeholder with sources attached
        empty_conf = ConfidenceScore(score=0.0, completeness=0.0, corroboration=0.0, notes=f"LLM error: {e}")
        return Pejabat(
            nama_lengkap=f"[LLM Error] {query_name}",
            jabatan=[Jabatan(posisi=posisi, level=level, wilayah=wilayah, kode_wilayah=kode_wilayah, status=StatusJabatan.aktif)],
            biodata=Biodata(),
            metadata=Metadata(
                sources=[Source(url=u, domain=_domain(u), scraped_at=datetime.utcnow(), type=_source_type(u)) for u in sources_text],
                confidence=empty_conf,
                last_updated=datetime.utcnow(),
                needs_review=True,
            ),
        )

    # Step 5: Build validated Pejabat
    return _build_pejabat(raw, sources_text, config.confidence_threshold, name_hint=query_name)


# ─── Province / wilayah / pejabat-id runs ───────────────────────────────────���

async def run_province(
    provinsi_name: str,
    kode_provinsi: str,
    output_dir: str,
    dry_run: bool,
    verbose: bool,
    config: ScraperConfig,
) -> None:
    log = logging.getLogger(__name__)
    print(f"\nScraping provinsi: {provinsi_name} (kode BPS: {kode_provinsi})")

    officials: list[Pejabat] = []

    # Gubernur + Wagub first
    for posisi in ["Gubernur", "Wakil Gubernur"]:
        p = await scrape_official(posisi, provinsi_name, kode_provinsi, Level.provinsi, config, verbose)
        if p:
            officials.append(p)
            print(f"  [OK] {posisi} {provinsi_name}: {p.nama_lengkap} (conf: {p.metadata.confidence.score:.2f})")
        await asyncio.sleep(config.delay)

    # Get kab/kota list
    print(f"\nMengambil daftar kab/kota di {provinsi_name}...")
    wiki_districts = await wikipedia.get_province_districts(provinsi_name)
    if not wiki_districts:
        log.warning("Could not retrieve district list for %s — skipping kab/kota", provinsi_name)

    districts = validate_districts(wiki_districts, kode_provinsi)
    print(f"  Ditemukan {len(districts)} kab/kota (dari {len(wiki_districts)} Wikipedia)\n")

    for district, kode in sorted(districts):
        level = Level.kota if district.lower().startswith("kota ") else Level.kabupaten

        posisi_list = ["Walikota", "Wakil Walikota"] if level == Level.kota else ["Bupati", "Wakil Bupati"]
        for posisi in posisi_list:
            p = await scrape_official(posisi, district, kode, level, config, verbose)
            if p:
                officials.append(p)
                print(f"  [OK] {posisi} {district}: {p.nama_lengkap} (conf: {p.metadata.confidence.score:.2f})")
            await asyncio.sleep(config.delay)

    result_path = write_province_output(_slug(provinsi_name), officials, output_dir, dry_run)
    needs = sum(1 for p in officials if p.metadata.needs_review)
    print(f"\nSelesai. {len(officials)} pejabat | {needs} perlu review -> {result_path}")


async def run_wilayah(
    wilayah_name: str,
    output_dir: str,
    dry_run: bool,
    verbose: bool,
    config: ScraperConfig,
) -> None:
    level = Level.kota if wilayah_name.lower().startswith("kota ") else Level.kabupaten
    posisi_list = ["Walikota", "Wakil Walikota"] if level == Level.kota else ["Bupati", "Wakil Bupati"]

    officials: list[Pejabat] = []
    for posisi in posisi_list:
        p = await scrape_official(posisi, wilayah_name, "XX", level, config, verbose)
        if p:
            officials.append(p)
            print(f"  [OK]{posisi}: {p.nama_lengkap} (conf: {p.metadata.confidence.score:.2f})")
        await asyncio.sleep(config.delay)

    write_province_output(_slug(wilayah_name), officials, output_dir, dry_run)


# ─── CLI ──────────────────────────────��──────────────────────────────────────

def _setup_logging(verbose: bool) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Peta Pejabat Indonesia — Scraper")

    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--provinsi", metavar="NAMA", help='Nama provinsi, e.g. "Jawa Barat"')
    group.add_argument("--kode-provinsi", metavar="KODE", help='Kode BPS provinsi, e.g. "32"')
    group.add_argument("--wilayah", metavar="NAMA", help="Nama kab/kota spesifik")
    group.add_argument("--pejabat-id", metavar="UUID", help="UUID pejabat untuk re-scrape satu orang")

    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    parser.add_argument("--output", metavar="DIR", default="./output")

    args = parser.parse_args()
    _setup_logging(args.verbose)
    config = load_scraper_config()

    if args.provinsi:
        kode_provinsi = fetch_province_kode(args.provinsi) or "XX"
        asyncio.run(run_province(
            provinsi_name=args.provinsi,
            kode_provinsi=kode_provinsi,
            output_dir=args.output,
            dry_run=args.dry_run,
            verbose=args.verbose,
            config=config,
        ))
    elif args.kode_provinsi:
        # TODO: reverse-lookup province name from BPS code in Phase 4
        print("--kode-provinsi lookup akan diimplementasi di Phase 4 (Supabase wilayah)")
        sys.exit(1)
    elif args.wilayah:
        asyncio.run(run_wilayah(
            wilayah_name=args.wilayah,
            output_dir=args.output,
            dry_run=args.dry_run,
            verbose=args.verbose,
            config=config,
        ))
    elif args.pejabat_id:
        print("--pejabat-id re-scrape akan diimplementasi di Phase 4 (butuh Supabase lookup)")
        sys.exit(1)


if __name__ == "__main__":
    main()
