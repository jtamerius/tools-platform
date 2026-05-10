"""
CONUS single-day pipeline test.

Processes the entire continental US for one date — one GRIB2 decode per file,
no metro bbox filter. Uses IEM warning windows to skip files outside active
SVR/TOR warning periods.

Usage:
    AWS_PROFILE=jtam python scripts/run_conus_day.py --date 2026-04-15

Output (staging by default):
    s3://tools-solarhail-staging-606196119553/parquet/hail-events/event_date=2026-04-15/conus.json.gz

To target a different env:
    AWS_PROFILE=jtam SOLARHAIL_ENV=staging python scripts/run_conus_day.py --date 2026-04-15
"""

from __future__ import annotations

import argparse
import gzip
import io
import logging
import re
import sys
from datetime import date, datetime, timezone
from pathlib import Path

import boto3
import pandas as pd
from botocore import UNSIGNED
from botocore.config import Config

sys.path.insert(0, str(Path(__file__).parents[1]))

from src.config import MRMS_BUCKET, MRMS_PRODUCT, S3_BUCKET, S3_PARQUET_PREFIX
from src.data_downloader import DEFAULT_DATA_DIR, fetch_all
from src.deepsolar_joiner import assign_solar_to_h3
from src.h3_snapper import snap_to_h3
from src.iem_prefilter import get_conus_warning_windows
from src.impact_calculator import calculate_impact
from src.mrms_reader import read_mrms_pixels
from src.overture_fetcher import fetch_buildings_bbox, load_precomputed_buildings

USPVDB_S3_KEY = "commercial-solar/uspvdb_h3_aggregated.parquet"


def load_commercial_solar(s3_client, data_dir: Path) -> pd.DataFrame | None:
    """Load USPVDB H3-aggregated commercial solar parquet from S3 (cached locally)."""
    cache = data_dir / "uspvdb_h3_aggregated.parquet"
    if not cache.exists():
        try:
            s3_client.download_file(S3_BUCKET, USPVDB_S3_KEY, str(cache))
            logger.info("Downloaded USPVDB commercial solar parquet from S3")
        except Exception as e:
            logger.warning("Could not load USPVDB commercial solar data: %s", e)
            return None
    return pd.read_parquet(cache)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)


def list_mrms_keys_for_date(s3_client, date_: date) -> list[str]:
    prefix = (
        f"{MRMS_PRODUCT}/{date_.strftime('%Y%m%d')}/"
        f"MRMS_MESH_Max_30min_00.50_{date_.strftime('%Y%m%d')}"
    )
    paginator = s3_client.get_paginator("list_objects_v2")
    keys = []
    for page in paginator.paginate(Bucket=MRMS_BUCKET, Prefix=prefix):
        for obj in page.get("Contents", []):
            keys.append(obj["Key"])
    return keys


def _filter_keys_by_windows(
    keys: list[str],
    windows: list[tuple[datetime, datetime]],
) -> list[str]:
    """Keep only keys whose filename timestamp falls within any warning window."""
    if not windows:
        return keys  # no window data — safe fallback: keep all
    filtered = []
    for key in keys:
        m = re.search(r'(\d{8})-(\d{6})\.grib2', key)
        if not m:
            filtered.append(key)
            continue
        key_dt = datetime.strptime(
            m.group(1) + m.group(2), '%Y%m%d%H%M%S'
        ).replace(tzinfo=timezone.utc)
        if any(issued <= key_dt <= expired for issued, expired in windows):
            filtered.append(key)
    return filtered


def run(date_: date, data_dir: Path) -> None:
    noaa = boto3.client("s3", config=Config(signature_version=UNSIGNED), region_name="us-east-1")
    s3 = boto3.client("s3")

    windows = get_conus_warning_windows(date_, data_dir=data_dir)
    all_keys = list_mrms_keys_for_date(noaa, date_)
    keys = _filter_keys_by_windows(all_keys, windows)
    logger.info("MRMS keys: %d total → %d within warning windows", len(all_keys), len(keys))

    if not keys:
        logger.info("No MRMS files in warning windows for %s — nothing to process", date_)
        return

    all_cells: list[pd.DataFrame] = []
    for key in keys:
        try:
            pixels = read_mrms_pixels(key, metro_id=None, s3_client=noaa)
            if pixels:
                cells = snap_to_h3(pixels, metro_id="conus")
                if not cells.empty:
                    all_cells.append(cells)
        except Exception:
            logger.exception("Failed processing key %s", key)

    if not all_cells:
        logger.info("No hail above threshold on %s — no output", date_)
        return

    combined = pd.concat(all_cells, ignore_index=True)
    daily = combined.groupby("h3_index", as_index=False).agg(
        max_mesh_mm=("max_mesh_mm", "max"),
        timestamp=("timestamp", "first"),
        metro_id=("metro_id", "first"),
    )
    logger.info("Hail cells after H3 aggregation: %d", len(daily))

    import h3 as h3lib
    lats = [h3lib.cell_to_latlng(idx)[0] for idx in daily["h3_index"]]
    lons = [h3lib.cell_to_latlng(idx)[1] for idx in daily["h3_index"]]
    bbox = (min(lats) - 0.5, max(lats) + 0.5, min(lons) - 0.5, max(lons) + 0.5)
    logger.info("Hail footprint bbox: lat %.2f–%.2f, lon %.2f–%.2f", *bbox)

    deepsolar_csv, tiger_shp = fetch_all(data_dir)
    buildings = load_precomputed_buildings(data_dir)
    if buildings is None:
        logger.warning("Precomputed buildings not found — falling back to live Overture query (slow)")
        buildings = fetch_buildings_bbox(bbox)
    solar = assign_solar_to_h3(buildings, deepsolar_csv, tiger_shp)
    commercial = load_commercial_solar(s3, data_dir)
    output = calculate_impact(daily, solar, commercial_cells=commercial)

    logger.info("Output cells: %d (all hail cells, zeros where no solar data)", len(output))

    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb") as gz:
        output[["h3_index", "max_mesh_mm", "solar_systems_exposed", "commercial_capacity_mwdc"]].to_json(
            gz, orient="records", lines=True,
        )
    buf.seek(0)

    key = f"{S3_PARQUET_PREFIX}/event_date={date_.strftime('%Y-%m-%d')}/conus.json.gz"
    s3.upload_fileobj(buf, S3_BUCKET, key)
    logger.info("Uploaded → s3://%s/%s  (%d rows)", S3_BUCKET, key, len(output))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="CONUS single-day hail pipeline (staging test)")
    parser.add_argument("--date", required=True, help="Date to process (YYYY-MM-DD)")
    parser.add_argument("--data-dir", default=str(DEFAULT_DATA_DIR),
                        help="Local cache dir for DeepSolar/TIGER/IEM data")
    args = parser.parse_args()
    run(date.fromisoformat(args.date), Path(args.data_dir))
