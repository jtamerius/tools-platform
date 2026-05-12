"""SolarHail API — Lambda handler.

GET /api/events?metro=<id>&start=YYYY-MM-DD&end=YYYY-MM-DD
GET /api/solar?metro=<id>
GET /api/summary  — total solar_systems_exposed per metro (for dropdown sorting)
GET /api/conus?start=YYYY-MM-DD&end=YYYY-MM-DD
GET /api/conus/state-summary?start=YYYY-MM-DD&end=YYYY-MM-DD

Reads newline-delimited JSON.gz files from S3 (one per metro/conus per event_date).
Files that don't exist (no-hail days) are silently skipped.
"""
from __future__ import annotations

import gzip
import json
import logging
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, timedelta

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

s3 = boto3.client("s3")
BUCKET = os.environ["S3_BUCKET"]
PREFIX = os.environ.get("S3_PREFIX", "parquet/hail-events")
MAX_DAYS = 92

SUMMARY_KEY = "summary/metro_totals.json"
FACILITIES_KEY = "commercial-solar/uspvdb_facilities.json"

# MESH severity thresholds (mm) — must match pipeline
MESH_MODERATE_MM    = 38.0
MESH_SIGNIFICANT_MM = 50.0
MESH_SEVERE_MM      = 65.0

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
}


def handler(event, context):  # noqa: ARG001
    method = (event.get("requestContext") or {}).get("http", {}).get("method", "GET")
    if method == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    path = (event.get("requestContext") or {}).get("http", {}).get("path", "") or event.get("rawPath", "")
    params = event.get("queryStringParameters") or {}

    if path.rstrip("/").endswith("/summary"):
        return _handle_summary()

    if path.rstrip("/").endswith("/solar"):
        return _handle_solar(params)

    if path.rstrip("/").endswith("/conus/state-summary"):
        return _handle_conus_state_summary(params)

    if path.rstrip("/").endswith("/conus"):
        return _handle_conus(params)

    if path.rstrip("/").endswith("/facilities"):
        return _handle_facilities()

    metro = params.get("metro", "").strip().lower()
    start = params.get("start", "")
    end = params.get("end", "")

    if not metro or not start or not end:
        return _error(400, "metro, start, and end are required")

    try:
        start_d = date.fromisoformat(start)
        end_d = date.fromisoformat(end)
    except ValueError:
        return _error(400, "start and end must be YYYY-MM-DD")

    if (end_d - start_d).days > MAX_DAYS:
        return _error(400, f"Date range cannot exceed {MAX_DAYS} days")

    keys = _list_keys(metro, start_d, end_d)
    logger.info("metro=%s range=%s→%s files=%d", metro, start, end, len(keys))

    rows = _fetch_parallel(keys)

    return {
        "statusCode": 200,
        "headers": {**CORS, "Content-Type": "application/json"},
        "body": json.dumps({"metro": metro, "events": rows}),
    }


# ── /api/conus ───────────────────────────────────────────────────────────────

def _handle_conus(params: dict) -> dict:
    result = _parse_date_range(params)
    if isinstance(result, dict):
        return result
    start_d, end_d = result

    keys = _list_dated_keys(start_d, end_d, "conus.json.gz")
    logger.info("conus range=%s→%s files=%d", start_d, end_d, len(keys))
    rows = _fetch_parallel(keys)
    return {
        "statusCode": 200,
        "headers": {**CORS, "Content-Type": "application/json"},
        "body": json.dumps({"events": rows}),
    }


# ── /api/conus/state-summary ─────────────────────────────────────────────────

def _handle_conus_state_summary(params: dict) -> dict:
    result = _parse_date_range(params)
    if isinstance(result, dict):
        return result
    start_d, end_d = result

    keys = _list_dated_keys(start_d, end_d, "conus_state_agg.json")
    logger.info("state-summary range=%s→%s agg_files=%d", start_d, end_d, len(keys))

    if not keys:
        return {
            "statusCode": 200,
            "headers": {**CORS, "Content-Type": "application/json"},
            "body": json.dumps({"rows": [], "message": "state aggregation not yet available for this range"}),
        }

    rows = _aggregate_state_summary(keys)
    return {
        "statusCode": 200,
        "headers": {**CORS, "Content-Type": "application/json"},
        "body": json.dumps({"rows": rows}),
    }


