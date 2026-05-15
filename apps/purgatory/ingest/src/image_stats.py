"""Pillow-based image quality proxy stats."""
from __future__ import annotations
import io
from typing import Tuple

import numpy as np
from PIL import Image, ImageFilter


def compute_stats(image_bytes: bytes) -> dict:
    img = Image.open(io.BytesIO(image_bytes)).convert("L")
    arr = np.asarray(img, dtype=np.float32) / 255.0

    mean = float(arr.mean())
    var = float(arr.var())

    sobel = img.filter(ImageFilter.FIND_EDGES)
    edge_arr = np.asarray(sobel, dtype=np.float32) / 255.0
    edge_density = float((edge_arr > 0.1).mean())

    return {
        "img_mean_brightness": round(mean, 4),
        "img_brightness_variance": round(var, 4),
        "img_edge_density": round(edge_density, 4),
    }


def image_size(image_bytes: bytes) -> Tuple[int, int]:
    img = Image.open(io.BytesIO(image_bytes))
    return img.size  # (w, h)
