#!/usr/bin/env python3
import argparse
import sys


def main() -> None:
    parser = argparse.ArgumentParser(description="Peta Pejabat Indonesia — Scraper")

    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--provinsi", metavar="NAMA", help='Nama provinsi, e.g. "Jawa Barat"')
    group.add_argument("--kode-provinsi", metavar="KODE", help='Kode BPS provinsi, e.g. "32"')
    group.add_argument("--wilayah", metavar="NAMA", help="Nama kab/kota spesifik")
    group.add_argument("--pejabat-id", metavar="UUID", help="UUID pejabat untuk re-scrape satu orang")

    parser.add_argument("--dry-run", action="store_true", help="Cek struktur output tanpa menyimpan")
    parser.add_argument("--verbose", action="store_true", help="Verbose logging")
    parser.add_argument("--output", metavar="DIR", default="./output", help="Output directory (default: ./output)")

    args = parser.parse_args()

    print("Scraper belum diimplementasi — Phase 2")
    sys.exit(0)


if __name__ == "__main__":
    main()
