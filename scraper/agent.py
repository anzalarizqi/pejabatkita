"""
Phase 9A — LLM-agent backfill.

research_pejabat(jabatan, wilayah)
    Run a small web-search loop (DDG/Jina + SearXNG via the existing
    scraper.pipeline.websearch module), feed the read pages to GLM 4.7,
    and return a structured answer with cited sources.

verify_citations(result)
    For each source, re-fetch the URL via Jina and confirm:
      - the `kutipan` quoted text appears in the page, AND
      - the claimed `nama` appears in the page.

    Accept if  >= 2 verified sources, OR exactly 1 verified source whose
    host ends in ".go.id". Reject otherwise.

Both functions return None on rejection so callers leave placeholders alone
rather than inserting fake data.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

import httpx
import yaml
from dotenv import load_dotenv

from scraper.pipeline import websearch

logger = logging.getLogger(__name__)

_ROOT = Path(__file__).parent.parent
_CONFIG_PATH = _ROOT / "config.yaml"


def _load_config() -> dict:
    load_dotenv(_ROOT / ".env")
    with open(_CONFIG_PATH, encoding="utf-8") as f:
        return yaml.safe_load(f)


# ─── Data shapes ─────────────────────────────────────────────────────────────


@dataclass
class Citation:
    url: str
    title: str
    kutipan: str

    def to_dict(self) -> dict:
        return {"url": self.url, "title": self.title, "kutipan": self.kutipan}


@dataclass
class ResearchResult:
    nama: str
    gelar_depan: Optional[str]
    gelar_belakang: Optional[str]
    status: str  # "menjabat" | "penjabat" | "kosong"
    mulai_jabatan: Optional[str]
    sumber: list[Citation] = field(default_factory=list)
    confidence: float = 0.0
    verified_sources: list[Citation] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "nama": self.nama,
            "gelar_depan": self.gelar_depan,
            "gelar_belakang": self.gelar_belakang,
            "status": self.status,
            "mulai_jabatan": self.mulai_jabatan,
            "sumber": [c.to_dict() for c in self.sumber],
            "confidence": self.confidence,
            "verified_sources": [c.to_dict() for c in self.verified_sources],
        }


# ─── LLM call (GLM 4.7 via Z.AI) ─────────────────────────────────────────────


_AGENT_SYSTEM = """
Kamu adalah asisten riset untuk database pejabat publik Indonesia.

Tugasmu: dari teks sumber yang diberikan, identifikasi pejabat yang sedang
menjabat untuk posisi dan wilayah yang diminta, lalu kembalikan JSON.

Aturan WAJIB:
- Hanya kembalikan JSON valid, tanpa teks lain.
- `nama` harus berupa nama orang asli (bukan judul jabatan).
- Untuk setiap sumber: sertakan URL persis seperti yang ada di header
  "=== Sumber: <url> ===", judul singkat, dan `kutipan` — yaitu kalimat
  PERSIS dari sumber itu yang menyebut nama pejabat. Kutipan harus copy-paste
  dari sumber, tidak boleh diparafrase.
- Jika informasi tidak cukup atau bertentangan antar sumber, kembalikan
  `{"nama": null}` dan jelaskan singkat di field `catatan`.
- Pakai null untuk field yang tidak diketahui.

