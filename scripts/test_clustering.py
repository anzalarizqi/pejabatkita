#!/usr/bin/env python3
"""Unit tests for event-clustering pure helpers (no API/DB calls)."""
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from scripts.crawl_hotspot import build_candidate_query_params, parse_match_response, _to_iso


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


def test_candidate_params_pejabat_only():
    params = build_candidate_query_params(
        kategori="korupsi", pejabat_id="P1", wilayah_id=None,
        crawled_at="2026-06-03T00:00:00+00:00",
    )
    assert params["or"] == "(pejabat_id.eq.P1)"


def test_candidate_params_naive_crawled_at_pinned_utc():
    params = build_candidate_query_params(
        kategori="korupsi", pejabat_id="P1", wilayah_id=None,
        crawled_at="2026-06-03T00:00:00",  # no offset
    )
    assert params["crawled_at"] == ["gte.2026-05-29T00:00:00+00:00", "lte.2026-06-08T00:00:00+00:00"]


def test_candidate_params_returns_none_when_no_anchor():
    params = build_candidate_query_params(
        kategori="korupsi", pejabat_id=None, wilayah_id=None,
        crawled_at="2026-06-03T00:00:00+00:00",
    )
    assert params is None


def test_parse_match_valid_id():
    raw = '{"match_event_id": "E2"}'
    assert parse_match_response(raw, valid_ids={"E1", "E2"}) == "E2"


def test_parse_match_null():
    assert parse_match_response('{"match_event_id": null}', valid_ids={"E1"}) is None


def test_parse_match_hallucinated_id_rejected():
    # Model returns an id not in the candidate set → treat as no match.
    assert parse_match_response('{"match_event_id": "E9"}', valid_ids={"E1"}) is None


def test_parse_match_with_code_fence():
    raw = '```json\n{"match_event_id": "E1"}\n```'
    assert parse_match_response(raw, valid_ids={"E1"}) == "E1"


def test_parse_match_garbage_returns_none():
    assert parse_match_response("not json", valid_ids={"E1"}) is None


def test_to_iso_passthrough_aware():
    assert _to_iso("2026-06-03T00:00:00+00:00") == "2026-06-03T00:00:00+00:00"


def test_to_iso_naive_pinned_utc():
    assert _to_iso("2026-06-03T00:00:00") == "2026-06-03T00:00:00+00:00"


def test_to_iso_rfc822_from_rss():
    # RSS <pubDate> is RFC822; must normalize to a UTC-equivalent ISO instant.
    assert _to_iso("Wed, 03 Jun 2026 07:00:00 +0700") == "2026-06-03T00:00:00+00:00"


def test_to_iso_freeform_falls_back_to_now():
    # LLM free-form date can't be parsed → falls back to a valid ISO 'now'.
    out = _to_iso("3 June 2026")
    from datetime import datetime
    parsed = datetime.fromisoformat(out)  # must be valid ISO
    assert parsed.tzinfo is not None


def test_to_iso_none_falls_back_to_now():
    from datetime import datetime
    parsed = datetime.fromisoformat(_to_iso(None))
    assert parsed.tzinfo is not None


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
