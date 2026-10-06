"""Train the pipe/rebar-end detector and ship it to the app.

Needs a GPU for real runs: use a free Kaggle or Colab notebook.
    pip install ultralytics onnx onnxsim onnxruntime roboflow
    python training/prepare_data.py data/ --roboflow --synthetic 300
    python training/train_pipes.py data/ --epochs 80 --version pipes-v1

Writes app/public/models/{pipes.onnx,manifest.json}. Commit those two files to deploy the model.
Then check it with:  python training/eval_counts.py data/ app/public/models
"""
from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

MODELS = Path(__file__).resolve().parent.parent / "app" / "public" / "models"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("data", type=Path, help="folder from prepare_data.py")
    ap.add_argument("--epochs", type=int, default=80)
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--train-imgsz", type=int, help="train smaller than export size (CPU smoke tests)")
    ap.add_argument("--base", default="yolo11n.pt", help="starting weights (downloaded by ultralytics)")
    ap.add_argument("--version", required=True, help="shown in the app and stored with every feedback row")
    ap.add_argument("--conf", type=float, default=0.25)
    ap.add_argument("--iou", type=float, default=0.5)
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--device", default=None)
    ap.add_argument("--out", type=Path, default=MODELS)
    a = ap.parse_args()

    from ultralytics import YOLO

    model = YOLO(a.base)
    model.train(
        data=str(a.data / "data.yaml"), epochs=a.epochs, imgsz=a.train_imgsz or a.imgsz, batch=a.batch, device=a.device,
        # pipe ends are circles seen from any rotation, at any distance, in any light
        hsv_v=0.6, hsv_s=0.5, hsv_h=0.02, degrees=180, flipud=0.5, fliplr=0.5,
        scale=0.6, mosaic=1.0, mixup=0.1, close_mosaic=10, patience=25, project=str(a.data / "runs"), name=a.version,
    )
    best = Path(model.trainer.best)
    exported = YOLO(str(best)).export(format="onnx", imgsz=a.imgsz, opset=17, simplify=True, dynamic=False, nms=False)

    a.out.mkdir(parents=True, exist_ok=True)
    shutil.copy(exported, a.out / "pipes.onnx")
    (a.out / "manifest.json").write_text(json.dumps({
        "version": a.version, "file": "pipes.onnx", "inputSize": a.imgsz, "numClasses": 1, "conf": a.conf, "iou": a.iou,
    }, indent=2) + "\n", encoding="utf8")
    attribution = a.data / "ATTRIBUTION.md"
    if attribution.exists():
        shutil.copy(attribution, a.out / "ATTRIBUTION.md")
    size = (a.out / "pipes.onnx").stat().st_size / 1e6
    print(f"wrote {a.out / 'pipes.onnx'} ({size:.1f} MB) version={a.version}")


if __name__ == "__main__":
    main()
