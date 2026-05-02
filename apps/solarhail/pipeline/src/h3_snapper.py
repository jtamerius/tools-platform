"""Module 2: Snap hail pixels to H3 res-8 cells, take max MESH per cell, write Parquet."""

from __future__ import annotations

import logging
from datetime import datetime
from pathlib import Path

import h3
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from .config import H3_RESOLUTION
from .mrms_reader import HailPixel

logger = logging.getLogger(__name__)

PARQUET_SCHEMA = pa.schema([
    pa.field("h3_index", pa.string()),
    pa.field("max_mesh_mm", pa.float32()),
    pa.field("timestamp", pa.timestamp("s", tz="UTC")),
    pa.field("metro_id", pa.string()),
])


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

    rows = []
    for px in pixels:
        cell = h3.latlng_to_cell(px.lat, px.lon, H3_RESOLUTION)
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


def write_parquet(df: pd.DataFrame, path: str | Path) -> None:
    """Write snapped H3 DataFrame to Parquet using the canonical schema."""
    table = pa.Table.from_pandas(df, schema=PARQUET_SCHEMA, preserve_index=False)
    pq.write_table(table, str(path))
    logger.info("Wrote %d rows to %s", len(df), path)
