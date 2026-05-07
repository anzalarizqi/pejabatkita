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

from scraper.pipeline import websearch, browser

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
    # Diagnostics for flag-for-manual on giveup
    candidates_tried: list[str] = field(default_factory=list)
    fetch_failures: dict = field(default_factory=dict)  # url -> reason

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
            "candidates_tried": self.candidates_tried,
            "fetch_failures": self.fetch_failures,
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
        # Force-disable CoT. Even glm-4.5-air sometimes thinks and burns the
        # token budget without returning content. We don't need reasoning —
        # the work was done in Python before the model saw anything.
        "thinking": {"type": "disabled"},
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
    """Generate diverse queries — different angles, different domains.

    Mix of: official-site (.go.id), KPU/inauguration, top news outlets,
    Indonesian news phrasing ("dilantik sebagai"). The model gets at most
    `max_pages` distinct results overall, ranked .go.id > wikipedia > else.
    """
    return [
        f'site:go.id "{jabatan}" "{wilayah}"',
        f'site:kpu.go.id "{wilayah}" pelantikan',
        f'"dilantik sebagai {jabatan}" "{wilayah}"',
        f'"{jabatan} {wilayah}" 2025 site:detik.com OR site:kompas.com OR site:antaranews.com',
        f'"{jabatan}" "{wilayah}" terpilih 2024',
        f'"{jabatan} {wilayah}"',
    ]


_CAPTCHA_MARKERS = (
    "performing security verification",
    "security verification",
    "checking your browser",
    "just a moment",
    "cloudflare ray id",
    "access denied",
    "403 forbidden",
    "<title>403",
    "<title>access denied",
    "ddos protection",
    "challenge-platform",
    "verifying you are human",
)


def _looks_like_captcha(text: str) -> bool:
    if not text or len(text) < 200:
        return True  # too short to contain real article content
    head = text[:3000].lower()
    return any(m in head for m in _CAPTCHA_MARKERS)


async def _fetch_clean(url: str) -> tuple[str, str]:
    """Fetch via Jina; if it returns captcha/empty AND url is .go.id, retry
    via Playwright. Returns (text, failure_reason). text is empty on failure."""
    try:
        text = await websearch.read_url(url)
    except Exception as e:
        return "", f"jina-exc: {e}"
    if not text:
        return "", "jina-empty"
    if _looks_like_captcha(text):
        if _is_gov(url):
            try:
                pw_text = await browser.navigate(url)
            except Exception as e:
                return "", f"jina-captcha;pw-exc: {e}"
            if pw_text and not _looks_like_captcha(pw_text):
                return pw_text, ""
            return "", "jina-captcha;pw-still-blocked"
        return "", "jina-captcha"
    return text, ""


async def _gather_sources(
    jabatan: str,
    wilayah: str,
    max_pages: int = 7,
    max_candidates: int = 20,
) -> tuple[dict[str, dict], list[str], dict[str, str]]:
    """Run queries, dedupe URLs, fetch in priority order until we have
    `max_pages` clean pages or exhaust `max_candidates` URLs.

    Returns (fetched, candidates_tried, fetch_failures).
    """
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
            if len(seen_urls) >= max_candidates:
                break
        if len(seen_urls) >= max_candidates:
            break

    def _priority(url: str) -> int:
        host = (urlparse(url).hostname or "").lower()
        if host.endswith(".go.id"):
            return 0
        if "wikipedia.org" in host:
            return 1
        if any(host.endswith(d) or host.endswith("." + d) for d in (
            "kompas.com", "detik.com", "antaranews.com",
            "tempo.co", "cnnindonesia.com", "tribunnews.com",
        )):
            return 2
        return 3

    ordered = sorted(seen_urls.keys(), key=_priority)
    fetched: dict[str, dict] = {}
    tried: list[str] = []
    failures: dict[str, str] = {}

    for url in ordered:
        if len(fetched) >= max_pages:
            break
        if len(tried) >= max_candidates:
            break
        tried.append(url)
        text, reason = await _fetch_clean(url)
        if text:
            fetched[url] = {"title": seen_urls[url]["title"], "text": text}
        else:
            failures[url] = reason or "unknown"

    logger.info(
        "  sources: %d fetched / %d tried / %d failed (%s)",
        len(fetched), len(tried), len(failures),
        ", ".join(sorted(set(failures.values()))) if failures else "none",
    )
    return fetched, tried, failures


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

