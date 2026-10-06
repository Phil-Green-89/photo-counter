"""Accuracy of the shipped model, from real user corrections, split by lighting.

The model's own dot count vs the count the user ended with is the ground truth we get for free.

Usage:  python eval/report.py out/records.jsonl
Standard library only.
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict

ORDER = {"good": 0, "dim": 1, "poor": 2}


def summarise(records):
    groups = defaultdict(list)
    for r in records:
        groups[(r["lighting_bucket"], r["model_version"])].append(r)
    out = []
    for (bucket, version), rs in groups.items():
        errs = [abs(len(r["model_dots"]) - len(r["final_dots"])) for r in rs]
        rated = [r["thumbs_up"] for r in rs if r.get("thumbs_up") is not None]
        out.append({
            "bucket": bucket,
            "model": version,
            "photos": len(rs),
            "mae": sum(errs) / len(errs),
            "within_1": sum(e <= 1 for e in errs) / len(errs),
            "exact": sum(e == 0 for e in errs) / len(errs),
            "thumbs_up": (sum(rated) / len(rated)) if rated else None,
        })
    return sorted(out, key=lambda g: (g["model"], ORDER.get(g["bucket"], 9)))


def render(rows) -> str:
    head = f"{'model':<10}{'light':<7}{'photos':>7}{'MAE':>8}{'exact':>8}{'+-1':>8}{'thumbs':>8}"
    lines = [head, "-" * len(head)]
    for g in rows:
        up = "-" if g["thumbs_up"] is None else f"{g['thumbs_up']:.0%}"
        lines.append(
            f"{g['model']:<10}{g['bucket']:<7}{g['photos']:>7}{g['mae']:>8.2f}"
            f"{g['exact']:>8.0%}{g['within_1']:>8.0%}{up:>8}"
        )
    return "\n".join(lines)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    with open(sys.argv[1], encoding="utf8") as f:
        print(render(summarise(json.loads(line) for line in f if line.strip())))
