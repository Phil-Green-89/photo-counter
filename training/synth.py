"""Synthetic bundles of pipe ends with exact labels.

Not a replacement for real photos: it exists so the whole train -> export -> in-browser pipeline can be
exercised and regression-tested without any download, and it can pad real data with extra dense/tiny cases.

    python training/synth.py out_dir 200      # writes out_dir/{images,labels}/*, 640px, one class
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

RIMS = [(201, 123, 58), (190, 190, 195), (235, 235, 230), (60, 90, 160), (150, 150, 150)]  # copper, steel, PVC, blue, grey


def _pipe(d: ImageDraw.ImageDraw, cx: float, cy: float, r: float, rim: tuple[int, int, int], rng) -> None:
    shade = int(rng.integers(-25, 25))
    col = tuple(int(np.clip(c + shade, 0, 255)) for c in rim)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=col)
    wall = r * float(rng.uniform(0.18, 0.4))
    hole = (int(rng.integers(8, 40)),) * 3
    d.ellipse([cx - r + wall, cy - r + wall, cx + r - wall, cy + r - wall], fill=hole)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=tuple(max(0, c - 60) for c in col), width=max(1, int(r / 14)))


def make_scene(rng: np.random.Generator, size: int = 640):
    """Returns (PIL image, [(cx, cy, r), ...])."""
    bg = int(rng.integers(40, 120))
    base = np.full((size, size, 3), bg, dtype=np.float32)
    base += rng.normal(0, 10, (size, size, 1)).astype(np.float32)  # dirt / texture
    img = Image.fromarray(np.clip(base, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(2))
    d = ImageDraw.Draw(img)

    pipes: list[tuple[float, float, float]] = []
    for _ in range(int(rng.integers(1, 3))):  # one or two bundles per photo
        r = float(rng.uniform(9, 46))
        cols = int(rng.integers(3, max(4, int(size * 0.8 / (2 * r)))))
        rows = int(rng.integers(2, max(3, int(size * 0.8 / (2 * r)))))
        pitch = 2 * r * float(rng.uniform(1.02, 1.12))
        x0 = float(rng.uniform(0.05, 0.3) * size)
        y0 = float(rng.uniform(0.05, 0.3) * size)
        rim = RIMS[int(rng.integers(len(RIMS)))]
        for j in range(rows):
            for i in range(cols):
                cx = x0 + r + i * pitch + (pitch / 2 if j % 2 else 0) + rng.normal(0, r * 0.03)
                cy = y0 + r + j * pitch * 0.88 + rng.normal(0, r * 0.03)
                if cx + r > size or cy + r > size:
                    continue
                if any(np.hypot(cx - px, cy - py) < 0.8 * (r + pr) for px, py, pr in pipes):
                    continue  # second bundle overlapping the first
                pipes.append((cx, cy, r))
                _pipe(d, cx, cy, r, rim, rng)
    return img, pipes


def to_yolo(pipes, size: int) -> list[str]:
    return [f"0 {cx / size:.6f} {cy / size:.6f} {2 * r / size:.6f} {2 * r / size:.6f}" for cx, cy, r in pipes]


def generate(out: Path, n: int, seed: int = 0, size: int = 640) -> None:
    rng = np.random.default_rng(seed)
    (out / "images").mkdir(parents=True, exist_ok=True)
    (out / "labels").mkdir(parents=True, exist_ok=True)
    for i in range(n):
        img, pipes = make_scene(rng, size)
        if not pipes:
            continue
        img.save(out / "images" / f"synth_{i:04d}.jpg", quality=92)
        (out / "labels" / f"synth_{i:04d}.txt").write_text("\n".join(to_yolo(pipes, size)), encoding="utf8")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    generate(Path(sys.argv[1]), int(sys.argv[2]))
    print("done")
