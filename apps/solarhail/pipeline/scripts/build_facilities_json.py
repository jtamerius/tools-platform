#!/usr/bin/env python3
"""
Convert uspvdb_facilities.parquet → uspvdb_facilities.json in S3.

One-time (or re-runnable) script. The frontend loads this JSON once per
session for the commercial facilities tab. Run this after precompute_uspvdb.py
has successfully written the parquet.

Usage:
    AWS_PROFILE=jtam python scripts/build_facilities_json.py
"""

from __future__ import annotations

import io
import json
import logging
import sys
from pathlib import Path

import boto3
import pandas as pd

sys.path.insert(0, str(Path(__file__).parents[1]))
from src.config import S3_BUCKET

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s — %(message)s")
logger = logging.getLogger(__name__)

PARQUET_KEY = "commercial-solar/uspvdb_facilities.parquet"
JSON_KEY = "commercial-solar/uspvdb_facilities.json"

KEEP_COLS = ["h3_index", "case_id", "p_name", "p_state", "p_county", "ylat", "xlong", "capacity_mwdc"]


def run() -> None:
    s3 = boto3.client("s3")

    logger.info("Downloading %s", PARQUET_KEY)
    buf = io.BytesIO()
    s3.download_fileobj(S3_BUCKET, PARQUET_KEY, buf)
    buf.seek(0)
    df = pd.read_parquet(buf)
    logger.info("Loaded %d facilities, columns: %s", len(df), list(df.columns))

    cols = [c for c in KEEP_COLS if c in df.columns]
    df = df[cols]

    rows = df.to_dict(orient="records")
    body = json.dumps(rows).encode()
    size_kb = len(body) / 1024

    s3.put_object(
        Bucket=S3_BUCKET,
        Key=JSON_KEY,
        Body=body,
        ContentType="application/json",
    )
    logger.info("Uploaded %d facilities → s3://%s/%s (%.0f KB)", len(rows), S3_BUCKET, JSON_KEY, size_kb)


if __name__ == "__main__":
    run()