def _aggregate_state_summary(keys: list[tuple[str, str]]) -> list[dict]:
    """Read per-day state agg files, combine into per-state summary."""
    state_data: dict[str, dict] = {}

    def _read_agg(item: tuple[str, str]) -> list[dict]:
        _, key = item
        try:
            resp = s3.get_object(Bucket=BUCKET, Key=key)
            return json.loads(resp["Body"].read())
        except Exception as exc:
            logger.warning("Failed to read %s: %s", key, exc)
            return []

    with ThreadPoolExecutor(max_workers=min(len(keys), 20)) as pool:
        for day_rows in pool.map(_read_agg, keys):
            for row in day_rows:
                abbr = row.get("state_abbr", "")
                if not abbr:
                    continue
                if abbr not in state_data:
                    state_data[abbr] = {
                        "state_abbr": abbr,
                        "state_name": row.get("state_name", ""),
                        "hail_days": 0,
                        "moderate_days": 0,
                        "significant_days": 0,
                        "severe_days": 0,
                        "total_solar_systems": 0.0,
                        "total_commercial_mwdc": 0.0,
                    }
                s = state_data[abbr]
                s["hail_days"] += 1
                if row.get("has_moderate"):    s["moderate_days"] += 1
                if row.get("has_significant"): s["significant_days"] += 1
                if row.get("has_severe"):      s["severe_days"] += 1
                s["total_solar_systems"]   += row.get("total_solar", 0.0)
                s["total_commercial_mwdc"] += row.get("total_commercial_mwdc", 0.0)

    return sorted(state_data.values(), key=lambda x: x["total_solar_systems"], reverse=True)


# ── Shared helpers ────────────────────────────────────────────────────────────

def _parse_date_range(params: dict) -> tuple[date, date] | dict:
    """Parse and validate start/end params. Returns error response dict on failure."""
    start = params.get("start", "")
    end = params.get("end", "")
    if not start or not end:
        return _error(400, "start and end are required (YYYY-MM-DD)")
    try:
        start_d = date.fromisoformat(start)
        end_d = date.fromisoformat(end)
    except ValueError:
        return _error(400, "start and end must be YYYY-MM-DD")
    if (end_d - start_d).days > MAX_DAYS:
        return _error(400, f"Date range cannot exceed {MAX_DAYS} days")
    if end_d < start_d:
        return _error(400, "end must be >= start")
    return start_d, end_d


def _list_dated_keys(start_d: date, end_d: date, filename: str) -> list[tuple[str, str]]:
    """Build S3 keys by iterating the date range — avoids listing all partitions."""
    keys = []
    d = start_d
    while d <= end_d:
        date_str = d.strftime("%Y-%m-%d")
        key = f"{PREFIX}/event_date={date_str}/{filename}"
        keys.append((date_str, key))
        d += timedelta(days=1)
    return keys


def _list_keys(metro: str, start_d: date, end_d: date) -> list[tuple[str, str]]:
    paginator = s3.get_paginator("list_objects_v2")
    results = []
    for page in paginator.paginate(Bucket=BUCKET, Prefix=f"{PREFIX}/"):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            if not key.endswith(f"/{metro}.json.gz"):
                continue
            try:
                date_str = key.split("event_date=")[1].split("/")[0]
                d = date.fromisoformat(date_str)
                if start_d <= d <= end_d:
                    results.append((date_str, key))
            except (IndexError, ValueError):
                continue
    return results


def _read_file(event_date: str, key: str) -> list[dict]:
    try:
        resp = s3.get_object(Bucket=BUCKET, Key=key)
        with gzip.open(resp["Body"], "rt") as f:
            rows = []
            for line in f:
                line = line.strip()
                if line:
                    row = json.loads(line)
                    row["event_date"] = event_date
                    rows.append(row)
        return rows
    except Exception as exc:
        logger.warning("Failed to read %s: %s", key, exc)
        return []


def _fetch_parallel(keys: list[tuple[str, str]]) -> list[dict]:
    if not keys:
        return []
    rows: list[dict] = []
    with ThreadPoolExecutor(max_workers=min(len(keys), 20)) as pool:
        futures = {pool.submit(_read_file, ed, k): ed for ed, k in keys}
        for fut in as_completed(futures):
            rows.extend(fut.result())
    return rows


