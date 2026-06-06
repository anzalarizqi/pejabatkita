"""Canonical Indonesian political-party names + alias normalization.

Shared by export_enrichment.py (--report) and test_partai_normalize.py.
Mirror of web/lib/partai.ts — keep both in sync (one line per new party).
"""
from __future__ import annotations

# Canonical short name -> aliases (lowercased, space-collapsed) mapping to it.
_PARTAI_ALIASES: dict[str, list[str]] = {
    "PDIP": ["pdip", "pdi-p", "pdi p", "pdi perjuangan", "partai pdip",
             "partai demokrasi indonesia perjuangan"],
    "Golkar": ["golkar", "partai golkar"],
    "Gerindra": ["gerindra", "partai gerindra"],
    "PKB": ["pkb", "partai kebangkitan bangsa"],
    "NasDem": ["nasdem", "nasional demokrat", "partai nasdem",
               "partai nasional demokrat"],
    "PPP": ["ppp", "partai persatuan pembangunan"],
    "PKS": ["pks", "partai keadilan sejahtera"],
    "Demokrat": ["demokrat", "partai demokrat"],
    "PAN": ["pan", "partai amanat nasional"],
    "PSI": ["psi", "partai solidaritas indonesia"],
    "Perindo": ["perindo", "partai perindo"],
    "Hanura": ["hanura", "partai hanura"],
    "PBB": ["pbb", "partai bulan bintang"],
    "Independen": ["independen", "perseorangan", "non-partai", "nonpartai",
                   "jalur independen", "jalur perseorangan"],
}

CANONICAL_PARTAI: frozenset[str] = frozenset(_PARTAI_ALIASES.keys())

_ALIAS_TO_CANONICAL: dict[str, str] = {
    alias: canon for canon, aliases in _PARTAI_ALIASES.items() for alias in aliases
}


def _key(raw: str) -> str:
    return " ".join(raw.strip().lower().split())


def normalize_partai(raw: str | None) -> tuple[str, bool]:
    """Return (value, known).

    - known alias  -> (canonical short name, True)
    - empty/None   -> ("", False)
    - unrecognized -> (original trimmed value, False)   # never rejected
    """
    if not raw or not raw.strip():
        return "", False
    canon = _ALIAS_TO_CANONICAL.get(_key(raw))
    if canon:
        return canon, True
    return raw.strip(), False
