"""Module 2: Snap hail pixels to H3 res-8 cells, take max MESH per cell, write Parquet.

Each MRMS pixel covers a 0.01° × 0.01° area (~0.91×1.11 km at 35°N), which is
larger than a single H3 res-8 cell (~0.74 km²). Using only the pixel centroid
would leave systematic gaps (stripes) where H3 cells fall between pixel centers.
Instead, we build the pixel's bounding polygon and fill every H3 cell it overlaps.
"""

from __future__ import annotations

import logging
from datetime import datetime
from pathlib import Path

import h3
import pandas as pd

from .config import H3_RESOLUTION
from .mrms_reader import HailPixel

logger = logging.getLogger(__name__)


def snap_to_h3(pixels: list[HailPixel], metro_id: str) -> pd.DataFrame:
    """Group hail pixels by H3 cell, taking max MESH per cell.

    Args:
        pixels: Output of mrms_reader.read_mrms_pixels().
        metro_id: Metro identifier stored in output.

    Returns:
        DataFrame with columns: h3_index, max_mesh_mm, timestamp, metro_id.
        One row per affected H3 cell.
    """
    if not pixels:
        logger.warning("No pixels for metro %s — returning empty DataFrame", metro_id)
        return pd.DataFrame(columns=["h3_index", "max_mesh_mm", "timestamp", "metro_id"])

    # Half the MRMS grid spacing (0.01°) — pixel boundary extends ±0.005° from centre.
    half = 0.005

    rows = []
    for px in pixels:
        poly = h3.LatLngPoly([
            (px.lat - half, px.lon - half),
            (px.lat - half, px.lon + half),
            (px.lat + half, px.lon + half),
            (px.lat + half, px.lon - half),
        ])
        for cell in h3.h3shape_to_cells(poly, H3_RESOLUTION):
            rows.append({"h3_index": cell, "max_mesh_mm": px.mesh_mm, "timestamp": px.timestamp})

    df = pd.DataFrame(rows)
    # Take max MESH when multiple pixels map to same cell in the same file
    agg = (
        df.groupby("h3_index", as_index=False)
        .agg(max_mesh_mm=("max_mesh_mm", "max"), timestamp=("timestamp", "first"))
    )
    agg["metro_id"] = metro_id
    logger.info("Snapped %d pixels → %d H3 cells (res %d)", len(pixels), len(agg), H3_RESOLUTION)
    return agg


