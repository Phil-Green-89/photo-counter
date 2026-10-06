"""Make a photo look like it was taken in poor light.

Real low-light phone photos are not just darker: the sensor gain is turned up (so noise grows as the
light drops), exposure gets longer (so motion/focus blur creeps in) and colours wash out.
Used to (a) add low-light copies of every training image and (b) measure accuracy at set darkness levels.
"""
from __future__ import annotations

import numpy as np
from PIL import Image, ImageFilter


def degrade(img: Image.Image, gain: float, rng: np.random.Generator, blur: float | None = None) -> Image.Image:
    """gain 1.0 = unchanged, 0.25 = a quarter of the light."""
    if gain >= 0.999:
        return img.copy()
    a = np.asarray(img.convert("RGB"), dtype=np.float32)
    a = a * gain
    # colours wash toward grey as light drops
    grey = a.mean(axis=2, keepdims=True)
    a = grey + (a - grey) * (0.5 + 0.5 * gain)
    # noise grows as light drops (sensor gain is turned up to compensate)
    sigma = 2.0 + 14.0 * (1.0 - gain)
    a = a + rng.normal(0.0, sigma, a.shape).astype(np.float32)
    out = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    radius = (1.5 * (1.0 - gain)) if blur is None else blur
    if radius > 0.05:
        out = out.filter(ImageFilter.GaussianBlur(radius))
    return out


def mean_luma(img: Image.Image) -> float:
    return float(np.asarray(img.convert("L"), dtype=np.float32).mean())
