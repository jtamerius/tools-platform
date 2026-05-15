"""Flagging logic — decides which records get needs_review=True."""
from __future__ import annotations
import logging
import random
import statistics
from datetime import datetime, timezone
from typing import Iterable, Optional

import boto3
from boto3.dynamodb.conditions import Key

from . import config

logger = logging.getLogger(__name__)
_ddb = boto3.resource("dynamodb")


def _bucket(dt: datetime) -> tuple[int, int]:
    return dt.hour, dt.weekday()


def _historical_mean_std(cam_id: str, dt: datetime) -> Optional[tuple[float, float]]:
    """Mean and stddev of vehicle_count for this cam at same hour+weekday bucket.

    Scans the last 30 days. Returns None if fewer than 8 samples (not enough history).
    """
    table = _ddb.Table(config.INGEST_TABLE)
    target_hour, target_dow = _bucket(dt)
    cutoff = dt.replace(microsecond=0).isoformat().replace("+00:00", "Z")
    samples: list[float] = []
    try:
        resp = table.query(
            KeyConditionExpression=Key("pk").eq(f"CAM#{cam_id}") & Key("sk").lt(cutoff),
            Limit=2000,
            ScanIndexForward=False,
            ProjectionExpression="sk, vehicle_count, unusable",
        )
    except Exception as e:
        logger.warning("history query failed: %s", e)
        return None

    for item in resp.get("Items", []):
        if item.get("unusable"):
            continue
        try:
            ts = datetime.fromisoformat(item["sk"].rstrip("Z"))
        except ValueError:
            continue
        if ts.hour != target_hour or ts.weekday() != target_dow:
            continue
        count = item.get("vehicle_count")
        if count is None:
            continue
        samples.append(float(count))

    if len(samples) < 8:
        return None
    return statistics.mean(samples), statistics.pstdev(samples)


def evaluate(record: dict, dt: datetime) -> dict:
    """Return flags to merge into the ingest record.

    Returns keys: needs_review (bool), flag_reasons (list[str]).
    """
    reasons: list[str] = []
    count = record.get("vehicle_count")

    # 1. Vehicle count > 2 stddev from same hour+weekday bucket
    if count is not None:
        ms = _historical_mean_std(record["cam_id"], dt)
        if ms is not None:
            mean, std = ms
            if std > 0 and abs(count - mean) > config.FLAG_COUNT_STDDEV * std:
                reasons.append(f"count_outlier:n={count},mean={mean:.1f},std={std:.1f}")

    # 2. Low visibility + normal edge density (sensor/image disagreement)
    vis = record.get("rwis_visibility_mi")
    edge = record.get("img_edge_density")
    if vis is not None and edge is not None and vis < config.FLAG_VISIBILITY_MILES and edge > 0.2:
        reasons.append(f"vis_edge_disagreement:vis={vis},edge={edge}")

    # 3. YOLO confidence
    conf = record.get("yolo_confidence_mean")
    if conf is not None and conf < config.FLAG_YOLO_CONFIDENCE_MIN:
        reasons.append(f"low_yolo_confidence:{conf}")

    # 4. Periodic stratified sample (one clear-image probe per cam per day)
    # Approximate: 1-in-96 chance per 15-min tick → ~1/day per cam.
    if not reasons and random.random() < 1 / 96:
        reasons.append("daily_stratified_sample")

    # 5. Random catch-all sample (~2/day per cam → 2/96)
    if not reasons and random.random() < 2 / 96:
        reasons.append("random_qc_sample")

    return {"needs_review": bool(reasons), "flag_reasons": reasons}


def neighboring_records(target_sk: str, cam_ids: Iterable[str]) -> list[dict]:
    """Fetch records at the same sk for other cams (for agent context)."""
    table = _ddb.Table(config.INGEST_TABLE)
    out: list[dict] = []
    for cid in cam_ids:
        try:
            r = table.get_item(Key={"pk": f"CAM#{cid}", "sk": target_sk})
            if "Item" in r:
                out.append(r["Item"])
        except Exception as e:
            logger.warning("neighbor fetch failed for %s: %s", cid, e)
    return out


def last_n_for_cam(cam_id: str, before_sk: str, n: int = 3) -> list[dict]:
    table = _ddb.Table(config.INGEST_TABLE)
    try:
        resp = table.query(
            KeyConditionExpression=Key("pk").eq(f"CAM#{cam_id}") & Key("sk").lt(before_sk),
            Limit=n,
            ScanIndexForward=False,
        )
        return resp.get("Items", [])
    except Exception as e:
        logger.warning("last_n_for_cam failed: %s", e)
        return []
