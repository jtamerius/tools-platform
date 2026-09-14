"""lambda_function.py — AWS Lambda handler for daily ensemble forecast collection.

Triggered on a staggered 2-minute schedule by 9 EventBridge rules (one per API call).
Each fetch invocation collects raw data for one (model, fetch_type) pair and writes a
partial result to S3.  The final assembler invocation reads all partials, assembles
complete ForecastResult dicts, and uploads the final JSON + HTML.

Dispatch is via the ``task`` key in the EventBridge Input payload:
  {"task": "fetch",    "model": "gfs_seamless", "fetch_type": "det"}
  {"task": "fetch",    "model": "gfs_seamless", "fetch_type": "ens"}
  {"task": "assemble"}

Schedule (UTC, repeated at 00:xx and 12:xx daily):
  +00 min  fetch gfs_seamless   det
  +02 min  fetch ecmwf_ifs025   det
  +04 min  fetch icon_seamless  det
  +06 min  fetch gem_global     det
  +08 min  fetch gfs_hrrr       det
  +12 min  fetch gfs_seamless   ens
  +14 min  fetch ecmwf_ifs025   ens
  +16 min  fetch icon_seamless  ens
  +18 min  fetch gem_global     ens
  +30 min  assemble

S3 key layout::

    partial/{run_id}/{model}_{fetch_type}.json   ← one per (model, fetch_type) pair
    forecasts/{lat:.4f}_{lon:.4f}/{run_id}.json  ← assembled per-location result
    locations/manifest.json
    grid_summary/{run_id}.json
    weather/index.html

Environment variables:
    S3_BUCKET     — target bucket name (required)
    CDN_DOMAIN    — custom domain serving the site (e.g. jtamerius.com)
    MAX_WORKERS   — thread pool size for S3 uploads (default: 10)

``boto3`` is pre-installed in the Lambda Python runtime.
The ``ingestion/`` package uses stdlib only (no third-party deps).
"""
from __future__ import annotations

import json
import logging
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import boto3

from ingestion import fetch_model_grid
from ingestion.fetcher import _assemble_result, DEFAULT_MODELS
from clustering.events import detect_storm_events

logger = logging.getLogger()
logger.setLevel(logging.INFO)

s3 = boto3.client("s3")

_LOCATIONS_FILE = Path(__file__).parent / "locations.json"