Schema output:
{
  "nama": "string atau null",
  "gelar_depan": "string atau null",
  "gelar_belakang": "string atau null",
  "status": "menjabat | penjabat | kosong",
  "mulai_jabatan": "YYYY-MM-DD atau null",
  "sumber": [
    {"url": "string", "title": "string", "kutipan": "string"}
  ],
  "confidence": 0.0,
  "catatan": "string atau null"
}
""".strip()


class AgentError(Exception):
    pass


def _agent_chat(prompt: str, *, max_tokens: int = 4096) -> str:
    cfg = _load_config().get("agent_llm", {})
    api_key = os.getenv(cfg.get("api_key_env", "ZHIPUAI_API_KEY"), "").strip()
    if not api_key:
        raise AgentError(f"Missing API key env: {cfg.get('api_key_env')}")

    body = {
        "model": cfg["model"],
        "messages": [
            {"role": "system", "content": _AGENT_SYSTEM},
            {"role": "user", "content": prompt},
        ],
        "max_tokens": max_tokens,
        "temperature": 0.1,
    }
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
    }
    url = f"{cfg['base_url'].rstrip('/')}/chat/completions"

    with httpx.Client(timeout=360.0) as client:
        resp = client.post(url, json=body, headers=headers)
    if resp.status_code != 200:
        raise AgentError(f"HTTP {resp.status_code}: {resp.text[:300]}")
    data = resp.json()
    msg = (data.get("choices") or [{}])[0].get("message", {}) or {}
    content = (msg.get("content") or "").strip()
    finish = (data.get("choices") or [{}])[0].get("finish_reason")
    if not content:
        # Thinking models exhaust max_tokens on reasoning_content. Surface the
        # signal so callers can bump tokens or skip — don't try to parse the
        # CoT as the answer.
        raise AgentError(
            f"Empty content from agent LLM (finish_reason={finish}, "
            f"reasoning_len={len(msg.get('reasoning_content') or '')})"
        )
    return content


def _strip_fences(text: str) -> str:
    s = text.strip()
    if s.startswith("```"):
        s = s.split("\n", 1)[-1]
        s = s.rsplit("```", 1)[0]
    return s.strip()


def _extract_json(text: str) -> str:
    """Pull the outermost JSON object from text. Tolerates leading prose,
    trailing commentary, and JS-style line comments. Raises ValueError if no
    balanced object is found."""
    s = _strip_fences(text)
    # Drop // line comments (some models emit them despite instructions)
    s = re.sub(r"^\s*//.*$", "", s, flags=re.MULTILINE)
    start = s.find("{")
    if start < 0:
        raise ValueError("no '{' in response")
    depth = 0
    in_str = False
    esc = False
    for i in range(start, len(s)):
        ch = s[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return s[start : i + 1]
    raise ValueError("unbalanced braces")


# ─── Web research ────────────────────────────────────────────────────────────


def _build_queries(jabatan: str, wilayah: str) -> list[str]:
    """Generate diverse queries — different angles, different domains."""
    return [
        f'"{jabatan}" "{wilayah}" 2025',
        f'"{jabatan} {wilayah}" dilantik',
        f'site:go.id {jabatan} {wilayah}',
        f'{jabatan} {wilayah} terpilih',
    ]


async def _gather_sources(
    jabatan: str, wilayah: str, max_pages: int = 5
) -> dict[str, dict]:
    """Run queries, dedupe URLs, fetch top pages via Jina. Returns {url: {title, text}}."""
    queries = _build_queries(jabatan, wilayah)
    seen_urls: dict[str, dict] = {}

    for q in queries:
        try:
            results = await websearch.search(q)
        except Exception as e:
            logger.warning("Search failed for %r: %s", q, e)
            continue
        for r in results:
            url = r.get("url", "")
            if not url or url in seen_urls:
                continue
            if websearch.is_private_url(url):
                continue
            seen_urls[url] = {"title": r.get("title", ""), "text": ""}
            if len(seen_urls) >= max_pages * 2:
                break
        if len(seen_urls) >= max_pages * 2:
            break

    # Fetch pages — prioritize .go.id, then take more until max_pages
    def _priority(url: str) -> int:
        host = (urlparse(url).hostname or "").lower()
        if host.endswith(".go.id"):
            return 0
        if "wikipedia.org" in host:
            return 1
        return 2

    ordered = sorted(seen_urls.keys(), key=_priority)[:max_pages]
    fetched: dict[str, dict] = {}
    for url in ordered:
        try:
            text = await websearch.read_url(url)
        except Exception as e:
            logger.debug("read_url failed for %s: %s", url, e)
            text = ""
        if text:
            fetched[url] = {"title": seen_urls[url]["title"], "text": text}
    return fetched


def _build_research_prompt(
    jabatan: str, wilayah: str, sources: dict[str, dict]
) -> str:
    if not sources:
        sources_block = "(tidak ada sumber yang berhasil di-fetch)"
    else:
        sources_block = "\n\n".join(
            f"=== Sumber: {url} ===\nJudul: {s['title']}\n{s['text'][:2500]}"
            for url, s in sources.items()
        )
    return f"""
Posisi yang dicari: {jabatan}
Wilayah: {wilayah}
Tanggal saat ini: 2026-05-07 (asumsikan pejabat yang aktif per tanggal ini)

Sumber-sumber:
{sources_block}