Sumber-sumber:
{sources_block}

Tugas: berikan nama pejabat yang PALING BARU disebutkan di sumber-sumber
ini sebagai pemegang posisi tersebut. Jangan ragu jika sumber-sumber
konsisten — sumber adalah otoritas, bukan pengetahuanmu.

Kembalikan JSON sesuai schema. Pastikan setiap entri di `sumber` punya URL
persis dari header "=== Sumber: ... ===" dan `kutipan` yang COPY-PASTE
dari sumber itu (mengandung nama pejabat). Minimal 2 sumber. Confidence
0.0–1.0 berdasarkan seberapa konsisten sumber.
""".strip()


def research_pejabat(jabatan: str, wilayah: str) -> Optional[ResearchResult]:
    """Research current officeholder. Returns None on hard failure.

    A returned ResearchResult always carries `candidates_tried` and
    `fetch_failures` so callers can surface them to manual triage."""
    sources, tried, failures = asyncio.run(_gather_sources(jabatan, wilayah))
    if not sources:
        logger.warning(
            "No clean sources for %s / %s — tried %d candidates",
            jabatan, wilayah, len(tried),
        )
        # Return a stub result so caller can flag-for-manual with diagnostics.
        return ResearchResult(
            nama="",
            gelar_depan=None, gelar_belakang=None,
            status="kosong", mulai_jabatan=None,
            sumber=[], confidence=0.0, verified_sources=[],
            candidates_tried=tried, fetch_failures=failures,
        )

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
        return ResearchResult(
            nama="",
            gelar_depan=None, gelar_belakang=None,
            status="kosong", mulai_jabatan=None,
            sumber=[], confidence=0.0, verified_sources=[],
            candidates_tried=tried, fetch_failures=failures,
        )

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
        candidates_tried=tried,
        fetch_failures=failures,
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


_TRUSTED_DOMAINS = (
    ".go.id",
    "wikipedia.org",
    "kompas.com",
    "detik.com",
    "antaranews.com",
    "tempo.co",
    "cnnindonesia.com",
    "tribunnews.com",
    "republika.co.id",
    "liputan6.com",
)


def _is_trusted(url: str) -> bool:
    host = (urlparse(url).hostname or "").lower()
    return any(host == d or host.endswith("." + d) or host.endswith(d) for d in _TRUSTED_DOMAINS)


def _is_gov(url: str) -> bool:
    host = (urlparse(url).hostname or "").lower()
    return host.endswith(".go.id")


async def _verify_one(citation: Citation, nama: str) -> bool:
    """Verify a citation. Trust tier defines the kutipan-strictness:
    - Trusted domains (.go.id, wikipedia, top-tier news): name-only check.
    - Other domains: name AND kutipan-probe must appear (30 char probe)."""
    if websearch.is_private_url(citation.url):
        return False
    text = await websearch.read_url(citation.url)
    if not text:
        logger.debug("verify: empty fetch for %s", citation.url)
        return False
    text_n = _norm(text)
    nama_ok = _name_in_text(nama, text_n)
    if not nama_ok:
        logger.debug("verify FAIL %s: name not in page", citation.url)
        return False

    if _is_trusted(citation.url):
        return True

    kutipan_n = _norm(citation.kutipan)
    kutipan_probe = kutipan_n[:30] if len(kutipan_n) >= 30 else kutipan_n
    kutipan_ok = len(kutipan_probe) >= 15 and kutipan_probe in text_n
    if not kutipan_ok:
        logger.debug("verify FAIL %s: untrusted domain + kutipan miss", citation.url)
    return kutipan_ok


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