# All (model, fetch_type) pairs — must match the EventBridge schedule.
_FETCH_PAIRS = [
    ("gfs_seamless",          "det"),
    ("ecmwf_ifs025",          "det"),
    ("icon_seamless",         "det"),
    ("gem_global",            "det"),
    ("gfs_hrrr",              "det"),
    ("gfs_seamless",          "ens"),
    ("ecmwf_ifs025",          "ens"),
    ("icon_seamless",         "ens"),
    ("gem_global",            "ens"),
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _load_locations() -> list[dict]:
    with _LOCATIONS_FILE.open() as f:
        return json.load(f)["locations"]


def _run_id() -> str:
    now = datetime.now(timezone.utc)
    snapped_hour = 12 if now.hour >= 12 else 0
    return now.strftime("%Y-%m-%dT") + f"{snapped_hour:02d}"


def _partial_key(run_id: str, model: str, fetch_type: str) -> str:
    return f"partial/{run_id}/{model}_{fetch_type}.json"


def _s3_key(lat: float, lon: float, run_id: str) -> str:
    return f"forecasts/{lat:.4f}_{lon:.4f}/{run_id}.json"


def _s3_put_json(bucket: str, key: str, obj: object, cache_control: str = "") -> None:
    kwargs: dict = dict(
        Bucket=bucket, Key=key,
        Body=json.dumps(obj, separators=(",", ":")).encode("utf-8"),
        ContentType="application/json",
    )
    if cache_control:
        kwargs["CacheControl"] = cache_control
    s3.put_object(**kwargs)


def _s3_get_json(bucket: str, key: str) -> Optional[object]:
    try:
        resp = s3.get_object(Bucket=bucket, Key=key)
        return json.loads(resp["Body"].read())
    except s3.exceptions.NoSuchKey:
        return None
    except Exception as exc:
        logger.warning("Failed to read s3://%s/%s: %s", bucket, key, exc)
        return None


def _key_exists(bucket: str, key: str) -> bool:
    try:
        s3.head_object(Bucket=bucket, Key=key)
        return True
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Fetch handler — one (model, fetch_type) pair
# ---------------------------------------------------------------------------

def _fetch_handler(event: dict) -> dict:
    """Fetch raw data for one model/fetch_type pair and write partial to S3."""
    bucket     = os.environ["S3_BUCKET"]
    model      = event["model"]
    fetch_type = event["fetch_type"]
    run_id     = _run_id()
    key        = _partial_key(run_id, model, fetch_type)

    if _key_exists(bucket, key):
        logger.info("Partial already exists, skipping: %s", key)
        return {"run_id": run_id, "model": model, "fetch_type": fetch_type, "skipped": True}

    locations = _load_locations()
    logger.info("Fetching %s/%s for %d locations (run_id=%s)", model, fetch_type, len(locations), run_id)

    raw_items = fetch_model_grid(locations, model, fetch_type)

    items = [
        {"lat": loc["lat"], "lon": loc["lon"], "raw": raw, "ok": raw is not None}
        for loc, raw in zip(locations, raw_items)
    ]
    ok_count = sum(1 for it in items if it["ok"])
    logger.info("Fetch complete: %d/%d locations ok", ok_count, len(locations))

    partial = {"run_id": run_id, "model": model, "fetch_type": fetch_type, "items": items}
    _s3_put_json(bucket, key, partial)
    logger.info("Wrote partial to s3://%s/%s", bucket, key)

    return {"run_id": run_id, "model": model, "fetch_type": fetch_type, "ok": ok_count, "total": len(locations)}


# ---------------------------------------------------------------------------
# Assemble handler — read all partials, build final per-location results
# ---------------------------------------------------------------------------

def _assemble_handler(_event: dict) -> dict:
    """Read all partial S3 files, assemble ForecastResult per location, upload finals."""
    bucket   = os.environ["S3_BUCKET"]
    run_id   = _run_id()
    all_locs = _load_locations()
    n        = len(all_locs)
    fetched_at = datetime.now(timezone.utc).isoformat()

    # ── Load all partial files ───────────────────────────────────────────────
    # raw_by_loc_det[i][model] = raw API dict or None
    # raw_by_loc_ens[i][model] = raw API dict or None
    raw_by_loc_det: list[dict[str, dict]] = [{} for _ in range(n)]
    raw_by_loc_ens: list[dict[str, dict]] = [{} for _ in range(n)]

    for model, fetch_type in _FETCH_PAIRS:
        key  = _partial_key(run_id, model, fetch_type)
        data = _s3_get_json(bucket, key)
        if data is None:
            logger.warning("Partial missing — %s/%s will be excluded", model, fetch_type)
            continue

        target = raw_by_loc_det if fetch_type == "det" else raw_by_loc_ens
        for i, item in enumerate(data.get("items", [])):
            if i >= n:
                break
            if item.get("ok") and item.get("raw"):
                target[i][model] = item["raw"]

    # ── Assemble, detect events, store (parallel S3 writes) ─────────────────
    existing_keys = _existing_keys_for_run(bucket, run_id)

    def _assemble_one(args):
        i, loc = args
        final_key = _s3_key(loc["lat"], loc["lon"], run_id)
        if final_key in existing_keys:
            return {"name": loc["name"], "status": "skipped"}, None

        result = _assemble_result(
            loc["lat"], loc["lon"],
            raw_by_loc_det[i],
            raw_by_loc_ens[i],
            fetched_at,
        )

        if result.get("error"):
            logger.error("Assemble failed for %s: %s", loc["name"], result.get("message"))
            return {"name": loc["name"], "status": "error", "message": result.get("message")}, None

        try:
            result["events"] = detect_storm_events(result)
        except Exception as exc:
            logger.warning("Event detection failed for %s: %s", loc["name"], exc)
            result["events"] = []

        _s3_put_json(bucket, final_key, result)
        return {"name": loc["name"], "status": "ok"}, (loc, result)

    max_workers = int(os.environ.get("MAX_WORKERS", "10"))
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        outcomes = list(pool.map(_assemble_one, enumerate(all_locs)))

    all_statuses   = [status for status, _ in outcomes]
    all_loc_results = [pair for _, pair in outcomes if pair is not None]

    # ── Upload manifest, grid summary, HTML ─────────────────────────────────
    _upload_manifest(bucket, all_locs)

    summary = _compute_grid_summary(run_id, all_loc_results)
    _upload_grid_summary(bucket, run_id, summary)

    cdn_domain = os.environ.get("CDN_DOMAIN", "")
    _upload_weather_html(bucket, cdn_domain, all_locs, all_loc_results)

    ok      = sum(1 for s in all_statuses if s["status"] == "ok")
    skipped = sum(1 for s in all_statuses if s["status"] == "skipped")
    errors  = [s for s in all_statuses if s["status"] == "error"]

    logger.info("Assemble complete: %d ok, %d skipped, %d errors", ok, skipped, len(errors))
    for e in errors:
        logger.warning("  FAILED: %s — %s", e["name"], e.get("message", "?"))

    return {
        "statusCode": 200,
        "body": json.dumps({
            "run_id":  run_id,
            "total":   n,
            "ok":      ok,
            "skipped": skipped,
            "errors":  len(errors),
            "failed":  [e["name"] for e in errors],
        }),
    }


# ---------------------------------------------------------------------------
# Idempotency helpers
# ---------------------------------------------------------------------------

def _existing_keys_for_run(bucket: str, run_id: str) -> set[str]:
    existing: set[str] = set()
    suffix = f"/{run_id}.json"
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix="forecasts/"):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            if key.endswith(suffix):
                existing.add(key)
    return existing