Kembalikan JSON sesuai schema. Pastikan setiap entri di `sumber` punya URL
persis dari header "=== Sumber: ... ===" dan `kutipan` yang COPY-PASTE
dari sumber itu (mengandung nama pejabat). Minimal 2 sumber. Confidence
0.0–1.0 berdasarkan seberapa konsisten sumber.
""".strip()


def research_pejabat(jabatan: str, wilayah: str) -> Optional[ResearchResult]:
    """Research current officeholder. Returns None on hard failure."""
    sources = asyncio.run(_gather_sources(jabatan, wilayah))
    if not sources:
        logger.warning("No sources fetched for %s / %s", jabatan, wilayah)
        return None

    prompt = _build_research_prompt(jabatan, wilayah, sources)
    try:
        raw = _agent_chat(prompt)
    except AgentError as e:
        logger.warning("Agent LLM failed for %s / %s: %s", jabatan, wilayah, e)
        return None

    try:
        block = _extract_json(raw)
        # Drop trailing commas before } or ]  (common LLM mistake)
        block = re.sub(r",(\s*[}\]])", r"\1", block)
        parsed = json.loads(block)
    except (json.JSONDecodeError, ValueError) as e:
        logger.warning("Agent returned non-JSON for %s / %s: %s\nraw[:400]=%r",
                       jabatan, wilayah, e, raw[:400])
        return None

    nama = (parsed.get("nama") or "").strip()
    if not nama:
        logger.info("Agent returned no name for %s / %s (catatan: %s)",
                    jabatan, wilayah, parsed.get("catatan"))
        return None

    citations = []
    for s in parsed.get("sumber", []) or []:
        url = (s.get("url") or "").strip()
        if not url:
            continue
        citations.append(Citation(
            url=url,
            title=(s.get("title") or "").strip(),
            kutipan=(s.get("kutipan") or "").strip(),
        ))

    return ResearchResult(
        nama=nama,
        gelar_depan=parsed.get("gelar_depan"),
        gelar_belakang=parsed.get("gelar_belakang"),
        status=(parsed.get("status") or "menjabat").strip(),
        mulai_jabatan=parsed.get("mulai_jabatan"),
        sumber=citations,
        confidence=float(parsed.get("confidence") or 0.0),
    )


# ─── Citation verification ───────────────────────────────────────────────────


_NORMALIZE_WS = re.compile(r"\s+")


def _norm(s: str) -> str:
    return _NORMALIZE_WS.sub(" ", s).strip().lower()


def _name_in_text(nama: str, text_norm: str) -> bool:
    """At least the first two name tokens (each >=3 chars) must appear in order
    within 80 chars of each other. Resilient to gelar inserts."""
    tokens = [t for t in re.split(r"\s+", nama) if len(t) >= 3]
    if not tokens:
        return False
    n = _norm(nama)
    if n in text_norm:
        return True
    # Looser match: first two tokens appear within a window
    if len(tokens) < 2:
        return tokens[0].lower() in text_norm
    t0, t1 = tokens[0].lower(), tokens[1].lower()
    idx = 0
    while True:
        i = text_norm.find(t0, idx)
        if i < 0:
            return False
        j = text_norm.find(t1, i + len(t0))
        if 0 <= j - (i + len(t0)) <= 80:
            return True
        idx = i + 1


async def _verify_one(citation: Citation, nama: str) -> bool:
    if websearch.is_private_url(citation.url):
        return False
    text = await websearch.read_url(citation.url)
    if not text:
        logger.debug("verify: empty fetch for %s", citation.url)
        return False
    text_n = _norm(text)
    kutipan_n = _norm(citation.kutipan)
    # Allow partial kutipan match — first 60 chars, since LLMs sometimes
    # paraphrase the tail. But require >=20 chars to mean anything.
    kutipan_probe = kutipan_n[:60] if len(kutipan_n) >= 60 else kutipan_n
    kutipan_ok = len(kutipan_probe) >= 20 and kutipan_probe in text_n
    nama_ok = _name_in_text(nama, text_n)
    if not (kutipan_ok and nama_ok):
        logger.debug(
            "verify FAIL %s: kutipan_ok=%s nama_ok=%s",
            citation.url, kutipan_ok, nama_ok,
        )
    return kutipan_ok and nama_ok


def _is_gov(url: str) -> bool:
    host = (urlparse(url).hostname or "").lower()
    return host.endswith(".go.id")


def verify_citations(result: ResearchResult) -> Optional[ResearchResult]:
    """Mutates result.verified_sources. Returns result if accepted, else None.

    Accept if  >= 2 verified sources, OR exactly 1 verified source whose host
    ends in ".go.id".
    """
    async def _run() -> list[Citation]:
        verified: list[Citation] = []
        for c in result.sumber:
            if await _verify_one(c, result.nama):
                verified.append(c)
        return verified

    verified = asyncio.run(_run())
    result.verified_sources = verified

    if len(verified) >= 2:
        return result
    if len(verified) == 1 and _is_gov(verified[0].url):
        return result
    return None
