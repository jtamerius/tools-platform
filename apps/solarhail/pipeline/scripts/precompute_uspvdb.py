#!/usr/bin/env python3
"""
USPVDB utility-scale solar precompute.

Downloads the USGS Large-Scale Solar PV Database (USPVDB), snaps each facility
centroid to H3 res-8, and writes two parquet files to S3:

  s3://{bucket}/commercial-solar/uspvdb_h3_aggregated.parquet
    Columns: h3_index, facility_count, capacity_mwdc
    Join key for per-day hail exposure.

  s3://{bucket}/commercial-solar/uspvdb_facilities.parquet
    Columns: h3_index, case_id, p_name, p_state, p_county, ylat, xlong, capacity_mwdc
    Full facility metadata for the commercial-tab facility table.

Designed as a Lambda handler for monthly refreshes (USGS updates the database
~quarterly). ETag-based change detection: skips re-processing if USGS hasn't
published a new version since the last run. Completes in <30 seconds on 6,611
facilities; costs <$0.001 per run.

Lambda entrypoint: lambda_handler(event, context)
CLI: python scripts/precompute_uspvdb.py [--force]

USPVDB source: https://eerscmap.usgs.gov/uspvdb/
"""

from __future__ import annotations

import io
import json
import logging
import os
import sys
import zipfile
from pathlib import Path
from typing import Any

import boto3
import h3 as h3lib
import pandas as pd
import requests

sys.path.insert(0, str(Path(__file__).parents[1]))

from src.config import H3_RESOLUTION, S3_BUCKET

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)

# Stable USGS USPVDB download URL — USGS keeps this path consistent across versions
USPVDB_URL = "https://eerscmap.usgs.gov/uspvdb/assets/data/uspvdb_csv.zip"

# S3 keys within the bucket
S3_H3_KEY = "commercial-solar/uspvdb_h3_aggregated.parquet"
S3_FACILITIES_KEY = "commercial-solar/uspvdb_facilities.parquet"
S3_META_KEY = "commercial-solar/uspvdb_meta.json"

# Columns we keep from the raw CSV
_KEEP_COLS = ["case_id", "p_name", "p_state", "p_county", "ylat", "xlong", "p_cap_dc"]


def _load_meta(s3: Any) -> dict:
    """Read last-run metadata from S3 (etag + row count). Empty dict if missing."""
    try:
        obj = s3.get_object(Bucket=S3_BUCKET, Key=S3_META_KEY)
        return json.loads(obj["Body"].read())
    except s3.exceptions.NoSuchKey:
        return {}
    except Exception as e:
        logger.warning("Could not read metadata from S3: %s", e)
        return {}


def _save_meta(s3: Any, etag: str, row_count: int) -> None:
    body = json.dumps({"etag": etag, "row_count": row_count}).encode()
    s3.put_object(Bucket=S3_BUCKET, Key=S3_META_KEY, Body=body, ContentType="application/json")


def _fetch_uspvdb(force: bool, last_etag: str) -> tuple[bytes | None, str]:
    """Download USPVDB zip. Returns (content_bytes, etag).

    Returns (None, etag) if ETag unchanged and force=False — caller should skip.
    """
    logger.info("HEAD %s", USPVDB_URL)
    head = requests.head(USPVDB_URL, timeout=30, allow_redirects=True)
    head.raise_for_status()
    etag = head.headers.get("ETag", "")

    if not force and etag and etag == last_etag:
        logger.info("ETag unchanged (%s) — USPVDB up to date, skipping", etag)
        return None, etag

    logger.info("Downloading USPVDB (ETag: %s → %s)", last_etag or "none", etag)
    r = requests.get(USPVDB_URL, timeout=120, stream=True)
    r.raise_for_status()
    content = r.content
    logger.info("Downloaded %.1f MB", len(content) / 1e6)
    return content, etag


