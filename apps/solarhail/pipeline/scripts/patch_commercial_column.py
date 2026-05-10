#!/usr/bin/env python3
"""
Patch existing conus.json.gz files to add commercial_capacity_mwdc column.

Downloads each file, left-joins with the USPVDB H3-aggregated parquet already
in S3, re-uploads in place. No GRIB2 decoding — pure S3 read/join/write.

Runtime: ~5-7 minutes for 79 files. Safe to re-run; files already patched
(detected by presence of commercial_capacity_mwdc column) are skipped.

Usage:
    AWS_PROFILE=jtam python scripts/patch_commercial_column.py
    AWS_PROFILE=jtam python scripts/patch_commercial_column.py --force  # re-patch all
"""

from __future__ import annotations

import argparse
import gzip
import io
import logging
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import boto3
import pandas as pd

sys.path.insert(0, str(Path(__file__).parents[1]))

from src.config import S3_BUCKET, S3_PARQUET_PREFIX

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)

USPVDB_KEY = "commercial-solar/uspvdb_h3_aggregated.parquet"
WORKERS = 8


def _load_uspvdb(s3) -> pd.DataFrame:
    buf = io.BytesIO()
    s3.download_fileobj(S3_BUCKET, USPVDB_KEY, buf)
    buf.seek(0)
    df = pd.read_parquet(buf, columns=["h3_index", "capacity_mwdc"])
    logger.info("Loaded USPVDB: %d H3 cells with commercial solar", len(df))
    return df


def _list_conus_keys(s3) -> list[str]:
    paginator = s3.get_paginator("list_objects_v2")
    keys = []
    for page in paginator.paginate(Bucket=S3_BUCKET, Prefix=S3_PARQUET_PREFIX):
        for obj in page.get("Contents", []):
            if obj["Key"].endswith("conus.json.gz"):
                keys.append(obj["Key"])
    return sorted(keys)


def _patch_file(s3, key: str, uspvdb: pd.DataFrame, force: bool) -> str:
    """Download, join, re-upload one conus.json.gz. Returns status string."""
    raw = io.BytesIO()
    s3.download_fileobj(S3_BUCKET, key, raw)
    raw.seek(0)

    with gzip.GzipFile(fileobj=raw) as gz:
        df = pd.read_json(gz, orient="records", lines=True)

    if not force and "commercial_capacity_mwdc" in df.columns:
        return "skipped"

    df = df.merge(uspvdb, on="h3_index", how="left")
    df = df.rename(columns={"capacity_mwdc": "commercial_capacity_mwdc"})
    df["commercial_capacity_mwdc"] = df["commercial_capacity_mwdc"].fillna(0.0)

    out = io.BytesIO()
    with gzip.GzipFile(fileobj=out, mode="wb") as gz:
        df[["h3_index", "max_mesh_mm", "solar_systems_exposed", "commercial_capacity_mwdc"]].to_json(
            gz, orient="records", lines=True,
        )
    out.seek(0)
    s3.upload_fileobj(out, S3_BUCKET, key)
    return f"patched ({len(df)} rows)"


def run(force: bool = False) -> None:
    s3 = boto3.client("s3")
    uspvdb = _load_uspvdb(s3)
    keys = _list_conus_keys(s3)
    logger.info("Found %d conus.json.gz files to process", len(keys))

    patched = skipped = errors = 0

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = {pool.submit(_patch_file, s3, key, uspvdb, force): key for key in keys}
        for future in as_completed(futures):
            key = futures[future]
            date = key.split("event_date=")[1].split("/")[0]
            try:
                status = future.result()
                if status == "skipped":
                    skipped += 1
                else:
                    patched += 1
                    logger.info("%-12s  %s", date, status)
            except Exception as e:
                errors += 1
                logger.error("%-12s  FAILED: %s", date, e)

    logger.info(
        "Done — patched: %d, skipped (already had column): %d, errors: %d",
        patched, skipped, errors,
    )
    if errors:
        sys.exit(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Patch commercial_capacity_mwdc into existing conus output files")
    parser.add_argument("--force", action="store_true", help="Re-patch even if column already present")
    args = parser.parse_args()
    run(force=args.force)
