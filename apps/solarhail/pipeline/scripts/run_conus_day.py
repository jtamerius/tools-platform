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
import json
import logging
import sys
from datetime import date
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
from src.impact_calculator import calculate_impact
from src.mrms_reader import read_mrms_pixels
from src.overture_fetcher import fetch_buildings_bbox, load_precomputed_buildings

USPVDB_S3_KEY = "commercial-solar/uspvdb_h3_aggregated.parquet"
H3_STATE_S3_KEY = "lookups/h3_to_state.parquet"

# MESH severity thresholds (mm) — must match API handler
MESH_MODERATE_MM    = 38.0
MESH_SIGNIFICANT_MM = 50.0
MESH_SEVERE_MM      = 65.0


def load_h3_state(s3_client, data_dir: Path) -> pd.DataFrame | None:
    """Load h3_to_state lookup parquet from S3 (cached locally). Returns None if not yet built."""
    cache = data_dir / "h3_to_state.parquet"
    if not cache.exists():
        try:
            s3_client.download_file(S3_BUCKET, H3_STATE_S3_KEY, str(cache))
            logger.info("Downloaded h3_to_state parquet from S3")
        except Exception as e:
            logger.info("h3_to_state lookup not available yet: %s", e)
            return None
    return pd.read_parquet(cache, columns=["h3_index", "state_abbr", "state_name"])


def write_state_agg(s3_client, output: pd.DataFrame, date_: date, h3_state: pd.DataFrame) -> None:
    """Compute and upload per-state severity/solar aggregation for the API state-summary endpoint."""
    merged = output.merge(h3_state, on="h3_index", how="left")
    merged = merged[merged["state_abbr"].notna()]
    if merged.empty:
        return

    rows = []
    for (abbr, name), grp in merged.groupby(["state_abbr", "state_name"]):
        rows.append({
            "state_abbr": abbr,
            "state_name": name,
            "has_moderate":    bool((grp["max_mesh_mm"] >= MESH_MODERATE_MM).any()),
            "has_significant": bool((grp["max_mesh_mm"] >= MESH_SIGNIFICANT_MM).any()),
            "has_severe":      bool((grp["max_mesh_mm"] >= MESH_SEVERE_MM).any()),
            "total_solar":            float(grp["solar_systems_exposed"].sum()),
            "total_commercial_mwdc":  float(grp["commercial_capacity_mwdc"].sum()),
        })

    key = f"{S3_PARQUET_PREFIX}/event_date={date_.strftime('%Y-%m-%d')}/conus_state_agg.json"
    s3_client.put_object(
        Bucket=S3_BUCKET, Key=key,
        Body=json.dumps(rows).encode(),
        ContentType="application/json",
    )
    logger.info("State agg uploaded → %s (%d states)", key, len(rows))


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


def run(date_: date, data_dir: Path) -> None:
    noaa = boto3.client("s3", config=Config(signature_version=UNSIGNED), region_name="us-east-1")
    s3 = boto3.client("s3")

    keys = list_mrms_keys_for_date(noaa, date_)
    logger.info("MRMS keys: %d to process for %s", len(keys), date_)

    if not keys:
        logger.info("No MRMS files found for %s — nothing to process", date_)
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

    h3_state = load_h3_state(s3, data_dir)
    if h3_state is not None:
        try:
            write_state_agg(s3, output, date_, h3_state)
        except Exception:
            logger.exception("State agg failed — continuing without it")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="CONUS single-day hail pipeline (staging test)")
    parser.add_argument("--date", required=True, help="Date to process (YYYY-MM-DD)")
    parser.add_argument("--data-dir", default=str(DEFAULT_DATA_DIR),
                        help="Local cache dir for DeepSolar/TIGER/IEM data")
    args = parser.parse_args()
    run(date.fromisoformat(args.date), Path(args.data_dir))
