#!/usr/bin/env python3
"""Unit tests for event-clustering pure helpers (no API/DB calls)."""
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from scripts.crawl_hotspot import build_candidate_query_params


def test_candidate_params_pejabat_and_wilayah():
    params = build_candidate_query_params(
        kategori="korupsi", pejabat_id="P1", wilayah_id="W1",
        crawled_at="2026-06-03T00:00:00+00:00", window_days=5, cap=20,
    )
    assert params["kategori"] == "eq.korupsi"
    assert params["or"] == "(pejabat_id.eq.P1,wilayah_id.eq.W1)"
    assert params["crawled_at"] == ["gte.2026-05-29T00:00:00+00:00", "lte.2026-06-08T00:00:00+00:00"]
    assert params["limit"] == 20
    assert params["order"] == "crawled_at.desc"


def test_candidate_params_wilayah_only():
    params = build_candidate_query_params(
        kategori="demonstrasi", pejabat_id=None, wilayah_id="W1",
        crawled_at="2026-06-03T00:00:00+00:00",
    )
    assert params["or"] == "(wilayah_id.eq.W1)"


def test_candidate_params_returns_none_when_no_anchor():
    params = build_candidate_query_params(
        kategori="korupsi", pejabat_id=None, wilayah_id=None,
        crawled_at="2026-06-03T00:00:00+00:00",
    )
    assert params is None


if __name__ == "__main__":
    import traceback
    tests = [v for k, v in sorted(globals().items())
             if k.startswith("test_") and callable(v)]
    failures = 0
    for t in tests:
        try:
            t()
            print(f"PASS {t.__name__}")
        except Exception:
            failures += 1
            print(f"FAIL {t.__name__}")
            traceback.print_exc()
    print(f"\n{len(tests) - failures}/{len(tests)} passed")
    sys.exit(1 if failures else 0)
