import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))

from degrade import degrade, mean_luma  # noqa: E402
from eval_counts import decode, letterbox, nms, summarise  # noqa: E402
from prepare_data import add_images, add_low_light_copies, remap_label_file, split_name  # noqa: E402
from synth import generate, make_scene, to_yolo  # noqa: E402


class Degrade(unittest.TestCase):
    def test_darker_gain_gives_darker_noisier_image(self):
        img, _ = make_scene(np.random.default_rng(1))
        rng = np.random.default_rng(2)
        l1, l5, l25 = (mean_luma(degrade(img, g, rng)) for g in (1.0, 0.5, 0.25))
        self.assertGreater(l1, l5)
        self.assertGreater(l5, l25)
        self.assertAlmostEqual(l25 / l1, 0.25, delta=0.1)

    def test_full_light_is_a_copy(self):
        img, _ = make_scene(np.random.default_rng(1))
        self.assertTrue((np.asarray(degrade(img, 1.0, np.random.default_rng(0))) == np.asarray(img)).all())


class Synth(unittest.TestCase):
    def test_labels_match_pipes_and_stay_in_frame(self):
        img, pipes = make_scene(np.random.default_rng(3))
        self.assertGreaterEqual(len(pipes), 6)
        lines = to_yolo(pipes, img.width)
        self.assertEqual(len(lines), len(pipes))
        for ln in lines:
            _, cx, cy, w, h = map(float, ln.split())
            self.assertTrue(0 < cx - w / 2 and cx + w / 2 < 1 and 0 < cy - h / 2 and cy + h / 2 < 1)

    def test_pipes_do_not_overlap(self):
        _, pipes = make_scene(np.random.default_rng(4))
        for i, (x, y, r) in enumerate(pipes):
            for x2, y2, r2 in pipes[i + 1 :]:
                self.assertGreater(np.hypot(x - x2, y - y2), 0.79 * (r + r2))


class PrepareData(unittest.TestCase):
    def test_all_classes_collapse_to_zero_and_extras_dropped(self):
        self.assertEqual(remap_label_file("3 0.5 0.5 0.1 0.1\n7 0.2 0.2 0.05 0.05 0.1 0.1 0.2 0.2\n\n"),
                         "0 0.5 0.5 0.1 0.1\n0 0.2 0.2 0.05 0.05")

    def test_split_is_stable_and_about_ten_percent(self):
        self.assertEqual(split_name("a/b"), split_name("a/b"))
        val = sum(split_name(f"x/{i}") == "val" for i in range(3000))
        self.assertTrue(200 < val < 400, val)

    def test_merge_then_low_light_copies_only_train(self):
        with tempfile.TemporaryDirectory() as t:
            src, dst = Path(t) / "src", Path(t) / "dst"
            generate(src, 40, seed=7)
            n = add_images(src / "images", src / "labels", dst, "s")
            self.assertEqual(n, 40)
            before = len(list((dst / "images" / "train").glob("*")))
            val_before = len(list((dst / "images" / "val").glob("*")))
            made = add_low_light_copies(dst)
            self.assertEqual(made, before * 2)
            self.assertEqual(len(list((dst / "images" / "val").glob("*"))), val_before)
            for img in (dst / "images" / "train").glob("*_ll*"):
                self.assertTrue((dst / "labels" / "train" / (img.stem + ".txt")).exists())


class EvalMaths(unittest.TestCase):
    def test_letterbox_pads_to_square(self):
        canvas, s, px, py = letterbox(Image.new("RGB", (200, 100)), 64)
        self.assertEqual(canvas.size, (64, 64))
        self.assertAlmostEqual(s, 0.32)
        self.assertEqual((px, py), (0, 16))

    def test_decode_and_nms(self):
        # 3 anchors: two near-duplicates and one far away, plus one below threshold
        out = np.array([[[10, 11, 80, 40], [10, 10, 80, 40], [8, 8, 8, 8], [8, 8, 8, 8], [0.9, 0.8, 0.7, 0.1]]], dtype=np.float32)
        out = out.transpose(0, 1, 2)  # [1, 5, 4]
        d = decode(out, 1, 0.25)
        self.assertEqual(len(d), 3)
        self.assertEqual(len(nms(d, 0.5)), 2)

    def test_summarise(self):
        s = summarise([0, 0, 1, 3])
        self.assertEqual(s["mae"], 1.0)
        self.assertEqual(s["exact"], 0.5)
        self.assertEqual(s["within_1"], 0.75)


if __name__ == "__main__":
    unittest.main()
