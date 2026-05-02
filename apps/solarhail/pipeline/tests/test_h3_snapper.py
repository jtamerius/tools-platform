"""Tests for h3_snapper.py (Module 2).

All tests are pure unit tests — no I/O, no external dependencies.
H3 cell arithmetic is deterministic given fixed lat/lon inputs.

Run:
    pytest tests/test_h3_snapper.py -v
"""

from datetime import datetime, timezone
from pathlib import Path

import h3
import pandas as pd
import pyarrow.parquet as pq
import pytest

from src.config import H3_RESOLUTION
from src.h3_snapper import PARQUET_SCHEMA, snap_to_h3, write_parquet
from src.mrms_reader import HailPixel

# Fixed timestamp used across tests
TS = datetime(2026, 4, 15, 20, 0, tzinfo=timezone.utc)

# OKC center — well inside the metro bbox
OKC_LAT, OKC_LON = 35.47, -97.52


def _pixel(lat=OKC_LAT, lon=OKC_LON, mesh=30.0, ts=TS):
    return HailPixel(lat=lat, lon=lon, mesh_mm=mesh, timestamp=ts)


# ── snap_to_h3 ────────────────────────────────────────────────────────────────

def test_snap_single_pixel():
    """One pixel → one H3 cell row with correct values."""
    df = snap_to_h3([_pixel(mesh=42.0)], "okc")

    assert len(df) == 1
    assert df.iloc[0]["max_mesh_mm"] == 42.0
    assert df.iloc[0]["metro_id"] == "okc"
    assert df.iloc[0]["timestamp"] == TS
    assert isinstance(df.iloc[0]["h3_index"], str)
    assert len(df.iloc[0]["h3_index"]) == 15  # H3 res-8 index is 15 hex chars


def test_snap_resolution_is_8():
    """H3 cells must be resolution 8."""
    df = snap_to_h3([_pixel()], "dfw")
    cell = df.iloc[0]["h3_index"]
    assert h3.get_resolution(cell) == H3_RESOLUTION == 8


def test_snap_takes_max_mesh_per_cell():
    """Two pixels mapping to the same H3 cell → max MESH is kept, not first or mean."""
    cell = h3.latlng_to_cell(OKC_LAT, OKC_LON, H3_RESOLUTION)
    # Offset both pixels by tiny amounts so they still land in the same cell
    lat_c, lon_c = h3.cell_to_latlng(cell)

    px_low  = _pixel(lat=lat_c,       lon=lon_c,        mesh=20.0)
    px_high = _pixel(lat=lat_c + 0.0001, lon=lon_c + 0.0001, mesh=55.0)

    # Verify they actually map to the same cell
    assert h3.latlng_to_cell(px_low.lat,  px_low.lon,  H3_RESOLUTION) == cell
    assert h3.latlng_to_cell(px_high.lat, px_high.lon, H3_RESOLUTION) == cell

    df = snap_to_h3([px_low, px_high], "okc")

    assert len(df) == 1, "Two pixels in the same cell should produce one row"
    assert df.iloc[0]["max_mesh_mm"] == 55.0


def test_snap_multiple_distinct_cells():
    """Pixels in different cells each produce their own row."""
    # Use H3 neighbors — guaranteed different cells
    cell_a = h3.latlng_to_cell(OKC_LAT, OKC_LON, H3_RESOLUTION)
    neighbors = [c for c in h3.grid_disk(cell_a, 1) if c != cell_a]
    cell_b = neighbors[0]

    lat_a, lon_a = h3.cell_to_latlng(cell_a)
    lat_b, lon_b = h3.cell_to_latlng(cell_b)

    df = snap_to_h3([
        _pixel(lat=lat_a, lon=lon_a, mesh=30.0),
        _pixel(lat=lat_b, lon=lon_b, mesh=45.0),
    ], "okc")

    assert len(df) == 2
    assert set(df["h3_index"]) == {cell_a, cell_b}
    mesh_by_cell = df.set_index("h3_index")["max_mesh_mm"]
    assert mesh_by_cell[cell_a] == 30.0
    assert mesh_by_cell[cell_b] == 45.0


