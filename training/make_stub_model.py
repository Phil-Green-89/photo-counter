"""Build a tiny ONNX file shaped like a YOLOv8/11 export ([1, 5, N]) that always "detects" a fixed
5x4 lattice. Used by the Playwright tests to exercise model loading, ORT-web, decoding and the
un-letterbox maths without shipping a real (10 MB) model.

    python training/make_stub_model.py app/e2e/fixtures/stub-pipes.onnx
"""
import sys

import numpy as np
import onnx
from onnx import TensorProto, helper

COLS, ROWS, BOX = 5, 4, 60
SIZE = 640


def build() -> onnx.ModelProto:
    cx, cy = [], []
    for j in range(ROWS):
        for i in range(COLS):
            cx.append(80 + i * 120)
            cy.append(100 + j * 120)
    n = COLS * ROWS
    head = np.array([cx, cy, [BOX] * n, [BOX] * n, [0.9] * n], dtype=np.float32)[None]  # [1, 5, n]
    const = helper.make_tensor("head", TensorProto.FLOAT, head.shape, head.flatten().tolist())
    node = helper.make_node("Constant", [], ["output0"], value=const)
    graph = helper.make_graph(
        [node], "stub",
        [helper.make_tensor_value_info("images", TensorProto.FLOAT, [1, 3, SIZE, SIZE])],
        [helper.make_tensor_value_info("output0", TensorProto.FLOAT, list(head.shape))],
    )
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)])
    model.ir_version = 8
    onnx.checker.check_model(model)
    return model


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "stub-pipes.onnx"
    onnx.save(build(), out)
    print(f"wrote {out} ({COLS * ROWS} fixed detections)")
