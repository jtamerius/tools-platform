"""Pipeline entrypoint — orchestrates Modules 1-5 for one metro + date range.

Data sources fetched automatically on first run (all cached in --data-dir):
  DeepSolar-3M:   https://github.com/rajanieprabha/DeepSolar-3M/blob/main/dataset/blockgroup_level_data.csv
  Census TIGER:   https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_bg_500k.zip
  IEM warnings:   https://mesonet.agron.iastate.edu/pickup/wwa/ (annual) or watchwarn.py (current year)

Usage (local — single metro, single day):
    python -m src.main --metro dfw --date 2026-03-15 --out /tmp/output/

Usage (local — single metro, date range):
    python -m src.main --metro dfw --start-date 2026-02-02 --end-date 2026-05-01

Usage (AWS Batch, via env vars):
    METRO=dfw START_DATE=2026-02-02 END_DATE=2026-05-01 python -m src.main

NWS pre-filter:
    Before decoding any MRMS files, the IEM warning index is built once and cached.
    Only (metro, date) pairs with an active SVR or TOR warning polygon are processed.
    Typical GRIB decode reduction: 80-90%.
    Pass --no-prefilter to disable (useful for testing a known storm day).
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from datetime import date, timedelta
from pathlib import Path

import boto3
import pandas as pd

from .config import (
    METROS,
    MRMS_BUCKET,
    MRMS_PRODUCT,
    S3_BUCKET,
    S3_PARQUET_PREFIX,
    metro_bbox,
)
from .data_downloader import DEFAULT_DATA_DIR, fetch_all
from .deepsolar_joiner import assign_solar_to_h3
from .h3_snapper import snap_to_h3, write_parquet
from .iem_prefilter import build_warning_index
from .impact_calculator import calculate_impact
from .mrms_reader import read_mrms_pixels
from .overture_fetcher import fetch_buildings

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s — %(message)s")
logger = logging.getLogger(__name__)


def upload_to_s3(local_path: Path, metro_id: str, event_date: date) -> str:
    """Upload a local Parquet file to S3 under the Hive partition path.

    S3 key: parquet/hail-events/event_date=YYYY-MM-DD/{metro_id}.parquet

    Returns:
        Full s3:// URI of the uploaded object.
    """
    key = f"{S3_PARQUET_PREFIX}/event_date={event_date.strftime('%Y-%m-%d')}/{metro_id}.parquet"
    s3 = boto3.client("s3")
    s3.upload_file(str(local_path), S3_BUCKET, key)
    uri = f"s3://{S3_BUCKET}/{key}"
    logger.info("Uploaded %s → %s", local_path.name, uri)
    return uri


def list_mrms_keys_for_date(s3_client, date_: date, metro_id: str) -> list[str]:
    """List all MESH_Max_30min GRIB2 keys in NOAA bucket for a given UTC date.

    Actual key pattern (verified):
      CONUS/MESH_Max_30min_00.50/{YYYYMMDD}/MRMS_MESH_Max_30min_00.50_{YYYYMMDD}-HHMMSS.grib2.gz
    """
    prefix = f"{MRMS_PRODUCT}/{date_.strftime('%Y%m%d')}/MRMS_MESH_Max_30min_00.50_{date_.strftime('%Y%m%d')}"
    paginator = s3_client.get_paginator("list_objects_v2")
    keys = []
    for page in paginator.paginate(Bucket=MRMS_BUCKET, Prefix=prefix):
        for obj in page.get("Contents", []):
            keys.append(obj["Key"])
    logger.info("Found %d MRMS files for %s on %s", len(keys), metro_id, date_)
    return keys


def run_metro_day(metro_id: str, date_: date, out_dir: Path, data_dir: Path, upload_s3: bool = False) -> Path | None:
    """Run full pipeline (Modules 1-5) for one metro on one day.

    Caller is responsible for pre-filter gating — this function always processes
    the given date unconditionally.

    Returns:
        Path to output Parquet, or None if no hail above threshold found.
    """
    from botocore import UNSIGNED
    from botocore.config import Config
    s3 = boto3.client("s3", config=Config(signature_version=UNSIGNED), region_name="us-east-1")

    keys = list_mrms_keys_for_date(s3, date_, metro_id)
    if not keys:
        logger.warning("No MRMS files found for %s on %s — skipping", metro_id, date_)
        return None

    all_cells: list[pd.DataFrame] = []
    for key in keys:
        try:
            pixels = read_mrms_pixels(key, metro_id, s3_client=s3)
            if pixels:
                cells = snap_to_h3(pixels, metro_id)
                if not cells.empty:
                    all_cells.append(cells)
        except Exception:
            logger.exception("Failed processing key %s", key)

    if not all_cells:
        logger.info("No hail in %s on %s above threshold — no output", metro_id, date_)
        return None

    combined = pd.concat(all_cells, ignore_index=True)
    daily = combined.groupby("h3_index", as_index=False).agg(
        max_mesh_mm=("max_mesh_mm", "max"),
        timestamp=("timestamp", "first"),
        metro_id=("metro_id", "first"),
    )

    buildings = fetch_buildings(metro_id)
    deepsolar_csv, tiger_shp = fetch_all(data_dir)
    solar = assign_solar_to_h3(buildings, deepsolar_csv, tiger_shp)
    enriched = calculate_impact(daily, solar)

    if enriched.empty:
        logger.info("No solar overlap for %s on %s — no output", metro_id, date_)
        return None

    import pyarrow as pa
    import pyarrow.parquet as pq

    out_path = out_dir / f"{metro_id}_{date_.strftime('%Y%m%d')}.parquet"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    # Write final enriched schema (5 columns) — not the Module 2 schema from write_parquet
    table = pa.Table.from_pandas(enriched, preserve_index=False)
    pq.write_table(table, str(out_path))
    logger.info("Wrote %d rows to %s", len(enriched), out_path)

    if upload_s3:
        upload_to_s3(out_path, metro_id, date_)

    return out_path


def run_backfill(
    metro_id: str,
    dates: list[date],
    out_dir: Path,
    data_dir: Path,
    use_prefilter: bool = True,
    upload_s3: bool = False,
) -> dict[str, int]:
    """Run the pipeline for a metro over a list of dates with optional IEM pre-filter.

    Returns:
        Dict with keys: total_dates, prefilter_passed, processed, produced_output
    """
    stats = {
        "total_dates": len(dates),
        "prefilter_passed": len(dates),
        "processed": 0,
        "produced_output": 0,
    }

    warning_dates: frozenset[date] = frozenset(dates)  # default: all pass

    if use_prefilter and len(dates) > 1:
        logger.info("Building IEM warning index for %s (%d dates)...", metro_id, len(dates))
        index = build_warning_index(
            start_date=min(dates),
            end_date=max(dates),
            metro_ids=[metro_id],
            data_dir=data_dir,
        )
        warning_dates = index.get(metro_id, frozenset())
        stats["prefilter_passed"] = len(warning_dates)
        skipped = len(dates) - len(warning_dates)
        logger.info(
            "Pre-filter: %d dates skipped (no SVR/TOR warnings), %d to process",
            skipped, len(warning_dates),
        )

    for d in sorted(dates):
        if d not in warning_dates:
            continue
        stats["processed"] += 1
        result = run_metro_day(metro_id, d, out_dir, data_dir, upload_s3=upload_s3)
        if result is not None:
            stats["produced_output"] += 1

    logger.info(
        "Backfill complete for %s: %d/%d dates processed, %d Parquet files produced",
        metro_id, stats["processed"], stats["total_dates"], stats["produced_output"],
    )
    return stats


def main() -> None:
    parser = argparse.ArgumentParser(description="SolarHail pipeline — Modules 1-5")
    parser.add_argument("--metro", default=os.environ.get("METRO"), choices=list(METROS),
                        help="Metro ID (see config.METROS for full list)")
    parser.add_argument("--date", default=os.environ.get("RUN_DATE"),
                        help="Single date ISO8601 (YYYY-MM-DD)")
    parser.add_argument("--start-date", default=os.environ.get("START_DATE"))
    parser.add_argument("--end-date", default=os.environ.get("END_DATE"))
    parser.add_argument("--out", default=os.environ.get("OUT_DIR", "/tmp/solarhail_output"))
    parser.add_argument("--data-dir", default=os.environ.get("DATA_DIR", str(DEFAULT_DATA_DIR)))
    parser.add_argument("--no-prefilter", action="store_true",
                        help="Skip IEM warning pre-filter (useful when testing a known storm day)")
    parser.add_argument("--upload-s3", action="store_true",
                        default=os.environ.get("UPLOAD_S3", "").lower() in ("1", "true"),
                        help="Upload output Parquet to S3 after writing locally")
    args = parser.parse_args()

    if not args.metro:
        logger.error("--metro is required (e.g. --metro dfw)")
        sys.exit(1)

    out_dir = Path(args.out)
    data_dir = Path(args.data_dir)

    dates: list[date] = []
    if args.date:
        dates = [date.fromisoformat(args.date)]
    elif args.start_date and args.end_date:
        d = date.fromisoformat(args.start_date)
        end = date.fromisoformat(args.end_date)
        while d <= end:
            dates.append(d)
            d += timedelta(days=1)
    else:
        logger.error("Provide --date or both --start-date and --end-date")
        sys.exit(1)

    use_prefilter = not args.no_prefilter
    if args.date:
        # Single-date runs bypass the pre-filter — user knows what they want
        use_prefilter = False

    run_backfill(
        metro_id=args.metro,
        dates=dates,
        out_dir=out_dir,
        data_dir=data_dir,
        use_prefilter=use_prefilter,
        upload_s3=args.upload_s3,
    )


if __name__ == "__main__":
    main()
