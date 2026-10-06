"""Count accuracy of the SHIPPED onnx file on held-out photos, at several darkness levels.

Runs the same file the app downloads, with the same decode/NMS/letterbox maths as app/src/infer/yolo.ts
(single global pass; the app adds tiled passes for tiny items on top).

    python training/eval_counts.py data/ app/public/models
Prints MAE, % exact and % within +-1 of the true count per light level.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from degrade import degrade, mean_luma  # noqa: E402

GAINS = (1.0, 0.5, 0.25)


def letterbox(img: Image.Image, size: int):
    w, h = img.size
    s = size / max(w, h)
    nw, nh = round(w * s), round(h * s)
    canvas = Image.new("RGB", (size, size), (114, 114, 114))
    px, py = (size - nw) // 2, (size - nh) // 2
    canvas.paste(img.resize((nw, nh), Image.BILINEAR), (px, py))
    return canvas, s, px, py


def decode(out: np.ndarray, nc: int, conf: float) -> np.ndarray:
    """out: [1, 4+nc, n] -> rows of cx, cy, w, h, score above conf."""
    o = out[0]
    scores = o[4 : 4 + nc].max(axis=0)
    keep = scores >= conf
    return np.concatenate([o[:4, keep].T, scores[keep, None]], axis=1)


def nms(d: np.ndarray, thresh: float) -> np.ndarray:
    if len(d) == 0:
        return d
    d = d[np.argsort(-d[:, 4])]
    x1, y1 = d[:, 0] - d[:, 2] / 2, d[:, 1] - d[:, 3] / 2
    x2, y2 = d[:, 0] + d[:, 2] / 2, d[:, 1] + d[:, 3] / 2
    area = d[:, 2] * d[:, 3]
    alive = np.ones(len(d), bool)
    keep = []
    for i in range(len(d)):
        if not alive[i]:
            continue
        keep.append(i)
        iw = np.minimum(x2[i], x2) - np.maximum(x1[i], x1)
        ih = np.minimum(y2[i], y2) - np.maximum(y1[i], y1)
        inter = np.clip(iw, 0, None) * np.clip(ih, 0, None)
        alive &= (inter / (area[i] + area - inter)) < thresh
        alive[i] = True
    return d[keep]


def count(session, img: Image.Image, mf: dict) -> int:
    canvas, *_ = letterbox(img, mf["inputSize"])
    x = np.asarray(canvas, dtype=np.float32).transpose(2, 0, 1)[None] / 255.0
    out = session.run(None, {session.get_inputs()[0].name: x})[0]
    return len(nms(decode(out, mf["numClasses"], mf["conf"]), mf["iou"]))


def summarise(errors: list[int]) -> dict:
    e = np.array(errors)
    return {"photos": len(e), "mae": float(e.mean()), "exact": float((e == 0).mean()), "within_1": float((e <= 1).mean())}


def main() -> None:
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    import onnxruntime as ort

    data, models = Path(sys.argv[1]), Path(sys.argv[2])
    mf = json.loads((models / "manifest.json").read_text(encoding="utf8"))
    session = ort.InferenceSession(str(models / mf["file"]), providers=["CPUExecutionProvider"])
    rng = np.random.default_rng(0)
    imgs = sorted((data / "images" / "val").glob("*"))
    print(f"model {mf['version']}  val photos {len(imgs)}")
    print(f"{'light':>7}{'mean':>6}{'photos':>8}{'MAE':>8}{'exact':>8}{'+-1':>8}")
    for g in GAINS:
        errs, lumas = [], []
        for p in imgs:
            truth = len([ln for ln in (data / "labels" / "val" / (p.stem + ".txt")).read_text().splitlines() if ln.strip()])
            im = degrade(Image.open(p).convert("RGB"), g, rng)
            lumas.append(mean_luma(im))
            errs.append(abs(count(session, im, mf) - truth))
        s = summarise(errs)
        print(f"{g:>7.2f}{np.mean(lumas):>6.0f}{s['photos']:>8}{s['mae']:>8.2f}{s['exact']:>8.0%}{s['within_1']:>8.0%}")


if __name__ == "__main__":
    main()
