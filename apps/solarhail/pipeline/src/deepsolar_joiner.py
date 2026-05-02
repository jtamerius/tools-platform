"""Module 4: Join DeepSolar-3M block-group solar counts to H3 cells via centroid-in-block-group lookup.

Data sources:
  DeepSolar-3M: https://github.com/rajanieprabha/DeepSolar-3M/blob/main/dataset/blockgroup_level_data.csv
    - Geographic unit: census block group (12-digit FIPS)
    - Solar count column: "Total PV system count"

  Census TIGER 2023 national BG shapefile (fetched by data_downloader):
    https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_bg_500k.zip
    - GEOID column: 12-digit block group FIPS

Assignment strategy: centroid of each H3 cell → census block group (point-in-polygon).
Within each block group, cell_solar = bg_solar * (cell_buildings / bg_total_buildings).
Block groups with zero Overture buildings are skipped (no denominator).
"""

from __future__ import annotations

import logging
from pathlib import Path

import geopandas as gpd
import h3
import pandas as pd
from shapely.geometry import Point

from .config import DEEPSOLAR_BG_FIPS_COL, DEEPSOLAR_COUNT_COL

logger = logging.getLogger(__name__)


def _h3_centroid(h3_index: str) -> Point:
    lat, lon = h3.cell_to_latlng(h3_index)
    return Point(lon, lat)


def assign_solar_to_h3(
    h3_building_counts: pd.DataFrame,
    deepsolar_csv: str | Path,
    tiger_shp: str | Path,
) -> pd.DataFrame:
    """Disaggregate block-group solar counts to H3 cells proportional to building count.

    Args:
        h3_building_counts: DataFrame with h3_index, building_count (Module 3 output).
        deepsolar_csv: Path to DeepSolar-3M blockgroup_level_data.csv.
        tiger_shp: Path to Census TIGER 2023 national block group .shp (cb_2023_us_bg_500k.shp).
                   GEOID column must contain 12-digit block group FIPS.

    Returns:
        DataFrame with columns: h3_index, estimated_solar_systems.
    """
    deepsolar = pd.read_csv(deepsolar_csv, dtype={DEEPSOLAR_BG_FIPS_COL: str})
    deepsolar = (
        deepsolar[[DEEPSOLAR_BG_FIPS_COL, DEEPSOLAR_COUNT_COL]]
        .rename(columns={DEEPSOLAR_BG_FIPS_COL: "bg_fips", DEEPSOLAR_COUNT_COL: "bg_solar"})
    )

    block_groups = gpd.read_file(str(tiger_shp))
    block_groups = block_groups[["GEOID", "geometry"]].rename(columns={"GEOID": "bg_fips"})
    block_groups = block_groups.merge(deepsolar, on="bg_fips", how="left")
    block_groups["bg_solar"] = block_groups["bg_solar"].fillna(0.0)
    block_groups = block_groups.to_crs("EPSG:4326")

    # Point-in-polygon: assign each H3 cell centroid to a block group
    cells = h3_building_counts.copy()
    cells["geometry"] = cells["h3_index"].apply(_h3_centroid)
    cells_gdf = gpd.GeoDataFrame(cells, geometry="geometry", crs="EPSG:4326")

    joined = gpd.sjoin(
        cells_gdf,
        block_groups[["bg_fips", "bg_solar", "geometry"]],
        how="left",
        predicate="within",
    )
    joined["bg_solar"] = joined["bg_solar"].fillna(0.0)

    # Denominator: total buildings per block group
    bg_totals = joined.groupby("bg_fips")["building_count"].sum().rename("bg_total_buildings")
    joined = joined.join(bg_totals, on="bg_fips")

    mask = joined["bg_total_buildings"] > 0
    joined.loc[mask, "estimated_solar_systems"] = (
        joined.loc[mask, "bg_solar"]
        * joined.loc[mask, "building_count"]
        / joined.loc[mask, "bg_total_buildings"]
    )

    result = joined[mask][["h3_index", "estimated_solar_systems"]].copy()
    logger.info(
        "Solar assignment: %d / %d cells with data (%.1f%% coverage)",
        len(result), len(cells), 100 * len(result) / max(len(cells), 1),
    )
    return result.reset_index(drop=True)
