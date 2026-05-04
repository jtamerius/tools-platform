"""SolarHail API — Lambda handler.

GET /api/events?metro=<id>&start=YYYY-MM-DD&end=YYYY-MM-DD

Reads Parquet files from S3 using S3 Select (no extra dependencies beyond boto3).
One file per metro per event_date under parquet/hail-events/event_date=YYYY-MM-DD/.
Files that don't exist (no-hail days) are silently skipped.
"""
from __future__ import annotations

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

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
}


def handler(event, context):  # noqa: ARG001
    method = (event.get("requestContext") or {}).get("http", {}).get("method", "GET")
    if method == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    params = event.get("queryStringParameters") or {}
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
            if not key.endswith(f"/{metro}.parquet"):
                continue
            try:
                date_str = key.split("event_date=")[1].split("/")[0]
                d = date.fromisoformat(date_str)
                if start_d <= d <= end_d:
                    results.append((date_str, key))
            except (IndexError, ValueError):
                continue
    return results


def _select_file(event_date: str, key: str) -> list[dict]:
    try:
        resp = s3.select_object_content(
            Bucket=BUCKET,
            Key=key,
            ExpressionType="SQL",
            Expression="SELECT h3_index, max_mesh_mm, solar_systems_exposed FROM S3Object",
            InputSerialization={"Parquet": {}},
            OutputSerialization={"JSON": {"RecordDelimiter": "\n"}},
        )
        rows = []
        for chunk in resp["Payload"]:
            if "Records" in chunk:
                for line in chunk["Records"]["Payload"].decode("utf-8").strip().split("\n"):
                    if line:
                        row = json.loads(line)
                        row["event_date"] = event_date
                        rows.append(row)
        return rows
    except Exception as exc:
        logger.warning("S3 Select failed for %s: %s", key, exc)
        return []


def _fetch_parallel(keys: list[tuple[str, str]]) -> list[dict]:
    if not keys:
        return []
    rows: list[dict] = []
    with ThreadPoolExecutor(max_workers=min(len(keys), 20)) as pool:
        futures = {pool.submit(_select_file, ed, k): ed for ed, k in keys}
        for fut in as_completed(futures):
            rows.extend(fut.result())
    return rows


def _error(code: int, msg: str) -> dict:
    return {
        "statusCode": code,
        "headers": {**CORS, "Content-Type": "application/json"},
        "body": json.dumps({"error": msg}),
    }