def test_snap_empty_pixels_returns_empty_dataframe():
    """Empty input → empty DataFrame with correct columns, no error."""
    df = snap_to_h3([], "okc")

    assert isinstance(df, pd.DataFrame)
    assert len(df) == 0
    for col in ("h3_index", "max_mesh_mm", "timestamp", "metro_id"):
        assert col in df.columns


def test_snap_metro_id_propagated():
    """metro_id column is set to the passed metro_id for all rows."""
    pixels = [_pixel(lat=OKC_LAT + i * 0.3, mesh=25.0 + i) for i in range(5)]
    df = snap_to_h3(pixels, "tulsa")
    assert (df["metro_id"] == "tulsa").all()


def test_snap_timestamp_is_first_seen():
    """When multiple pixels share a cell, timestamp comes from the first pixel."""
    cell = h3.latlng_to_cell(OKC_LAT, OKC_LON, H3_RESOLUTION)
    lat_c, lon_c = h3.cell_to_latlng(cell)

    ts_first  = datetime(2026, 4, 15, 18, 0, tzinfo=timezone.utc)
    ts_second = datetime(2026, 4, 15, 19, 0, tzinfo=timezone.utc)

    px1 = HailPixel(lat=lat_c, lon=lon_c, mesh_mm=30.0, timestamp=ts_first)
    px2 = HailPixel(lat=lat_c + 0.0001, lon=lon_c, mesh_mm=25.0, timestamp=ts_second)

    df = snap_to_h3([px1, px2], "okc")
    assert len(df) == 1
    assert df.iloc[0]["timestamp"] == ts_first


# ── write_parquet / schema ────────────────────────────────────────────────────

def test_write_parquet_creates_file(tmp_path):
    """write_parquet creates a file at the given path."""
    df = snap_to_h3([_pixel()], "okc")
    out = tmp_path / "test.parquet"
    write_parquet(df, out)
    assert out.exists()
    assert out.stat().st_size > 0


def test_write_parquet_schema(tmp_path):
    """Written Parquet has the canonical schema — correct column names and types."""
    df = snap_to_h3([_pixel(mesh=33.0)], "okc")
    out = tmp_path / "test.parquet"
    write_parquet(df, out)

    table = pq.read_table(str(out))
    assert set(table.column_names) == {"h3_index", "max_mesh_mm", "timestamp", "metro_id"}
    assert str(table.schema.field("h3_index").type) == "string"
    assert str(table.schema.field("max_mesh_mm").type) == "float"
    assert "timestamp" in str(table.schema.field("timestamp").type)
    assert str(table.schema.field("metro_id").type) == "string"


def test_write_parquet_roundtrip(tmp_path):
    """Data written and read back matches the original values."""
    cell = h3.latlng_to_cell(OKC_LAT, OKC_LON, H3_RESOLUTION)
    lat_c, lon_c = h3.cell_to_latlng(cell)

    pixels = [
        HailPixel(lat=lat_c, lon=lon_c, mesh_mm=38.5, timestamp=TS),
    ]
    df = snap_to_h3(pixels, "okc")
    out = tmp_path / "roundtrip.parquet"
    write_parquet(df, out)

    back = pd.read_parquet(str(out))
    assert len(back) == 1
    assert back.iloc[0]["h3_index"] == cell
    assert abs(back.iloc[0]["max_mesh_mm"] - 38.5) < 0.01  # float32 tolerance
    assert back.iloc[0]["metro_id"] == "okc"


def test_write_parquet_empty_dataframe(tmp_path):
    """write_parquet handles an empty DataFrame without error."""
    df = snap_to_h3([], "okc")
    out = tmp_path / "empty.parquet"
    write_parquet(df, out)
    assert out.exists()
    back = pd.read_parquet(str(out))
    assert len(back) == 0