# ---------------------------------------------------------------------------
# Grid summary
# ---------------------------------------------------------------------------

def _compute_grid_summary(run_id: str, loc_results: list[tuple[dict, dict]]) -> dict:
    all_days: set[str] = set()
    for _, result in loc_results:
        for t in result.get("hourly", {}).get("time", []):
            all_days.add(t[:10])

    days = sorted(all_days)[:10]
    points = []
    for loc, result in loc_results:
        hourly = result.get("hourly", {})
        times  = hourly.get("time", [])
        precip_by_model: dict = hourly.get("precipitation", {})

        daily_precip = []
        for day in days:
            day_totals = []
            for model_values in precip_by_model.values():
                day_sum = sum(
                    (v if v is not None else 0.0)
                    for t, v in zip(times, model_values)
                    if t[:10] == day
                )
                day_totals.append(day_sum)
            avg = sum(day_totals) / len(day_totals) if day_totals else 0.0
            daily_precip.append(round(avg, 3))

        points.append({"lat": loc["lat"], "lon": loc["lon"], "daily_precip": daily_precip})

    return {
        "run_id":     run_id,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "days":       days,
        "points":     points,
    }


def _upload_grid_summary(bucket: str, run_id: str, summary: dict) -> None:
    key = f"grid_summary/{run_id}.json"
    _s3_put_json(bucket, key, summary)
    logger.info("Uploaded grid summary (%d points) to s3://%s/%s",
                len(summary.get("points", [])), bucket, key)


# ---------------------------------------------------------------------------
# Manifest
# ---------------------------------------------------------------------------

def _upload_manifest(bucket: str, locations: list[dict]) -> None:
    _s3_put_json(bucket, "locations/manifest.json", {"locations": locations})
    logger.info("Uploaded manifest (%d locations)", len(locations))


# ---------------------------------------------------------------------------
# HTML generation
# ---------------------------------------------------------------------------

def _upload_weather_html(
    bucket: str,
    cdn_domain: str,
    all_locs: list[dict],
    loc_results: list[tuple[dict, dict]],
) -> None:
    try:
        from visualization.precip_interactive import _build_lambda_html

        # Always use Durango as default; fetch from S3 if not in current run's results
        default_result: dict | None = None
        default_loc: dict | None = None
        for loc, result in loc_results:
            if loc.get("name") == "Durango":
                default_result = result
                default_loc = loc
                break

        if default_result is None:
            durango = next((l for l in all_locs if l.get("name") == "Durango"), all_locs[0])
            prefix = f"forecasts/{durango['lat']:.4f}_{durango['lon']:.4f}/"
            resp = s3.list_objects_v2(Bucket=bucket, Prefix=prefix)
            keys = sorted(obj["Key"] for obj in resp.get("Contents", []))
            if not keys:
                logger.warning("No S3 data for Durango — skipping weather/index.html")
                return
            obj = s3.get_object(Bucket=bucket, Key=keys[-1])
            default_result = json.loads(obj["Body"].read())
            default_loc = durango

        events    = detect_storm_events(default_result)
        locations = [{"name": l["name"], "state": l.get("state", ""),
                      "lat": l["lat"], "lon": l["lon"]} for l in all_locs]
        lat       = default_loc["lat"]
        lon       = default_loc["lon"]
        lon_label = f"{abs(lon):.4f}°W" if lon < 0 else f"{lon:.4f}°E"
        html = _build_lambda_html(
            title=f"Ensemble Forecast — {lat}°N, {lon_label}",
            current_lat=lat,
            current_lon=lon,
            s3_bucket=bucket,
            locations=locations,
            events=events,
            cdn_domain=cdn_domain,
        )
        s3.put_object(
            Bucket=bucket, Key="weather/index.html",
            Body=html.encode("utf-8"), ContentType="text/html",
            CacheControl="no-cache, max-age=0",
        )
        logger.info("Uploaded weather/index.html (%d bytes)", len(html))
    except Exception as exc:
        logger.exception("Failed to generate/upload weather/index.html: %s", exc)


# ---------------------------------------------------------------------------
# Lambda entry point
# ---------------------------------------------------------------------------

def handler(event, context):
    task = event.get("task", "assemble")
    if task == "fetch":
        return _fetch_handler(event)
    return _assemble_handler(event)
