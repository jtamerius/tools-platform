"""Module 5: Join hail H3 data with solar estimates to produce exposure output."""

from __future__ import annotations

import logging

import pandas as pd

logger = logging.getLogger(__name__)

FINAL_SCHEMA = [
    "h3_index",
    "max_mesh_mm",
    "timestamp",
    "metro_id",
    "solar_systems_exposed",
    "commercial_capacity_mwdc",
]


def calculate_impact(
    hail_cells: pd.DataFrame,
    solar_cells: pd.DataFrame,
    commercial_cells: pd.DataFrame | None = None,
) -> pd.DataFrame:
    """Join hail events with residential and commercial solar exposure.

    Args:
        hail_cells: Module 2 output (h3_index, max_mesh_mm, timestamp, metro_id).
        solar_cells: Module 4 output (h3_index, estimated_solar_systems).
        commercial_cells: USPVDB aggregated output (h3_index, capacity_mwdc). Optional.

    Returns:
        DataFrame with FINAL_SCHEMA columns. All hail cells are returned;
        solar_systems_exposed and commercial_capacity_mwdc are 0 where no match.
    """
    merged = hail_cells.merge(solar_cells, on="h3_index", how="left")
    merged = merged.rename(columns={"estimated_solar_systems": "solar_systems_exposed"})
    merged["solar_systems_exposed"] = merged["solar_systems_exposed"].fillna(0)

    if commercial_cells is not None and not commercial_cells.empty:
        merged = merged.merge(
            commercial_cells[["h3_index", "capacity_mwdc"]],
            on="h3_index",
            how="left",
        )
        merged = merged.rename(columns={"capacity_mwdc": "commercial_capacity_mwdc"})
    else:
        merged["commercial_capacity_mwdc"] = 0.0

    merged["commercial_capacity_mwdc"] = merged["commercial_capacity_mwdc"].fillna(0.0)

    result = merged[FINAL_SCHEMA].copy()
    solar_matched = (result["solar_systems_exposed"] > 0).sum()
    commercial_matched = (result["commercial_capacity_mwdc"] > 0).sum()
    logger.info(
        "Exposure: %d hail cells — %d residential (%.1f%%), %d commercial (%.1f%%)",
        len(result),
        solar_matched, 100 * solar_matched / max(len(result), 1),
        commercial_matched, 100 * commercial_matched / max(len(result), 1),
    )
    return result