def _parse_csv(content: bytes) -> pd.DataFrame:
    """Extract and parse the USPVDB CSV from a zip archive."""
    with zipfile.ZipFile(io.BytesIO(content)) as zf:
        csv_names = [n for n in zf.namelist() if n.endswith(".csv")]
        if not csv_names:
            raise ValueError("No CSV found in USPVDB zip")
        csv_name = csv_names[0]
        logger.info("Parsing %s", csv_name)
        with zf.open(csv_name) as f:
            df = pd.read_csv(f, low_memory=False, usecols=lambda c: c in _KEEP_COLS)

    # Normalize
    df = df.rename(columns={"p_cap_dc": "capacity_mwdc"})
    df = df.dropna(subset=["ylat", "xlong"])
    df["capacity_mwdc"] = pd.to_numeric(df["capacity_mwdc"], errors="coerce").fillna(0.0)
    df["case_id"] = df["case_id"].astype(str)
    df["p_name"] = df["p_name"].fillna("").astype(str)
    df["p_state"] = df["p_state"].fillna("").astype(str)
    df["p_county"] = df["p_county"].fillna("").astype(str)

    logger.info("Parsed %d facilities", len(df))
    return df


def _snap_to_h3(df: pd.DataFrame) -> pd.DataFrame:
    """Add h3_index column by snapping lat/lon to H3 res-8."""
    df = df.copy()
    df["h3_index"] = [
        h3lib.latlng_to_cell(lat, lon, H3_RESOLUTION)
        for lat, lon in zip(df["ylat"], df["xlong"])
    ]
    return df


def _build_aggregated(df: pd.DataFrame) -> pd.DataFrame:
    """Aggregate to one row per H3 cell: facility_count + total capacity."""
    agg = (
        df.groupby("h3_index", as_index=False)
        .agg(facility_count=("case_id", "count"), capacity_mwdc=("capacity_mwdc", "sum"))
    )
    agg["capacity_mwdc"] = agg["capacity_mwdc"].round(3)
    logger.info("Aggregated to %d unique H3 cells", len(agg))
    return agg


def _upload_parquet(s3: Any, df: pd.DataFrame, key: str) -> None:
    buf = io.BytesIO()
    df.to_parquet(buf, index=False, engine="pyarrow", compression="snappy")
    buf.seek(0)
    size_kb = buf.getbuffer().nbytes / 1024
    s3.upload_fileobj(buf, S3_BUCKET, key)
    logger.info("Uploaded s3://%s/%s (%.1f KB, %d rows)", S3_BUCKET, key, size_kb, len(df))


def run(force: bool = False) -> dict:
    """Core logic — callable from Lambda handler or CLI.

    Returns a dict suitable for Lambda response body.
    """
    s3 = boto3.client("s3")
    meta = _load_meta(s3)
    last_etag = meta.get("etag", "")

    content, etag = _fetch_uspvdb(force=force, last_etag=last_etag)

    if content is None:
        return {"status": "up_to_date", "etag": etag, "row_count": meta.get("row_count")}

    df = _parse_csv(content)
    df = _snap_to_h3(df)

    # Facility-level parquet (metadata for table view)
    facilities = df[["h3_index"] + [c for c in _KEEP_COLS if c != "p_cap_dc"] + ["capacity_mwdc"]].copy()
    facilities = facilities.rename(columns={})  # already renamed above

    # H3-aggregated parquet (join key for hail exposure)
    aggregated = _build_aggregated(df)

    _upload_parquet(s3, aggregated, S3_H3_KEY)
    _upload_parquet(s3, facilities, S3_FACILITIES_KEY)
    _save_meta(s3, etag, len(df))

    return {"status": "updated", "etag": etag, "row_count": len(df), "h3_cells": len(aggregated)}


def lambda_handler(event: dict, context: Any) -> dict:
    """AWS Lambda entrypoint. Event may contain {"force": true} to bypass ETag check."""
    force = bool((event or {}).get("force", False))
    try:
        result = run(force=force)
        logger.info("Lambda result: %s", result)
        return {"statusCode": 200, "body": json.dumps(result)}
    except Exception as e:
        logger.exception("USPVDB precompute failed")
        return {"statusCode": 500, "body": json.dumps({"error": str(e)})}


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Precompute USPVDB utility-scale solar H3 data")
    parser.add_argument("--force", action="store_true", help="Re-download even if ETag unchanged")
    parser.add_argument("--env", default=None, help="Override SOLARHAIL_ENV (staging|production)")
    args = parser.parse_args()

    if args.env:
        os.environ["SOLARHAIL_ENV"] = args.env
        # Re-import config to pick up the env var — simplest for CLI use
        import importlib
        import src.config as _cfg
        importlib.reload(_cfg)
        global S3_BUCKET  # noqa: PLW0603
        from src.config import S3_BUCKET  # noqa: F811

    result = run(force=args.force)
    print(json.dumps(result, indent=2))
