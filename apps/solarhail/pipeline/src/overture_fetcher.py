"""Module 3: Fetch Overture buildings for a metro bbox via DuckDB, snap to H3 cells."""

from __future__ import annotations

import logging
from pathlib import Path

import duckdb
import pandas as pd

from .config import (
    H3_RESOLUTION,
    METROS,
    OVERTURE_BUCKET,
    OVERTURE_CLASSES,
    OVERTURE_RELEASE,
    metro_bbox,
)

logger = logging.getLogger(__name__)

_BUILDINGS_PATH = (
    f"s3://{OVERTURE_BUCKET}/release/{OVERTURE_RELEASE}/theme=buildings/type=building/*"
)


def _fetch_buildings_for_bbox(
    lat_min: float,
    lat_max: float,
    lon_min: float,
    lon_max: float,
    label: str = "",
) -> pd.DataFrame:
    """Query Overture S3 for buildings within a lat/lon bbox, snap centroids to H3 res 8.

    Returns DataFrame with columns: h3_index, building_count.
    """
    classes_sql = ", ".join(f"'{c}'" for c in OVERTURE_CLASSES)

    con = duckdb.connect()
    con.execute("INSTALL spatial; LOAD spatial;")
    con.execute("INSTALL httpfs; LOAD httpfs;")
    con.execute("SET s3_region='us-west-2';")

    logger.info("Querying Overture buildings%s", f" for {label}" if label else "")

    # class IS NULL covers the ~94% of Overture buildings with no classification tag;
    # ST_Area is omitted because OGC:CRS84 geometry returns sq-degrees, not sq-meters.
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

    buildings = con.execute(query).df()
    con.close()

    if buildings.empty:
        logger.warning("No buildings found%s", f" for {label}" if label else "")
        return pd.DataFrame(columns=["h3_index", "building_count"])

    import h3
    buildings["h3_index"] = buildings.apply(
        lambda r: h3.latlng_to_cell(r["centroid_lat"], r["centroid_lon"], H3_RESOLUTION), axis=1
    )

    counts = buildings.groupby("h3_index", as_index=False).size().rename(columns={"size": "building_count"})
    logger.info("%d buildings → %d H3 cells%s", len(buildings), len(counts), f" ({label})" if label else "")
    return counts


def fetch_buildings(metro_id: str) -> pd.DataFrame:
    """Query Overture S3 for buildings within a metro bbox, snap centroids to H3 res 8.

    Args:
        metro_id: Key from config.METROS.

    Returns:
        DataFrame with columns: h3_index, building_count.
    """
    if metro_id not in METROS:
        raise ValueError(f"Unknown metro_id: {metro_id}")
    lat_min, lat_max, lon_min, lon_max = metro_bbox(metro_id)
    return _fetch_buildings_for_bbox(lat_min, lat_max, lon_min, lon_max, label=f"metro {metro_id}")


def fetch_buildings_bbox(bbox: tuple[float, float, float, float]) -> pd.DataFrame:
    """Query Overture S3 for buildings within an arbitrary lat/lon bbox.

    Args:
        bbox: (lat_min, lat_max, lon_min, lon_max)

    Returns:
        DataFrame with columns: h3_index, building_count.
    """
    lat_min, lat_max, lon_min, lon_max = bbox
    return _fetch_buildings_for_bbox(lat_min, lat_max, lon_min, lon_max, label=f"bbox {lat_min:.2f}–{lat_max:.2f}, {lon_min:.2f}–{lon_max:.2f}")


_PRECOMPUTED_S3_KEY = "buildings/conus_h3_building_counts.parquet"
_PRECOMPUTED_LOCAL_NAME = "conus_h3_building_counts.parquet"


def load_precomputed_buildings(
    data_dir: "Path | None" = None,
    s3_client=None,
) -> "pd.DataFrame | None":
    """Load precomputed CONUS building counts from local cache or S3.

    Returns DataFrame with columns h3_index, building_count, or None if not found.
    Run scripts/precompute_buildings.py once to create this file.
    """
    from .data_downloader import DEFAULT_DATA_DIR
    if data_dir is None:
        data_dir = DEFAULT_DATA_DIR

    local_path = Path(data_dir) / _PRECOMPUTED_LOCAL_NAME

    if local_path.exists():
        logger.info("Loading precomputed buildings from local cache: %s", local_path)
        return pd.read_parquet(local_path)

    try:
        from .config import S3_BUCKET
        import boto3
        if s3_client is None:
            s3_client = boto3.client("s3")
        logger.info("Downloading precomputed buildings from s3://%s/%s", S3_BUCKET, _PRECOMPUTED_S3_KEY)
        local_path.parent.mkdir(parents=True, exist_ok=True)
        s3_client.download_file(S3_BUCKET, _PRECOMPUTED_S3_KEY, str(local_path))
        logger.info("Cached precomputed buildings locally: %s", local_path)
        return pd.read_parquet(local_path)
    except Exception as e:
        logger.warning("Could not load precomputed buildings from S3: %s", e)
        return None
