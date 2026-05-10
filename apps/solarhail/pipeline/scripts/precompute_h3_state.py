#!/usr/bin/env python3
"""
H3→State lookup precompute.

Reads the existing CONUS H3 building-count parquet (4.66M cells), resolves each
cell centroid to its US state via a spatial join against the Census TIGER state
boundaries, and writes:

  s3://{bucket}/lookups/h3_to_state.parquet
    Columns: h3_index, state_fips, state_abbr, state_name

Cells that fall outside all state polygons (open ocean, offshore islands) get
NULL values. The output is used by the API and frontend to aggregate hail
exposure by state without an expensive per-query spatial join.

Runtime: ~10 minutes on 4 vCPU / 8 GB Fargate. One-time job; re-run manually
if Census publishes a new TIGER year.

Usage:
    AWS_PROFILE=jtam python scripts/precompute_h3_state.py
    AWS_PROFILE=jtam python scripts/precompute_h3_state.py --force
"""

from __future__ import annotations

import argparse
import io
import logging
import os
import sys
import tempfile
import zipfile
from pathlib import Path

import boto3
import geopandas as gpd
import h3 as h3lib
import pandas as pd
import requests
from shapely.geometry import Point

sys.path.insert(0, str(Path(__file__).parents[1]))

from src.config import S3_BUCKET
from src.data_downloader import DEFAULT_DATA_DIR

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)

# Census cartographic state boundaries — 500k scale, ~4 MB
TIGER_STATE_URL = "https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_state_500k.zip"

S3_BUILDINGS_KEY = "buildings/conus_h3_building_counts.parquet"
S3_OUTPUT_KEY = "lookups/h3_to_state.parquet"

# Process centroids in batches to keep peak memory bounded
_BATCH_SIZE = 500_000


def _load_state_boundaries(data_dir: Path) -> gpd.GeoDataFrame:
    """Download Census state shapefile and return as GeoDataFrame (EPSG:4326)."""
    cache_zip = data_dir / "cb_2023_us_state_500k.zip"
    if not cache_zip.exists():
        logger.info("Downloading Census state shapefile from %s", TIGER_STATE_URL)
        r = requests.get(TIGER_STATE_URL, timeout=120)
        r.raise_for_status()
        cache_zip.write_bytes(r.content)
        logger.info("Downloaded %.1f MB", len(r.content) / 1e6)

    with tempfile.TemporaryDirectory() as tmpdir:
        with zipfile.ZipFile(cache_zip) as zf:
            zf.extractall(tmpdir)
        shp = next(Path(tmpdir).glob("*.shp"))
        states = gpd.read_file(str(shp))

    states = states.to_crs("EPSG:4326")
    # Keep only the 50 states + DC (exclude territories: STATEFP >= '57' except DC='11')
    states = states[states["STATEFP"].astype(int) <= 56].copy()
    logger.info("Loaded %d state polygons", len(states))
    return states[["STATEFP", "STUSPS", "NAME", "geometry"]].rename(
        columns={"STUSPS": "state_abbr", "NAME": "state_name", "STATEFP": "state_fips"}
    )


def _load_h3_cells(s3, data_dir: Path) -> pd.Series:
    """Load h3_index column from the CONUS buildings parquet in S3."""
    cache = data_dir / "conus_h3_building_counts.parquet"
    if not cache.exists():
        logger.info("Downloading buildings parquet from S3...")
        s3.download_file(S3_BUCKET, S3_BUILDINGS_KEY, str(cache))
    df = pd.read_parquet(cache, columns=["h3_index"])
    logger.info("Loaded %d H3 cells", len(df))
    return df["h3_index"]


def _cells_to_centroids(cells: pd.Series) -> gpd.GeoDataFrame:
    """Convert H3 indices to a GeoDataFrame of centroid Points (EPSG:4326)."""
    logger.info("Computing centroids for %d cells...", len(cells))
    latlngs = [h3lib.cell_to_latlng(idx) for idx in cells]
    geometry = [Point(lon, lat) for lat, lon in latlngs]
    return gpd.GeoDataFrame({"h3_index": cells.values}, geometry=geometry, crs="EPSG:4326")


def _spatial_join(centroids: gpd.GeoDataFrame, states: gpd.GeoDataFrame) -> pd.DataFrame:
    """Left-join each H3 centroid to the state polygon that contains it.

    Processes in batches to keep peak memory bounded at ~2 GB.
    """
    n = len(centroids)
    parts: list[pd.DataFrame] = []

    for start in range(0, n, _BATCH_SIZE):
        batch = centroids.iloc[start : start + _BATCH_SIZE]
        joined = gpd.sjoin(batch, states, how="left", predicate="within")
        # sjoin adds index_right; drop geometry and spatial index columns
        joined = joined.drop(columns=["geometry", "index_right"], errors="ignore")
        parts.append(joined)
        logger.info("  Joined %d / %d cells", min(start + _BATCH_SIZE, n), n)

    result = pd.concat(parts, ignore_index=True)
    matched = result["state_abbr"].notna().sum()
    logger.info(
        "Spatial join complete: %d / %d cells matched to a state (%.1f%%)",
        matched, n, 100 * matched / n,
    )
    return result[["h3_index", "state_fips", "state_abbr", "state_name"]]


def _upload_parquet(s3, df: pd.DataFrame) -> None:
    buf = io.BytesIO()
    df.to_parquet(buf, index=False, engine="pyarrow", compression="snappy")
    buf.seek(0)
    size_mb = buf.getbuffer().nbytes / 1e6
    s3.upload_fileobj(buf, S3_BUCKET, S3_OUTPUT_KEY)
    logger.info(
        "Uploaded s3://%s/%s (%.1f MB, %d rows)",
        S3_BUCKET, S3_OUTPUT_KEY, size_mb, len(df),
    )


def run(force: bool = False, data_dir: Path = DEFAULT_DATA_DIR) -> dict:
    s3 = boto3.client("s3")
    data_dir.mkdir(parents=True, exist_ok=True)

    if not force:
        try:
            s3.head_object(Bucket=S3_BUCKET, Key=S3_OUTPUT_KEY)
            logger.info("Output already exists at s3://%s/%s — use --force to recompute",
                        S3_BUCKET, S3_OUTPUT_KEY)
            return {"status": "already_exists"}
        except s3.exceptions.ClientError:
            pass

    states = _load_state_boundaries(data_dir)
    cells = _load_h3_cells(s3, data_dir)
    centroids = _cells_to_centroids(cells)
    result = _spatial_join(centroids, states)
    _upload_parquet(s3, result)

    return {"status": "complete", "rows": len(result), "matched": int(result["state_abbr"].notna().sum())}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Precompute H3→state lookup parquet")
    parser.add_argument("--force", action="store_true", help="Recompute even if output exists")
    parser.add_argument("--data-dir", default=str(DEFAULT_DATA_DIR), help="Local cache dir")
    args = parser.parse_args()

    result = run(force=args.force, data_dir=Path(args.data_dir))
    logger.info("Done: %s", result)
