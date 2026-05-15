"""YOLOv8n vehicle counting with ROI polygon containment."""
from __future__ import annotations
import io
import time
from typing import Optional

from PIL import Image
from shapely.geometry import Point, Polygon
from ultralytics import YOLO

from . import config

_model: Optional[YOLO] = None


def _get_model() -> YOLO:
    global _model
    if _model is None:
        _model = YOLO(config.YOLO_MODEL_PATH)
    return _model


def count_vehicles(image_bytes: bytes, roi_polygon: Optional[list]) -> dict:
    """Run YOLOv8n inference and return counts by class.

    Uses bottom-center of bounding box for ROI containment — more accurate
    in perspective road views than centroid.
    """
    model = _get_model()
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")

    polygon = Polygon(roi_polygon) if roi_polygon and len(roi_polygon) >= 3 else None

    t0 = time.perf_counter()
    results = model.predict(img, conf=config.YOLO_CONFIDENCE, classes=list(config.YOLO_CLASSES), verbose=False)
    elapsed_ms = int((time.perf_counter() - t0) * 1000)

    counts = {name: 0 for name in config.YOLO_CLASSES.values()}
    confidences = []

    for r in results:
        if r.boxes is None:
            continue
        for box in r.boxes:
            cls_id = int(box.cls.item())
            class_name = config.YOLO_CLASSES.get(cls_id)
            if class_name is None:
                continue
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            bottom_center = Point((x1 + x2) / 2, y2)
            if polygon is not None and not polygon.contains(bottom_center):
                continue
            counts[class_name] += 1
            confidences.append(float(box.conf.item()))

    total = sum(counts.values())
    mean_conf = round(sum(confidences) / len(confidences), 3) if confidences else None
    return {
        "vehicle_count": total,
        "vehicle_counts": counts,
        "yolo_confidence_mean": mean_conf,
        "yolo_inference_ms": elapsed_ms,
    }
