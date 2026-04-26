#!/usr/bin/env python3
import argparse
import sys


def main() -> None:
    parser = argparse.ArgumentParser(description="Peta Pejabat Indonesia — Verifier")
    parser.add_argument("--file", required=True, metavar="PATH", help="Path ke JSON output scraper")
    parser.add_argument(
        "--only-needs-review",
        action="store_true",
        help="Hanya verifikasi entri dengan needs_review=true",
    )
    parser.add_argument("--verbose", action="store_true", help="Verbose logging")

    args = parser.parse_args()

    print("Verifier belum diimplementasi — Phase 3")
    sys.exit(0)


if __name__ == "__main__":
    main()
