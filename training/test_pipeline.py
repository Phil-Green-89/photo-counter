import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "training"))
sys.path.insert(0, str(ROOT / "eval"))

from export_dataset import dots_to_yolo, split_of  # noqa: E402
from report import summarise  # noqa: E402


class DotsToYolo(unittest.TestCase):
    def test_box_is_centred_on_dot_and_normalised(self):
        (line,) = dots_to_yolo([{"x": 100, "y": 50}], 20, 10, 200, 100)
        cls, cx, cy, w, h = line.split()
        self.assertEqual(cls, "0")
        self.assertAlmostEqual(float(cx), 0.5)
        self.assertAlmostEqual(float(cy), 0.5)
        self.assertAlmostEqual(float(w), 0.1)
        self.assertAlmostEqual(float(h), 0.1)

    def test_clips_at_image_edge(self):
        (line,) = dots_to_yolo([{"x": 2, "y": 50}], 20, 10, 200, 100)
        _, cx, _, w, _ = map(float, line.split())
        self.assertAlmostEqual(w, 12 / 200)  # x from 0 to 12
        self.assertAlmostEqual(cx, 6 / 200)

    def test_drops_boxes_that_fall_outside(self):
        self.assertEqual(dots_to_yolo([{"x": 500, "y": 50}], 20, 10, 200, 100), [])


class Split(unittest.TestCase):
    def test_same_device_always_same_split(self):
        self.assertEqual(split_of("abc"), split_of("abc"))

    def test_roughly_ten_percent_validation(self):
        val = sum(split_of(f"device-{i}") == "val" for i in range(2000))
        self.assertTrue(120 < val < 280, val)


class Report(unittest.TestCase):
    def rec(self, bucket, model, final, up=None):
        return {"lighting_bucket": bucket, "model_version": "v0",
                "model_dots": [0] * model, "final_dots": [0] * final, "thumbs_up": up}

    def test_groups_by_lighting_and_scores_errors(self):
        rows = summarise([
            self.rec("good", 10, 10, True), self.rec("good", 10, 11, True),
            self.rec("poor", 10, 15, False), self.rec("poor", 10, 10, None),
        ])
        by = {r["bucket"]: r for r in rows}
        self.assertEqual([r["bucket"] for r in rows], ["good", "poor"])
        self.assertEqual(by["good"]["within_1"], 1.0)
        self.assertEqual(by["good"]["exact"], 0.5)
        self.assertEqual(by["poor"]["mae"], 2.5)
        self.assertEqual(by["poor"]["thumbs_up"], 0.0)


if __name__ == "__main__":
    unittest.main()
