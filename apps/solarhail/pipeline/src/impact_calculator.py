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
]


def calculate_impact(
    hail_cells: pd.DataFrame,
    solar_cells: pd.DataFrame,
) -> pd.DataFrame:
    """Join hail events with solar estimates to show exposure.

    Args:
        hail_cells: Module 2 output (h3_index, max_mesh_mm, timestamp, metro_id).
        solar_cells: Module 4 output (h3_index, estimated_solar_systems).

    Returns:
        DataFrame with FINAL_SCHEMA columns: one row per H3 cell that had both
        hail and solar installations. solar_systems_exposed is the estimated
        number of systems in the cell at the time of the hail event.
        Cells not matched to solar data are dropped.
    """
    merged = hail_cells.merge(solar_cells, on="h3_index", how="inner")
    merged = merged.rename(columns={"estimated_solar_systems": "solar_systems_exposed"})

    result = merged[FINAL_SCHEMA].copy()
    logger.info(
        "Exposure: %d hail cells → %d cells with solar data (%.1f%% matched)",
        len(hail_cells), len(result), 100 * len(result) / max(len(hail_cells), 1),
    )
    return result