# ── /api/facilities ───────────────────────────────────────────────────────────

def _handle_facilities() -> dict:
    """Return USPVDB facility list as JSON. Returns empty list if not yet built."""
    try:
        resp = s3.get_object(Bucket=BUCKET, Key=FACILITIES_KEY)
        facilities = json.loads(resp["Body"].read())
        logger.info("Returning facilities (%d)", len(facilities))
        return {
            "statusCode": 200,
            "headers": {**CORS, "Content-Type": "application/json"},
            "body": json.dumps({"facilities": facilities}),
        }
    except s3.exceptions.NoSuchKey:
        return {
            "statusCode": 200,
            "headers": {**CORS, "Content-Type": "application/json"},
            "body": json.dumps({"facilities": []}),
        }
    except Exception as exc:
        logger.warning("Failed to read facilities: %s", exc)
        return {
            "statusCode": 200,
            "headers": {**CORS, "Content-Type": "application/json"},
            "body": json.dumps({"facilities": []}),
        }


# ── Existing handlers (unchanged) ────────────────────────────────────────────

def _handle_summary() -> dict:
    try:
        resp = s3.get_object(Bucket=BUCKET, Key=SUMMARY_KEY)
        cached = json.loads(resp["Body"].read())
        logger.info("Returning cached summary (%d metros)", len(cached.get("totals", {})))
        return {
            "statusCode": 200,
            "headers": {**CORS, "Content-Type": "application/json"},
            "body": json.dumps(cached),
        }
    except Exception:
        pass

    paginator = s3.get_paginator("list_objects_v2")
    metro_keys: dict[str, list[str]] = {}
    for page in paginator.paginate(Bucket=BUCKET, Prefix=f"{PREFIX}/"):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            if not key.endswith(".json.gz"):
                continue
            metro_id = key.split("/")[-1].replace(".json.gz", "")
            metro_keys.setdefault(metro_id, []).append(key)

    def _sum_metro(item: tuple[str, list[str]]) -> tuple[str, float]:
        metro_id, keys = item
        total = 0.0
        for key in keys:
            try:
                resp = s3.get_object(Bucket=BUCKET, Key=key)
                with gzip.open(resp["Body"], "rt") as f:
                    for line in f:
                        if line.strip():
                            total += json.loads(line).get("solar_systems_exposed", 0)
            except Exception as exc:
                logger.warning("Failed reading %s: %s", key, exc)
        return metro_id, float(total)

    totals: dict[str, float] = {}
    with ThreadPoolExecutor(max_workers=min(len(metro_keys), 34)) as pool:
        for metro_id, total in pool.map(_sum_metro, metro_keys.items()):
            totals[metro_id] = total

    result = {"totals": totals}
    try:
        s3.put_object(
            Bucket=BUCKET, Key=SUMMARY_KEY,
            Body=json.dumps(result).encode(),
            ContentType="application/json",
        )
        logger.info("Wrote summary cache: %d metros", len(totals))
    except Exception as exc:
        logger.warning("Failed to write summary cache: %s", exc)

    return {
        "statusCode": 200,
        "headers": {**CORS, "Content-Type": "application/json"},
        "body": json.dumps(result),
    }


def _handle_solar(params: dict) -> dict:
    metro = params.get("metro", "").strip().lower()
    if not metro:
        return _error(400, "metro is required")
    key = f"solar/{metro}.json.gz"
    try:
        resp = s3.get_object(Bucket=BUCKET, Key=key)
        with gzip.open(resp["Body"], "rt") as f:
            cells = [json.loads(line) for line in f if line.strip()]
    except s3.exceptions.NoSuchKey:
        cells = []
    except Exception as exc:
        logger.warning("Failed to read solar basemap %s: %s", key, exc)
        cells = []
    return {
        "statusCode": 200,
        "headers": {**CORS, "Content-Type": "application/json"},
        "body": json.dumps({"metro": metro, "cells": cells}),
    }


def _error(code: int, msg: str) -> dict:
    return {
        "statusCode": code,
        "headers": {**CORS, "Content-Type": "application/json"},
        "body": json.dumps({"error": msg}),
    }
