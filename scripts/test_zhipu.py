#!/usr/bin/env python3
"""
Minimal test to understand Zhipu web-search + GLM behaviour.
Run each test independently to diagnose issues.

Usage:
  python scripts/test_zhipu.py search   # test web-search API raw output
  python scripts/test_zhipu.py glm      # test plain GLM chat (no tools)
  python scripts/test_zhipu.py tool     # test GLM + function tool call loop
  python scripts/test_zhipu.py all      # run all three
"""
import json
import os
import sys
from pathlib import Path

import httpx
import yaml
from dotenv import load_dotenv

if hasattr(sys.stdout, "buffer"):
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = Path(__file__).parent.parent
load_dotenv(ROOT / ".env")

def _creds():
    with open(ROOT / "config.yaml", encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    for p in cfg.get("llm_providers", []):
        if p["name"] == "zhipu":
            base_url = p.get("base_url", "https://api.z.ai/api/coding/paas/v4")
            api_key  = os.getenv(p.get("api_key_env", "ZHIPUAI_API_KEY"), "")
            return base_url, api_key
    raise RuntimeError("zhipu provider not found in config.yaml")

BASE_URL, API_KEY = _creds()
MODEL = "glm-4.7-flash"
HEADERS = {"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"}

SEARCH_QUERY = "korupsi tipikor Grengseng Pamuji Bupati Jawa Tengah"

# ─── Test 1: raw web-search API ──────────────────────────────────────────────

def test_search():
    print("=" * 60)
    print("TEST 1: Zhipu web-search REST API")
    print(f"Query: {SEARCH_QUERY}")
    print("=" * 60)

    resp = httpx.post(
        "https://api.z.ai/api/paas/v4/web_search",
        json={"search_engine": "search-prime", "search_query": SEARCH_QUERY, "count": 5},
        headers=HEADERS,
        timeout=30,
    )
    print(f"Status: {resp.status_code}")
    print(f"Raw response:\n{json.dumps(resp.json(), indent=2, ensure_ascii=False)}")

# ─── Test 2: plain GLM chat, no tools ────────────────────────────────────────

def test_glm_plain():
    print("\n" + "=" * 60)
    print("TEST 2: Plain GLM chat (no tools)")
    print("=" * 60)

    resp = httpx.post(
        f"{BASE_URL}/chat/completions",
        json={
            "model": MODEL,
            "messages": [
                {"role": "user", "content": "Say hello and tell me today's date. Reply in one sentence."}
            ],
        },
        headers=HEADERS,
        timeout=30,
    )
    print(f"Status: {resp.status_code}")
    print(f"Raw response:\n{json.dumps(resp.json(), indent=2, ensure_ascii=False)}")

# ─── Test 3: GLM + function tool, one round ──────────────────────────────────

def test_glm_tool():
    print("\n" + "=" * 60)
    print("TEST 3: GLM + function tool (observe tool_calls structure)")
    print("=" * 60)

    tools = [{
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "Search the web for information.",
            "parameters": {
                "type": "object",
                "properties": {
                    "search_query": {"type": "string", "description": "Search terms"}
                },
                "required": ["search_query"],
            },
        },
    }]

    messages = [
        {"role": "user", "content": f"Cari rekam jejak korupsi Grengseng Pamuji, Bupati Wonosobo, Jawa Tengah."}
    ]

    print("--- Round 1: initial request ---")
    resp = httpx.post(
        f"{BASE_URL}/chat/completions",
        json={"model": MODEL, "messages": messages, "tools": tools},
        headers=HEADERS,
        timeout=30,
    )
    print(f"Status: {resp.status_code}")
    data = resp.json()
    print(f"Raw response:\n{json.dumps(data, indent=2, ensure_ascii=False)}")

    if resp.status_code != 200:
        return

    choice  = data["choices"][0]
    message = choice["message"]
    finish  = choice["finish_reason"]
    print(f"\nfinish_reason: {finish}")

    if finish != "tool_calls":
        print("Model did NOT request a tool call — answered directly.")
        return

    # Execute the tool call for real
    messages.append(message)
    for tc in message.get("tool_calls", []):
        fn_name = tc["function"]["name"]
        try:
            args = json.loads(tc["function"]["arguments"])
        except Exception:
            args = {}
        query = args.get("search_query", SEARCH_QUERY)
        print(f"\nModel requested tool: {fn_name}(search_query={query!r})")
        print("Executing real web search...")

        search_resp = httpx.post(
            "https://api.z.ai/api/paas/v4/web_search",
            json={"search_engine": "search-prime", "search_query": query, "count": 5},
            headers=HEADERS,
            timeout=30,
        )
        results = search_resp.json().get("search_result", [])
        content = "\n\n".join(
            f"Title: {r.get('title','')}\nURL: {r.get('link','')}\nSummary: {r.get('content','')}"
            for r in results
        ) or "[no results]"

        print(f"Search returned {len(results)} results. First result:")
        if results:
            print(f"  Title: {results[0].get('title','')}")
            print(f"  URL:   {results[0].get('link','')}")
            print(f"  Summary: {results[0].get('content','')[:200]}")

        messages.append({
            "role": "tool",
            "tool_call_id": tc["id"],
            "name": fn_name,
            "content": content,
        })

    print("\n--- Round 2: after tool result ---")
    resp2 = httpx.post(
        f"{BASE_URL}/chat/completions",
        json={"model": MODEL, "messages": messages, "tools": tools},
        headers=HEADERS,
        timeout=30,
    )
    print(f"Status: {resp2.status_code}")
    print(f"Raw response:\n{json.dumps(resp2.json(), indent=2, ensure_ascii=False)}")

# ─── Test 4: search_pro_jina builtin (may be included in coding plan) ────────

def test_builtin_jina():
    print("\n" + "=" * 60)
    print("TEST 4: GLM + search_pro_jina builtin (single round)")
    print("=" * 60)

    tools = [{"type": "web_search", "web_search": {"search_engine": "search_pro_jina"}}]

    messages = [
        {"role": "user", "content": f"Cari rekam jejak korupsi Grengseng Pamuji, Bupati Wonosobo, Jawa Tengah. Apakah ada kasus tipikor?"}
    ]

    resp = httpx.post(
        f"{BASE_URL}/chat/completions",
        json={"model": MODEL, "messages": messages, "tools": tools},
        headers=HEADERS,
        timeout=60,
    )
    print(f"Status: {resp.status_code}")
    print(f"Raw response:\n{json.dumps(resp.json(), indent=2, ensure_ascii=False)}")


# ─── Entry point ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "all"
    if cmd in ("search", "all"):
        test_search()
    if cmd in ("glm", "all"):
        test_glm_plain()
    if cmd in ("tool", "all"):
        test_glm_tool()
    if cmd in ("jina", "all"):
        test_builtin_jina()
