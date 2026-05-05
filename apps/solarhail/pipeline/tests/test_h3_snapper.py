"""Tests for h3_snapper.py (Module 2).

All tests are pure unit tests — no I/O, no external dependencies.
H3 cell arithmetic is deterministic given fixed lat/lon inputs.

Run:
    pytest tests/test_h3_snapper.py -v
"""

from datetime import datetime, timezone

import h3
import pandas as pd
import pytest

from src.config import H3_RESOLUTION
from src.h3_snapper import snap_to_h3
from src.mrms_reader import HailPixel

# Fixed timestamp used across tests
TS = datetime(2026, 4, 15, 20, 0, tzinfo=timezone.utc)

# OKC center — well inside the metro bbox
OKC_LAT, OKC_LON = 35.47, -97.52


def _pixel(lat=OKC_LAT, lon=OKC_LON, mesh=30.0, ts=TS):
    return HailPixel(lat=lat, lon=lon, mesh_mm=mesh, timestamp=ts)


# ── snap_to_h3 ────────────────────────────────────────────────────────────────

def test_snap_single_pixel():
    """One pixel → one or more H3 cells (areal fill), all with correct values."""
    df = snap_to_h3([_pixel(mesh=42.0)], "okc")

    assert len(df) >= 1
    assert (df["max_mesh_mm"] == 42.0).all()
    assert (df["metro_id"] == "okc").all()
    assert (df["timestamp"] == TS).all()
    assert all(isinstance(c, str) and len(c) == 15 for c in df["h3_index"])


def test_snap_resolution_is_8():
    """H3 cells must be resolution 8."""
    df = snap_to_h3([_pixel()], "dfw")
    cell = df.iloc[0]["h3_index"]
    assert h3.get_resolution(cell) == H3_RESOLUTION == 8


def test_snap_takes_max_mesh_per_cell():
    """Two pixels overlapping the same H3 cell → max MESH is kept, not first or mean."""
    cell = h3.latlng_to_cell(OKC_LAT, OKC_LON, H3_RESOLUTION)
    lat_c, lon_c = h3.cell_to_latlng(cell)

    px_low  = _pixel(lat=lat_c,          lon=lon_c,          mesh=20.0)
    px_high = _pixel(lat=lat_c + 0.0001, lon=lon_c + 0.0001, mesh=55.0)

    # Verify both pixels center in the same H3 cell
    assert h3.latlng_to_cell(px_low.lat,  px_low.lon,  H3_RESOLUTION) == cell
    assert h3.latlng_to_cell(px_high.lat, px_high.lon, H3_RESOLUTION) == cell

    df = snap_to_h3([px_low, px_high], "okc")

    assert cell in df["h3_index"].values, "Target cell must appear in output"
    row = df.loc[df["h3_index"] == cell]
    assert row.iloc[0]["max_mesh_mm"] == 55.0


def test_snap_multiple_distinct_cells():
    """Pixels in well-separated cells each produce rows for their respective cells."""
    cell_a = h3.latlng_to_cell(OKC_LAT, OKC_LON, H3_RESOLUTION)
    # Use ring-3 neighbours so pixel polygons (~0.01°) can't overlap
    ring3 = [c for c in h3.grid_disk(cell_a, 3) if c not in h3.grid_disk(cell_a, 2)]
    cell_b = ring3[0]

    lat_a, lon_a = h3.cell_to_latlng(cell_a)
    lat_b, lon_b = h3.cell_to_latlng(cell_b)

    df = snap_to_h3([
        _pixel(lat=lat_a, lon=lon_a, mesh=30.0),
        _pixel(lat=lat_b, lon=lon_b, mesh=45.0),
    ], "okc")

    assert cell_a in df["h3_index"].values
    assert cell_b in df["h3_index"].values
    assert df.loc[df["h3_index"] == cell_a, "max_mesh_mm"].iloc[0] == 30.0
    assert df.loc[df["h3_index"] == cell_b, "max_mesh_mm"].iloc[0] == 45.0


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

    px1 = HailPixel(lat=lat_c,          lon=lon_c, mesh_mm=30.0, timestamp=ts_first)
    px2 = HailPixel(lat=lat_c + 0.0001, lon=lon_c, mesh_mm=25.0, timestamp=ts_second)

    df = snap_to_h3([px1, px2], "okc")
    assert cell in df["h3_index"].values
    assert df.loc[df["h3_index"] == cell, "timestamp"].iloc[0] == ts_first
