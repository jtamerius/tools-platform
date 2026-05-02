"""Module 3: Fetch Overture buildings for a metro bbox via DuckDB, snap to H3 cells."""

from __future__ import annotations

import logging

import duckdb
import pandas as pd

from .config import (
    BUILDING_AREA_MAX_SQM,
    BUILDING_AREA_MIN_SQM,
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


def fetch_buildings(metro_id: str) -> pd.DataFrame:
    """Query Overture S3 for filtered residential/commercial buildings within metro bbox.

    Uses DuckDB with spatial extension — no local download. Centroids snapped to H3 res 8.

    Args:
        metro_id: Key from config.METROS.

    Returns:
        DataFrame with columns: h3_index, building_count.
    """
    if metro_id not in METROS:
        raise ValueError(f"Unknown metro_id: {metro_id}")

    lat_min, lat_max, lon_min, lon_max = metro_bbox(metro_id)
    classes_sql = ", ".join(f"'{c}'" for c in OVERTURE_CLASSES)

    con = duckdb.connect()
    con.execute("INSTALL spatial; LOAD spatial;")
    con.execute("INSTALL httpfs; LOAD httpfs;")
    con.execute("SET s3_region='us-west-2';")

    logger.info("Querying Overture buildings for metro %s", metro_id)

    query = f"""
        SELECT
            ST_X(ST_Centroid(geometry)) AS centroid_lon,
            ST_Y(ST_Centroid(geometry)) AS centroid_lat
        FROM read_parquet('{_BUILDINGS_PATH}', hive_partitioning=true)
        WHERE bbox.xmin >= {lon_min}
          AND bbox.xmax <= {lon_max}
          AND bbox.ymin >= {lat_min}
          AND bbox.ymax <= {lat_max}
          AND class IN ({classes_sql})
          AND ST_Area(geometry) BETWEEN {BUILDING_AREA_MIN_SQM} AND {BUILDING_AREA_MAX_SQM}
    """

    buildings = con.execute(query).df()
    con.close()

    if buildings.empty:
        logger.warning("No buildings found for metro %s", metro_id)
        return pd.DataFrame(columns=["h3_index", "building_count"])

    import h3
    buildings["h3_index"] = buildings.apply(
        lambda r: h3.latlng_to_cell(r["centroid_lat"], r["centroid_lon"], H3_RESOLUTION), axis=1
    )

    counts = buildings.groupby("h3_index", as_index=False).size().rename(columns={"size": "building_count"})
    logger.info("Metro %s: %d buildings → %d H3 cells", metro_id, len(buildings), len(counts))
    return counts
