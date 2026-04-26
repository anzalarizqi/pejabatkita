import json
from datetime import datetime
from pathlib import Path

from .schema import Pejabat


def write_province_output(
    provinsi_slug: str,
    pejabat_list: list[Pejabat],
    output_dir: str = "./output",
    dry_run: bool = False,
) -> Path:
    """Write scraper results for one province to output/<provinsi_slug>/."""
    base = Path(output_dir) / provinsi_slug

    if dry_run:
        print(f"[dry-run] would write {len(pejabat_list)} pejabat to {base}/")
        return base

    base.mkdir(parents=True, exist_ok=True)

    all_data = [p.model_dump(mode="json") for p in pejabat_list]
    needs_review = [p for p in all_data if p["metadata"]["needs_review"]]

    (base / "pejabat.json").write_text(json.dumps(all_data, ensure_ascii=False, indent=2), encoding="utf-8")
    (base / "needs_review.json").write_text(json.dumps(needs_review, ensure_ascii=False, indent=2), encoding="utf-8")

    avg_confidence = (
        sum(p["metadata"]["confidence"]["score"] for p in all_data) / len(all_data)
        if all_data else 0.0
    )

    metadata = {
        "provinsi": provinsi_slug,
        "total_pejabat": len(all_data),
        "needs_review_count": len(needs_review),
        "avg_confidence": round(avg_confidence, 4),
        "generated_at": datetime.utcnow().isoformat() + "Z",
    }
    (base / "metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")

    return base
