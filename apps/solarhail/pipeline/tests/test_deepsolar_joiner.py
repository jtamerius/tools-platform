"""Tests for deepsolar_joiner.py (Module 4).

All unit tests build synthetic data in-memory — no file I/O, no external downloads.

Run:
    pytest tests/test_deepsolar_joiner.py -v
"""

from io import StringIO
from pathlib import Path
from unittest.mock import patch

import geopandas as gpd
import h3
import numpy as np
import pandas as pd
import pytest
from shapely.geometry import Point, Polygon

from src.config import DEEPSOLAR_BG_FIPS_COL, DEEPSOLAR_COUNT_COL, H3_RESOLUTION
from src.deepsolar_joiner import assign_solar_to_h3

# ── synthetic data factories ──────────────────────────────────────────────────

# OKC area H3 cell for deterministic tests
_OKC_CELL = h3.latlng_to_cell(35.47, -97.52, H3_RESOLUTION)
_OKC_LAT, _OKC_LON = h3.cell_to_latlng(_OKC_CELL)

# A 1°×1° box that contains _OKC_CELL
_BG_POLY = Polygon([
    (-98.0, 35.0), (-97.0, 35.0), (-97.0, 36.0), (-98.0, 36.0), (-98.0, 35.0)
])
_BG_FIPS = "400970001001"  # 12-digit dummy FIPS


def _make_deepsolar_csv(fips: str, solar_count: float, tmp_path: Path) -> Path:
    df = pd.DataFrame({
        DEEPSOLAR_BG_FIPS_COL: [fips],
        DEEPSOLAR_COUNT_COL: [solar_count],
    })
    p = tmp_path / "deepsolar.csv"
    df.to_csv(p, index=False)
    return p


def _make_tiger_shp(fips: str, polygon: Polygon, tmp_path: Path) -> Path:
    gdf = gpd.GeoDataFrame(
        {"GEOID": [fips], "geometry": [polygon]},
        crs="EPSG:4326",
    )
    p = tmp_path / "bg.shp"
    gdf.to_file(str(p))
    return p


def _h3_buildings(cells_counts: dict) -> pd.DataFrame:
    return pd.DataFrame([
        {"h3_index": cell, "building_count": cnt}
        for cell, cnt in cells_counts.items()
    ])


# ── assign_solar_to_h3 ────────────────────────────────────────────────────────

def test_single_cell_full_block_group(tmp_path):
    """One cell in a block group → cell gets 100% of solar count."""
    csv = _make_deepsolar_csv(_BG_FIPS, 50.0, tmp_path)
    shp = _make_tiger_shp(_BG_FIPS, _BG_POLY, tmp_path)
    buildings = _h3_buildings({_OKC_CELL: 10})

    result = assign_solar_to_h3(buildings, csv, shp)

    assert len(result) == 1
    assert result.iloc[0]["h3_index"] == _OKC_CELL
    assert abs(result.iloc[0]["estimated_solar_systems"] - 50.0) < 0.01


def test_proportional_disaggregation(tmp_path):
    """Two cells with different building counts → solar split proportionally."""
    # Get two neighboring cells, both inside _BG_POLY
    neighbors = [c for c in h3.grid_disk(_OKC_CELL, 1) if c != _OKC_CELL]
    cell_b = neighbors[0]
    lat_b, lon_b = h3.cell_to_latlng(cell_b)

    # Make sure cell_b is inside the polygon too
    if not _BG_POLY.contains(Point(lon_b, lat_b)):
        pytest.skip("Neighbor cell outside synthetic block group — geometry mismatch")

    csv = _make_deepsolar_csv(_BG_FIPS, 100.0, tmp_path)
    shp = _make_tiger_shp(_BG_FIPS, _BG_POLY, tmp_path)
    buildings = _h3_buildings({_OKC_CELL: 3, cell_b: 1})  # 3:1 split → 75:25

    result = assign_solar_to_h3(buildings, csv, shp)

    assert len(result) == 2
    by_cell = result.set_index("h3_index")["estimated_solar_systems"]
    assert abs(by_cell[_OKC_CELL] - 75.0) < 0.01
    assert abs(by_cell[cell_b] - 25.0) < 0.01


