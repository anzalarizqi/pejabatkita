from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass
from pathlib import Path

import httpx
import yaml
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

_CONFIG_PATH = Path(__file__).parent.parent.parent / "config.yaml"


def _load_raw_config() -> dict:
    load_dotenv(Path(__file__).parent.parent.parent / ".env")
    with open(_CONFIG_PATH, encoding="utf-8") as f:
        return yaml.safe_load(f)


@dataclass
class Provider:
    name: str
    base_url: str
    model: str
    api_key: str
    priority: int


class LLMError(Exception):
    pass


def get_providers() -> list[Provider]:
    cfg = _load_raw_config()
    providers: list[Provider] = []

    for entry in cfg.get("llm_providers", []):
        key = os.getenv(entry["api_key_env"], "").strip()
        if not key:
            continue
        providers.append(Provider(
            name=entry["name"],
            base_url=entry["base_url"].rstrip("/"),
            model=entry["model"],
            api_key=key,
            priority=entry["priority"],
        ))

    if not providers:
        raise LLMError("No LLM providers configured — set at least one API key in .env")

    active = os.getenv("ACTIVE_LLM_PROVIDER", "").strip().lower()
    if active:
        providers.sort(key=lambda p: (0 if p.name == active else 1, p.priority))
    else:
        providers.sort(key=lambda p: p.priority)

    return providers


def _build_messages(messages: list[dict], system_prompt: str | None) -> list[dict]:
    if system_prompt:
        return [{"role": "system", "content": system_prompt}] + messages
    return messages


def _supports_json_mode(provider_name: str) -> bool:
    # Anthropic uses its own API format for JSON; others use response_format
    return provider_name not in ("anthropic", "moonshot")


def chat(messages: list[dict], system_prompt: str | None = None) -> str:
    """
    Send messages to the highest-priority available provider.
    Falls back to the next provider on any error.
    Returns the text content of the first response choice.
    """
    providers = get_providers()
    cfg = _load_raw_config()
    max_retries = cfg.get("scraper", {}).get("max_retries", 3)

    last_error: Exception | None = None

    for provider in providers:
        for attempt in range(1, max_retries + 1):
            try:
                result = _call_provider(provider, messages, system_prompt)
                logger.debug("LLM response from %s (attempt %d)", provider.name, attempt)
                return result
            except LLMError as e:
                last_error = e
                logger.warning("Provider %s failed (attempt %d/%d): %s", provider.name, attempt, max_retries, e)
                if attempt < max_retries:
                    time.sleep(1.5 * attempt)
            except Exception as e:
                last_error = e
                logger.warning("Provider %s error (attempt %d/%d): %s", provider.name, attempt, max_retries, e)
                if attempt < max_retries:
                    time.sleep(1.5 * attempt)
        logger.warning("All retries exhausted for provider %s, trying next", provider.name)

    raise LLMError(f"All LLM providers failed. Last error: {last_error}")


def _call_provider(provider: Provider, messages: list[dict], system_prompt: str | None) -> str:
    full_messages = _build_messages(messages, system_prompt)

    body: dict = {
        "model": provider.model,
        "messages": full_messages,
        "max_tokens": 2048,
        "temperature": 0.2,
    }

    if _supports_json_mode(provider.name):
        body["response_format"] = {"type": "json_object"}

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {provider.api_key}",
    }

    with httpx.Client(timeout=60.0) as client:
        resp = client.post(f"{provider.base_url}/chat/completions", json=body, headers=headers)

    if resp.status_code != 200:
        raise LLMError(f"HTTP {resp.status_code}: {resp.text[:300]}")

    data = resp.json()
    content = data["choices"][0]["message"]["content"]
    if not content:
        raise LLMError("Empty response content")
    return content


# ─── Extraction ───────────────────────────────────────────────────────────────

_EXTRACTION_SYSTEM = """
Kamu adalah sistem ekstraksi data terstruktur untuk pejabat publik Indonesia.
Tugasmu: baca teks dari berbagai sumber dan ekstrak informasi ke dalam format JSON yang diminta.
Hanya kembalikan JSON yang valid — tidak ada teks lain di luar JSON.
Gunakan null untuk field yang informasinya tidak tersedia.
""".strip()

_SCHEMA_HINT = """
JSON schema yang harus diikuti:
{
  "nama_lengkap": "string — nama lengkap tanpa gelar",
  "gelar_depan": "string | null — gelar akademik/kebangsawanan di depan nama",
  "gelar_belakang": "string | null — gelar akademik di belakang nama",
  "jabatan": [
    {
      "posisi": "string — jabatan resmi",
      "level": "nasional | provinsi | kabupaten | kota",
      "wilayah": "string — nama wilayah",
      "kode_wilayah": "string — kode BPS",
      "partai": "string | null — partai politik pengusung",
      "mulai_jabatan": "YYYY-MM-DD | null",
      "selesai_jabatan": "YYYY-MM-DD | null",
      "status": "aktif | penjabat | nonaktif"
    }
  ],
  "biodata": {
    "tempat_lahir": "string | null",
    "tanggal_lahir": "YYYY-MM-DD | null",
    "jenis_kelamin": "L | P | null",
    "agama": "string | null"
  },
  "pendidikan": [
    {
      "jenjang": "SD | SMP | SMA | D3 | S1 | S2 | S3 | lainnya",
      "institusi": "string",
      "jurusan": "string | null",
      "tahun_lulus": "integer | null"
    }
  ]
}
""".strip()


def extract_pejabat(
    sources_text: dict[str, str],
    name_hint: str,
    posisi_hint: str,
    wilayah_hint: str,
    kode_wilayah: str,
    level_hint: str,
) -> dict:
    """
    Given scraped text from one or more sources, extract structured pejabat data.
    Returns a raw dict (not yet a Pydantic model — caller validates and merges metadata).
    """
    sources_block = "\n\n".join(
        f"=== Sumber: {url} ===\n{text[:3000]}"
        for url, text in sources_text.items()
    )

    prompt = f"""
{_SCHEMA_HINT}

Konteks pencarian:
- Nama/jabatan yang dicari: {name_hint}
- Posisi: {posisi_hint}
- Wilayah: {wilayah_hint}
- Kode wilayah BPS: {kode_wilayah}
- Level: {level_hint}

Teks dari sumber-sumber berikut:

{sources_block}

Kembalikan JSON sesuai schema di atas. Untuk field jabatan, sertakan posisi yang sedang/pernah dijabat.
Kode wilayah BPS sudah disediakan — gunakan nilai tersebut untuk kode_wilayah field pertama di jabatan.
Untuk provider yang tidak support JSON mode: pastikan output hanya JSON murni, mulai dari {{ dan tutup dengan }}.
""".strip()

    response = chat(
        messages=[{"role": "user", "content": prompt}],
        system_prompt=_EXTRACTION_SYSTEM,
    )

    # Strip markdown code fences if provider wraps JSON in them
    cleaned = response.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[-1]
        cleaned = cleaned.rsplit("```", 1)[0]

    return json.loads(cleaned.strip())
