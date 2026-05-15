"""Ingest Lambda handler — one invocation per cam per 15-min tick.

EventBridge passes {"cam_id": "..."} as the input. Each cam_id is fanned out
across parallel invocations so heavy work (YOLO) stays single-purpose.
"""
from __future__ import annotations
import logging
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

import boto3
import requests

from . import agent, config, cotrip, flagging, image_stats, solar, yolo_count

logging.basicConfig(level=config.LOG_LEVEL, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)

_ddb = boto3.resource("dynamodb")
_s3 = boto3.client("s3")


def _now_iso() -> str:
    return datetime.now(tz=timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _round_to_quarter(dt: datetime) -> datetime:
    minute = (dt.minute // 15) * 15
    return dt.replace(minute=minute, second=0, microsecond=0)


def _floats_to_decimal(obj):
    if isinstance(obj, float):
        return Decimal(str(obj))
    if isinstance(obj, dict):
        return {k: _floats_to_decimal(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_floats_to_decimal(v) for v in obj]
    return obj


def _load_cam_config(cam_id: str) -> Optional[dict]:
    table = _ddb.Table(config.CAM_CONFIG_TABLE)
    r = table.get_item(Key={"cam_id": cam_id})
    return r.get("Item")


def _fetch_image(url: str) -> bytes:
    r = requests.get(url, timeout=15)
    r.raise_for_status()
    return r.content


def _all_active_cam_ids(exclude: str) -> list[str]:
    table = _ddb.Table(config.CAM_CONFIG_TABLE)
    r = table.scan(
        FilterExpression="active = :a AND cam_type = :t AND cam_id <> :ex",
        ExpressionAttributeValues={":a": True, ":t": "traffic", ":ex": exclude},
        ProjectionExpression="cam_id",
    )
    return [item["cam_id"] for item in r.get("Items", [])]


def process(cam_id: str) -> dict:
    cfg = _load_cam_config(cam_id)
    if not cfg:
        raise ValueError(f"Unknown cam_id: {cam_id}")
    if not cfg.get("active"):
        return {"skipped": "inactive", "cam_id": cam_id}

    now = datetime.now(tz=timezone.utc)
    sk = _round_to_quarter(now).isoformat().replace("+00:00", "Z")
    fetched_at = _now_iso()

    record: dict = {
        "pk": f"CAM#{cam_id}",
        "sk": sk,
        "cam_id": cam_id,
        "fetched_at": fetched_at,
        "roi_version": int(cfg.get("roi_version") or 0),
        "unusable": False,
        "needs_review": False,
        "agent_decision": None,
        "agent_confidence": None,
        "agent_reasoning": None,
        "agent_decision_source": None,
        "agent_prompt_version": config.AGENT_PROMPT_VERSION,
        "agent_review_required": False,
        "consecutive_issue_count": 0,
        "consecutive_issue_started": None,
        "traffic_score": None,
        "traffic_score_cohort": None,
        "traffic_score_sample_n": None,
    }

    cam_type = cfg.get("cam_type", "traffic")

    # ── RWIS — fetch once per tick, attached to RWIS-only and partner cam ─────
    if cam_type == "rwis_only" or cam_id == config.RWIS_PARTNER_CAM:
        rwis = cotrip.fetch_rwis(cfg.get("rwis_station_id") or config.RWIS_STATION_ID)
        record.update(rwis)

    if cam_type == "rwis_only":
        _write(record)
        return {"ok": True, "cam_id": cam_id, "rwis_only": True}

    # ── Image fetch + S3 ─────────────────────────────────────────────────────
    image_url = cfg.get("image_url")
    filename = cfg.get("filename")
    if not image_url:
        raise ValueError(f"No image_url for {cam_id}")

    image_bytes = _fetch_image(image_url)
    s3_key = f"raw/{cam_id}/{sk}.jpg"
    _s3.put_object(
        Bucket=config.S3_BUCKET,
        Key=s3_key,
        Body=image_bytes,
        ContentType="image/jpeg",
    )
    record["s3_key"] = s3_key
    record["s3_tier"] = "STANDARD"

    # image_captured_at from GraphQL cache-buster
    image_captured_at = cotrip.fetch_image_captured_at(cfg.get("cotrip_cam_id", ""), filename or "")
    if image_captured_at:
        record["image_captured_at"] = image_captured_at

    # ── YOLO + image stats + solar ───────────────────────────────────────────
    yolo_result = yolo_count.count_vehicles(image_bytes, cfg.get("roi_polygon"))
    record.update(yolo_result)
    record.update(image_stats.compute_stats(image_bytes))

    record.update(solar.solar_position(float(cfg["lat"]), float(cfg["lon"]), now))

    # ── Flagging ─────────────────────────────────────────────────────────────
    flag = flagging.evaluate(record, now)
    record.update(flag)

    # ── Agent decision (only on flagged records) ─────────────────────────────
    if record["needs_review"]:
        last_n = flagging.last_n_for_cam(cam_id, sk, n=3)
        neighbors = flagging.neighboring_records(sk, _all_active_cam_ids(exclude=cam_id))
        agent_out = agent.decide(record, last_n, neighbors, s3_key)
        record.update(agent_out)
        if agent_out.get("agent_decision") == "unusable":
            record["unusable"] = True

    _write(record)
    return {"ok": True, "cam_id": cam_id, "needs_review": record["needs_review"]}


def _write(record: dict):
    table = _ddb.Table(config.INGEST_TABLE)
    table.put_item(Item=_floats_to_decimal(record))


def handler(event, context):
    cam_id = event.get("cam_id") if isinstance(event, dict) else None
    if not cam_id:
        # EventBridge fanout: if invoked with no cam_id, kick off every active cam.
        table = _ddb.Table(config.CAM_CONFIG_TABLE)
        r = table.scan(
            FilterExpression="active = :a",
            ExpressionAttributeValues={":a": True},
            ProjectionExpression="cam_id",
        )
        lam = boto3.client("lambda")
        fn_name = context.function_name if context else None
        results = []
        for item in r.get("Items", []):
            if fn_name:
                lam.invoke(
                    FunctionName=fn_name,
                    InvocationType="Event",
                    Payload=f'{{"cam_id": "{item["cam_id"]}"}}'.encode(),
                )
            results.append(item["cam_id"])
        return {"fanout": results}

    try:
        return process(cam_id)
    except Exception as e:
        logger.exception("ingest failed for %s", cam_id)
        return {"error": str(e), "cam_id": cam_id}