def test_zero_solar_count(tmp_path):
    """Block group with zero solar installations → all cells get 0."""
    csv = _make_deepsolar_csv(_BG_FIPS, 0.0, tmp_path)
    shp = _make_tiger_shp(_BG_FIPS, _BG_POLY, tmp_path)
    buildings = _h3_buildings({_OKC_CELL: 5})

    result = assign_solar_to_h3(buildings, csv, shp)

    assert len(result) == 1
    assert result.iloc[0]["estimated_solar_systems"] == 0.0


def test_cell_outside_all_block_groups_excluded(tmp_path):
    """Cell whose centroid falls outside all block groups is excluded from output."""
    # Use a cell far from _BG_POLY (Hawaii area)
    hi_cell = h3.latlng_to_cell(21.3, -157.8, H3_RESOLUTION)

    csv = _make_deepsolar_csv(_BG_FIPS, 50.0, tmp_path)
    shp = _make_tiger_shp(_BG_FIPS, _BG_POLY, tmp_path)
    buildings = _h3_buildings({hi_cell: 10})

    result = assign_solar_to_h3(buildings, csv, shp)

    assert len(result) == 0


def test_missing_deepsolar_fips_gets_zero(tmp_path):
    """Block group in TIGER but absent from DeepSolar CSV → treated as 0 solar."""
    # CSV has a different FIPS
    other_fips = "999999999999"
    csv = _make_deepsolar_csv(other_fips, 100.0, tmp_path)
    shp = _make_tiger_shp(_BG_FIPS, _BG_POLY, tmp_path)
    buildings = _h3_buildings({_OKC_CELL: 5})

    result = assign_solar_to_h3(buildings, csv, shp)

    assert len(result) == 1
    assert result.iloc[0]["estimated_solar_systems"] == 0.0


def test_output_columns(tmp_path):
    """Output DataFrame has exactly h3_index and estimated_solar_systems."""
    csv = _make_deepsolar_csv(_BG_FIPS, 10.0, tmp_path)
    shp = _make_tiger_shp(_BG_FIPS, _BG_POLY, tmp_path)
    buildings = _h3_buildings({_OKC_CELL: 2})

    result = assign_solar_to_h3(buildings, csv, shp)

    assert set(result.columns) == {"h3_index", "estimated_solar_systems"}


def test_empty_buildings_returns_empty(tmp_path):
    """Empty h3_building_counts → empty result with correct columns."""
    csv = _make_deepsolar_csv(_BG_FIPS, 50.0, tmp_path)
    shp = _make_tiger_shp(_BG_FIPS, _BG_POLY, tmp_path)
    buildings = pd.DataFrame(columns=["h3_index", "building_count"])

    result = assign_solar_to_h3(buildings, csv, shp)

    assert isinstance(result, pd.DataFrame)
    assert len(result) == 0


def test_solar_conservation(tmp_path):
    """Sum of estimated_solar_systems ≤ total bg_solar (proportional, no inflation)."""
    neighbors = [c for c in h3.grid_disk(_OKC_CELL, 2)]
    # Keep only cells inside _BG_POLY
    inside = []
    for c in neighbors:
        lat, lon = h3.cell_to_latlng(c)
        if _BG_POLY.contains(Point(lon, lat)):
            inside.append(c)

    if len(inside) < 2:
        pytest.skip("Too few cells inside synthetic block group")

    bg_solar = 200.0
    csv = _make_deepsolar_csv(_BG_FIPS, bg_solar, tmp_path)
    shp = _make_tiger_shp(_BG_FIPS, _BG_POLY, tmp_path)
    buildings = _h3_buildings({c: 5 for c in inside})

    result = assign_solar_to_h3(buildings, csv, shp)

    assert result["estimated_solar_systems"].sum() <= bg_solar + 0.01
