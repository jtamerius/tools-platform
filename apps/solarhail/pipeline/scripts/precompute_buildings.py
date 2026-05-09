"""
One-time CONUS buildings precompute.

Queries Overture for all buildings across the continental US in a 5°×5° grid
of chunks (to keep each DuckDB query within memory limits), snaps centroids to
H3 res-8, and writes a single merged parquet to:

    s3://{S3_BUCKET}/buildings/conus_h3_building_counts.parquet

Also cached locally at {data_dir}/conus_h3_building_counts.parquet.

Subsequent pipeline runs load this file instead of hitting Overture — making
the per-day CONUS pipeline essentially free on the buildings step.

Usage:
    AWS_PROFILE=jtam python scripts/precompute_buildings.py
    AWS_PROFILE=jtam python scripts/precompute_buildings.py --force  # re-run even if exists
"""

from __future__ import annotations

import argparse
import logging
import sys
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import boto3
import duckdb
import h3 as h3lib
import pandas as pd

sys.path.insert(0, str(Path(__file__).parents[1]))

from src.config import (
    H3_RESOLUTION,
    OVERTURE_BUCKET,
    OVERTURE_CLASSES,
    OVERTURE_RELEASE,
    S3_BUCKET,
)
from src.data_downloader import DEFAULT_DATA_DIR

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)

BUILDINGS_S3_KEY = "buildings/conus_h3_building_counts.parquet"
BUILDINGS_LOCAL_NAME = "conus_h3_building_counts.parquet"
CHUNK_CACHE_DIR_NAME = "conus_buildings_chunks"

_BUILDINGS_PATH = (
    f"s3://{OVERTURE_BUCKET}/release/{OVERTURE_RELEASE}/theme=buildings/type=building/*"
)

# 5°×5° grid covering the continental US
# lat 24–50, lon -126 to -65
_LAT_BANDS = list(range(24, 50, 5)) + [50]   # [24, 29, 34, 39, 44, 50]
_LON_BANDS = list(range(-126, -65, 5)) + [-65]  # [-126, -121, ..., -70, -65]

CONUS_CHUNKS = [
    (lat1, lat2, lon1, lon2)
    for lat1, lat2 in zip(_LAT_BANDS, _LAT_BANDS[1:])
    for lon1, lon2 in zip(_LON_BANDS, _LON_BANDS[1:])
]


def _query_chunk(lat_min, lat_max, lon_min, lon_max) -> pd.DataFrame:
    classes_sql = ", ".join(f"'{c}'" for c in OVERTURE_CLASSES)
    con = duckdb.connect()
    con.execute("INSTALL spatial; LOAD spatial;")
    con.execute("INSTALL httpfs; LOAD httpfs;")
    con.execute("SET s3_region='us-west-2';")
    con.execute("SET memory_limit='4GB';")

    query = f"""
        SELECT
            ST_X(ST_Centroid(geometry)) AS centroid_lon,
            ST_Y(ST_Centroid(geometry)) AS centroid_lat
        FROM read_parquet('{_BUILDINGS_PATH}', hive_partitioning=true)
        WHERE bbox.xmin >= {lon_min}
          AND bbox.xmax <= {lon_max}
          AND bbox.ymin >= {lat_min}
          AND bbox.ymax <= {lat_max}
          AND (class IS NULL OR class IN ({classes_sql}))
    """
    df = con.execute(query).df()
    con.close()

    if df.empty:
        return pd.DataFrame(columns=["h3_index", "building_count"])

    df["h3_index"] = df.apply(
        lambda r: h3lib.latlng_to_cell(r["centroid_lat"], r["centroid_lon"], H3_RESOLUTION),
        axis=1,
    )
    counts = df.groupby("h3_index", as_index=False).size().rename(columns={"size": "building_count"})
    return counts


def _process_chunk(args: tuple) -> str:
    """Worker: query Overture for one chunk and write parquet. Returns chunk path."""
    lat_min, lat_max, lon_min, lon_max, chunk_path_str = args
    chunk_path = Path(chunk_path_str)
    if not chunk_path.exists():
        df = _query_chunk(lat_min, lat_max, lon_min, lon_max)
        df.to_parquet(chunk_path, index=False)
    return chunk_path_str


def run(data_dir: Path, force: bool = False, workers: int = 4) -> None:
    local_path = data_dir / BUILDINGS_LOCAL_NAME
    s3 = boto3.client("s3")

    # Check if already done
    if not force:
        if local_path.exists():
            logger.info("Local precomputed buildings already exist: %s", local_path)
            logger.info("Use --force to recompute. Uploading to S3...")
            s3.upload_file(str(local_path), S3_BUCKET, BUILDINGS_S3_KEY)
            logger.info("Uploaded → s3://%s/%s", S3_BUCKET, BUILDINGS_S3_KEY)
            return
        try:
            s3.head_object(Bucket=S3_BUCKET, Key=BUILDINGS_S3_KEY)
            logger.info("Precomputed buildings already exist in S3. Downloading to local cache...")
            s3.download_file(S3_BUCKET, BUILDINGS_S3_KEY, str(local_path))
            logger.info("Cached locally: %s", local_path)
            return
        except Exception:
            pass

    chunk_dir = data_dir / CHUNK_CACHE_DIR_NAME
    chunk_dir.mkdir(parents=True, exist_ok=True)

    logger.info("Starting CONUS buildings precompute — %d chunks, %d workers", len(CONUS_CHUNKS), workers)

    chunk_args = [
        (lat_min, lat_max, lon_min, lon_max,
         str(chunk_dir / f"chunk_{lat_min}_{lat_max}_{lon_min}_{lon_max}.parquet"))
        for lat_min, lat_max, lon_min, lon_max in CONUS_CHUNKS
    ]

    completed = 0
    with ProcessPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(_process_chunk, args): args for args in chunk_args}
        for future in as_completed(futures):
            completed += 1
            chunk_path_str = future.result()
            lat_min, lat_max, lon_min, lon_max = futures[future][:4]
            logger.info("[%d/%d] done — lat %s–%s, lon %s–%s",
                        completed, len(CONUS_CHUNKS), lat_min, lat_max, lon_min, lon_max)

    all_chunks: list[pd.DataFrame] = []
    for args in chunk_args:
        chunk_path = Path(args[4])
        df = pd.read_parquet(chunk_path)
        if not df.empty:
            all_chunks.append(df)

    if not all_chunks:
        logger.error("No buildings found in any chunk — aborting")
        return

    logger.info("Merging %d chunks...", len(all_chunks))
    merged = pd.concat(all_chunks, ignore_index=True)
    # Re-aggregate in case any H3 cells span chunk boundaries
    merged = merged.groupby("h3_index", as_index=False)["building_count"].sum()
    logger.info("Final: %d unique H3 cells with buildings", len(merged))

    merged.to_parquet(local_path, index=False)
    logger.info("Written locally: %s", local_path)

    s3.upload_file(str(local_path), S3_BUCKET, BUILDINGS_S3_KEY)
    logger.info("Uploaded → s3://%s/%s", S3_BUCKET, BUILDINGS_S3_KEY)
    logger.info("Done. Future runs will load from S3/local cache — no Overture queries needed.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Precompute CONUS H3 building counts from Overture")
    parser.add_argument("--data-dir", default=str(DEFAULT_DATA_DIR))
    parser.add_argument("--force", action="store_true", help="Recompute even if output already exists")
    parser.add_argument("--workers", type=int, default=4, help="Parallel DuckDB workers (default: 4)")
    args = parser.parse_args()
    run(Path(args.data_dir), force=args.force, workers=args.workers)
