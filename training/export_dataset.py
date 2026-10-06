"""Export collected feedback into a YOLO-format dataset for retraining.

Reads the `feedback` table + private photo bucket with the SERVICE key (never ship that key in the app),
writes:
    <out>/images/<id>.jpg
    <out>/labels/<id>.txt        one "class cx cy w h" line per user-confirmed dot, normalised 0..1
    <out>/records.jsonl          one line per photo (feeds eval/report.py)
    <out>/data.yaml              ready for `yolo train data=<out>/data.yaml`

Usage:
    SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_KEY=... python training/export_dataset.py out/
Standard library only.
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ITEMS = ["pipes", "rebar", "lumber", "boxes", "bottles", "bags", "pallets", "other"]
PAGE = 500


def dots_to_yolo(dots, box_w, box_h, img_w, img_h, cls=0):
    """User dots are centres; the exemplar box the user drew gives the item size. Clip boxes to the image."""
    lines = []
    for d in dots:
        x0 = max(0.0, d["x"] - box_w / 2)
        y0 = max(0.0, d["y"] - box_h / 2)
        x1 = min(float(img_w), d["x"] + box_w / 2)
        y1 = min(float(img_h), d["y"] + box_h / 2)
        if x1 - x0 < 2 or y1 - y0 < 2:
            continue
        lines.append(
            f"{cls} {(x0 + x1) / 2 / img_w:.6f} {(y0 + y1) / 2 / img_h:.6f} "
            f"{(x1 - x0) / img_w:.6f} {(y1 - y0) / img_h:.6f}"
        )
    return lines


def split_of(device_id: str, val_percent: int = 10) -> str:
    """Split by device so one phone's near-duplicate photos never land in both train and val."""
    h = int(hashlib.sha256(device_id.encode()).hexdigest(), 16) % 100
    return "val" if h < val_percent else "train"


def _get(url: str, key: str) -> bytes:
    req = urllib.request.Request(url, headers={"apikey": key, "Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def fetch_rows(base: str, key: str):
    offset = 0
    while True:
        q = urllib.parse.urlencode({"select": "*", "order": "created_at.asc", "limit": PAGE, "offset": offset})
        rows = json.loads(_get(f"{base}/rest/v1/feedback?{q}", key))
        yield from rows
        if len(rows) < PAGE:
            return
        offset += PAGE


def export(base: str, key: str, out: Path) -> int:
    for sub in ("images", "labels"):
        (out / sub).mkdir(parents=True, exist_ok=True)
    n = 0
    with open(out / "records.jsonl", "w", encoding="utf8") as rec:
        for row in fetch_rows(base, key):
            img = _get(f"{base}/storage/v1/object/feedback-images/{row['image_path']}", key)
            (out / "images" / f"{row['id']}.jpg").write_bytes(img)
            ex = row["exemplar"]
            labels = dots_to_yolo(row["final_dots"], ex["w"], ex["h"], row["img_w"], row["img_h"])
            (out / "labels" / f"{row['id']}.txt").write_text("\n".join(labels), encoding="utf8")
            rec.write(json.dumps({**row, "split": split_of(row["device_id"])}) + "\n")
            n += 1
    # single class: "item" (detector is item-agnostic; item type stays in records.jsonl)
    (out / "data.yaml").write_text(
        f"path: {out.resolve().as_posix()}\ntrain: images\nval: images\nnames:\n  0: item\n", encoding="utf8"
    )
    return n


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    service_key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not url or not service_key:
        sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_KEY")
    print(f"exported {export(url, service_key, Path(sys.argv[1]))} photos")
