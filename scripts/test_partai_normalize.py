"""Standalone test for partai normalization.
Run: python scripts/test_partai_normalize.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _partai import normalize_partai, CANONICAL_PARTAI


def check(raw, expected_value, expected_known):
    value, known = normalize_partai(raw)
    assert value == expected_value, f"value({raw!r}): got {value!r}, want {expected_value!r}"
    assert known == expected_known, f"known({raw!r}): got {known}, want {expected_known}"
    print(f"  ok: {raw!r} -> ({value!r}, {known})")


def main():
    check("PDI-P", "PDIP", True)
    check("  pdi perjuangan ", "PDIP", True)
    check("Partai Golkar", "Golkar", True)
    check("GERINDRA", "Gerindra", True)
    check("Perseorangan", "Independen", True)
    check("Partai Buruh", "Partai Buruh", False)   # unknown — kept as-is, not rejected
    check("", "", False)
    check(None, "", False)
    assert "PDIP" in CANONICAL_PARTAI
    assert "Independen" in CANONICAL_PARTAI
    print("\nAll partai normalization tests passed.")


if __name__ == "__main__":
    main()
