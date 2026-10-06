"""Assemble one single-class YOLO dataset ("item": a pipe/bar end) from every source we have.

Sources (all optional, combine what you have):
  --roboflow   public Roboflow Universe datasets listed in training/datasets.json (needs ROBOFLOW_API_KEY, free)
  --feedback   a folder produced by training/export_dataset.py (real photos corrected by users)
  --synthetic  N generated scenes (see synth.py)

Every training image also gets low-light copies (see degrade.py), because poor light is the
failure mode we are targeting. Validation images are kept untouched.

    python training/prepare_data.py data/ --roboflow --feedback out/ --synthetic 300
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from degrade import degrade  # noqa: E402
from synth import generate  # noqa: E402

LOW_LIGHT_GAINS = (0.55, 0.3)
VAL_PERCENT = 10


def split_name(key: str) -> str:
    return "val" if int(hashlib.sha256(key.encode()).hexdigest(), 16) % 100 < VAL_PERCENT else "train"


def remap_label_file(text: str) -> str:
    """Collapse every class to 0: the detector is item-agnostic (the item type is chosen in the app)."""
    out = []
    for line in text.splitlines():
        parts = line.split()
        if len(parts) >= 5:
            out.append("0 " + " ".join(parts[1:5]))  # drops class id and any segmentation/extra columns
    return "\n".join(out)


def add_images(src_images: Path, src_labels: Path, dst: Path, prefix: str, split_by: str = "file") -> int:
    n = 0
    for img in sorted(src_images.glob("*")):
        if img.suffix.lower() not in {".jpg", ".jpeg", ".png"}:
            continue
        lab = src_labels / (img.stem + ".txt")
        if not lab.exists():
            continue
        text = remap_label_file(lab.read_text(encoding="utf8"))
        if not text.strip():
            continue
        name = f"{prefix}_{img.stem}"
        sp = split_name(f"{prefix}/{img.stem}")
        (dst / "images" / sp).mkdir(parents=True, exist_ok=True)
        (dst / "labels" / sp).mkdir(parents=True, exist_ok=True)
        shutil.copy(img, dst / "images" / sp / f"{name}{img.suffix.lower()}")
        (dst / "labels" / sp / f"{name}.txt").write_text(text, encoding="utf8")
        n += 1
    return n


def add_low_light_copies(dst: Path, seed: int = 0) -> int:
    rng = np.random.default_rng(seed)
    n = 0
    for img_path in sorted((dst / "images" / "train").glob("*")):
        if "_ll" in img_path.stem:
            continue
        lab = dst / "labels" / "train" / (img_path.stem + ".txt")
        img = Image.open(img_path).convert("RGB")
        for g in LOW_LIGHT_GAINS:
            out = degrade(img, g, rng)
            name = f"{img_path.stem}_ll{int(g * 100)}"
            out.save(dst / "images" / "train" / f"{name}.jpg", quality=90)
            shutil.copy(lab, dst / "labels" / "train" / f"{name}.txt")
            n += 1
    return n


def fetch_roboflow(dst: Path, cfg_path: Path) -> list[dict]:
    key = os.environ.get("ROBOFLOW_API_KEY")
    if not key:
        sys.exit("Set ROBOFLOW_API_KEY (free account: roboflow.com -> Settings -> API Keys)")
    from roboflow import Roboflow  # pip install roboflow

    rf = Roboflow(api_key=key)
    used = []
    for ds in json.loads(cfg_path.read_text(encoding="utf8")):
        try:
            proj = rf.workspace(ds["workspace"]).project(ds["project"])
            version = ds.get("version") or max(int(v.version) for v in proj.versions())
            tmp = Path(tempfile.mkdtemp())
            proj.version(version).download("yolov8", location=str(tmp))
            count = 0
            for part in ("train", "valid", "test"):
                if (tmp / part / "images").exists():
                    count += add_images(tmp / part / "images", tmp / part / "labels", dst, f"{ds['project']}")
            used.append({**ds, "version": version, "images": count})
            print(f"  {ds['workspace']}/{ds['project']} v{version}: {count} images")
        except Exception as e:  # one broken/renamed dataset must not stop the run
            print(f"  SKIPPED {ds['workspace']}/{ds['project']}: {e}")
    return used


def write_yaml(dst: Path) -> None:
    (dst / "data.yaml").write_text(
        f"path: {dst.resolve().as_posix()}\ntrain: images/train\nval: images/val\nnames:\n  0: item\n", encoding="utf8"
    )


def write_attribution(dst: Path, used: list[dict]) -> None:
    lines = ["# Training data attribution", "", "Public datasets used (check each licence before redistributing the model):", ""]
    for u in used:
        lines.append(f"- https://universe.roboflow.com/{u['workspace']}/{u['project']} (v{u['version']}, {u['images']} images, {u.get('license', 'see page')})")
    (dst / "ATTRIBUTION.md").write_text("\n".join(lines) + "\n", encoding="utf8")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("out", type=Path)
    ap.add_argument("--roboflow", action="store_true")
    ap.add_argument("--feedback", type=Path)
    ap.add_argument("--synthetic", type=int, default=0)
    a = ap.parse_args()

    used: list[dict] = []
    a.out.mkdir(parents=True, exist_ok=True)
    if a.roboflow:
        print("Roboflow datasets:")
        used = fetch_roboflow(a.out, Path(__file__).parent / "datasets.json")
    if a.feedback:
        n = add_images(a.feedback / "images", a.feedback / "labels", a.out, "user")
        print(f"feedback: {n} images")
    if a.synthetic:
        tmp = Path(tempfile.mkdtemp())
        generate(tmp, a.synthetic)
        print(f"synthetic: {add_images(tmp / 'images', tmp / 'labels', a.out, 'synth')} images")
    print(f"low-light copies: {add_low_light_copies(a.out)}")
    write_yaml(a.out)
    write_attribution(a.out, used)
    for sp in ("train", "val"):
        print(sp, len(list((a.out / "images" / sp).glob("*"))))


if __name__ == "__main__":
    main()
