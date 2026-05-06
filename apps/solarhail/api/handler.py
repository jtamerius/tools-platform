"""SolarHail API — Lambda handler.

GET /api/events?metro=<id>&start=YYYY-MM-DD&end=YYYY-MM-DD
GET /api/solar?metro=<id>
GET /api/summary  — total estimated_solar_systems per metro (for dropdown sorting)

Reads newline-delimited JSON.gz files from S3 (one per metro per event_date).
Files that don't exist (no-hail days) are silently skipped.
"""
from __future__ import annotations

import gzip
import json
import logging
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

s3 = boto3.client("s3")
BUCKET = os.environ["S3_BUCKET"]
PREFIX = os.environ.get("S3_PREFIX", "parquet/hail-events")
MAX_DAYS = 92

SUMMARY_KEY = "summary/metro_totals.json"

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


def _handle_summary() -> dict:
    # Return cached result if available
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
        pass  # Cache miss — compute below

    # List all hail event keys grouped by metro
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

    # Write cache to S3
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
