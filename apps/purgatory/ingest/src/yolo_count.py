"""YOLOv8n vehicle counting with ROI zone containment and S3 model loading."""
from __future__ import annotations
import io
import json
import os
import tempfile
import time
from typing import Optional

import boto3
from PIL import Image
from shapely.geometry import Point, Polygon
from ultralytics import YOLO

from . import config

# Cache: s3_key (or None for baked-in) → YOLO instance
_model_cache: dict[str | None, YOLO] = {}
_s3 = boto3.client("s3")


def _get_model(s3_key: Optional[str] = None) -> YOLO:
    if s3_key not in _model_cache:
        if s3_key:
            tmp = tempfile.NamedTemporaryFile(suffix=".pt", delete=False)
            try:
                _s3.download_fileobj(config.S3_BUCKET, s3_key, tmp)
                tmp.close()
                _model_cache[s3_key] = YOLO(tmp.name)
            finally:
                try:
                    os.unlink(tmp.name)
                except OSError:
                    pass
        else:
            _model_cache[None] = YOLO(config.YOLO_MODEL_PATH)
    return _model_cache[s3_key]


def _load_inference_params(s3_key: Optional[str]) -> dict:
    """Load inference params from metadata.json alongside the model .pt."""
    if not s3_key:
        return config.YOLO_DEFAULT_INFERENCE.copy()
    meta_key = s3_key.replace("model.pt", "metadata.json")
    try:
        obj = _s3.get_object(Bucket=config.S3_BUCKET, Key=meta_key)
        meta = json.loads(obj["Body"].read())
        return {**config.YOLO_DEFAULT_INFERENCE, **meta.get("inference", {})}
    except Exception:
        return config.YOLO_DEFAULT_INFERENCE.copy()


def count_vehicles(image_bytes: bytes, zones: Optional[list] = None, roi_polygon: Optional[list] = None, model_s3_key: Optional[str] = None) -> dict:
    """Run YOLOv8n inference and return counts by class and zone.

    `zones` is a list of dicts: [{name, polygon, ...}, ...]. When provided,
    each detection is assigned to the first zone whose polygon contains its
    bottom-center point. `roi_polygon` is kept for backward compat.

    Uses bottom-center of bounding box for ROI containment — more accurate
    in perspective road views than centroid.
    """
    model = _get_model(model_s3_key)
    infer = _load_inference_params(model_s3_key)
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")

    # Build zone polygons. Fall back to legacy roi_polygon if no zones given.
    zone_shapes: list[tuple[str, Polygon]] = []
    if zones:
        for z in zones:
            pts = z.get("polygon", [])
            if pts and len(pts) >= 3:
                zone_shapes.append((z["name"], Polygon(pts)))
    legacy_polygon = Polygon(roi_polygon) if (not zone_shapes and roi_polygon and len(roi_polygon) >= 3) else None

    t0 = time.perf_counter()
    results = model.predict(
        img,
        conf=infer["conf"],
        iou=infer["iou"],
        agnostic_nms=infer["agnostic_nms"],
        max_det=infer["max_det"],
        classes=list(config.YOLO_CLASSES),
        verbose=False,
    )
    elapsed_ms = int((time.perf_counter() - t0) * 1000)

    counts_by_zone: dict[str, int] = {name: 0 for name, _ in zone_shapes}
    confidences: list[float] = []
    total = 0

    for r in results:
        if r.boxes is None:
            continue
        for box in r.boxes:
            if int(box.cls.item()) not in config.YOLO_CLASSES:
                continue
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            pt = Point((x1 + x2) / 2, y2)

            if zone_shapes:
                for zone_name, poly in zone_shapes:
                    if poly.contains(pt):
                        counts_by_zone[zone_name] += 1
                        total += 1
                        break
            elif legacy_polygon is not None:
                if not legacy_polygon.contains(pt):
                    continue
                else:
                    total += 1
            else:
                total += 1

            confidences.append(float(box.conf.item()))

    mean_conf = round(sum(confidences) / len(confidences), 3) if confidences else None
    out: dict = {
        "vehicle_count": total,
        "yolo_confidence_mean": mean_conf,
        "yolo_inference_ms": elapsed_ms,
    }
    if zone_shapes:
        out["vehicle_counts_by_zone"] = counts_by_zone
    return out
