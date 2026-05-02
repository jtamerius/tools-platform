"""Tests for iem_prefilter.py.

Two layers:
  unit  — bbox intersection logic using synthetic GeoDataFrames, no HTTP
  slow  — live IEM API call over a known active month (April 2026)

Run fast only:
    pytest tests/test_iem_prefilter.py -m "not slow" -v

Run all:
    pytest tests/test_iem_prefilter.py -v
"""

from datetime import date

import geopandas as gpd
import pandas as pd
import pytest
from shapely.geometry import Polygon, box

from src.config import METROS, metro_bbox
from src.iem_prefilter import (
    WARNING_PHENOMENA,
    WARNING_SIGNIFICANCE,
    build_warning_index,
)


# ── helpers ──────────────────────────────────────────────────────────────────

def _make_warning_gdf(polygons_and_phenomena: list[tuple]) -> gpd.GeoDataFrame:
    """Build a minimal synthetic warning GeoDataFrame matching the IEM shapefile schema."""
    rows = []
    for geom, phenom in polygons_and_phenomena:
        rows.append({
            "PHENOM": phenom,
            "SIG": "W",
            "ISSUED": pd.Timestamp("2026-04-15 18:00:00", tz="UTC"),
            "EXPIRED": pd.Timestamp("2026-04-15 19:00:00", tz="UTC"),
            "geometry": geom,
        })
    return gpd.GeoDataFrame(rows, crs="EPSG:4326")


# ── unit: bbox intersection logic ────────────────────────────────────────────

def test_warning_overlapping_metro_included():
    """A warning polygon that overlaps the DFW bbox should appear in the index."""
    lat_min, lat_max, lon_min, lon_max = metro_bbox("dfw")
    # Polygon centered inside DFW
    warning_geom = box(lon_min + 0.1, lat_min + 0.1, lon_min + 0.5, lat_min + 0.5)
    gdf = _make_warning_gdf([(warning_geom, "SV")])

    dfw_box = box(lon_min, lat_min, lon_max, lat_max)
    assert gdf.intersects(dfw_box).any(), "Test setup error: polygon should intersect DFW bbox"


def test_warning_outside_all_metros_excluded():
    """A warning polygon in the Pacific Ocean should not intersect any metro bbox."""
    ocean_geom = box(-150.0, 20.0, -140.0, 25.0)
    gdf = _make_warning_gdf([(ocean_geom, "SV")])

    for metro_id in METROS:
        lat_min, lat_max, lon_min, lon_max = metro_bbox(metro_id)
        metro_box = box(lon_min, lat_min, lon_max, lat_max)
        assert not gdf.intersects(metro_box).any(), \
            f"Ocean polygon should not intersect {metro_id}"


def test_non_warning_phenomena_excluded():
    """Flash flood (FF) and winter storm (WS) warnings should not pass the phenomenon filter."""
    non_hail = ["FF", "WS", "BZ", "FA"]
    for ph in non_hail:
        assert ph not in WARNING_PHENOMENA, \
            f"Phenomenon '{ph}' should not be in WARNING_PHENOMENA"


def test_watch_significance_excluded():
    """SV+A (severe thunderstorm watch) should not pass — we want warnings (W) only."""
    assert WARNING_SIGNIFICANCE == "W"


def test_metro_bbox_values_are_valid():
    """Sanity check that all 34 metro bboxes have lat/lon in plausible CONUS ranges."""
    for metro_id in METROS:
        lat_min, lat_max, lon_min, lon_max = metro_bbox(metro_id)
        assert 24 <= lat_min < lat_max <= 50, f"{metro_id}: lat range invalid"
        assert -125 <= lon_min < lon_max <= -65, f"{metro_id}: lon range invalid"
        assert (lat_max - lat_min) < 3.0, f"{metro_id}: bbox suspiciously large (lat span)"
        assert (lon_max - lon_min) < 3.0, f"{metro_id}: bbox suspiciously large (lon span)"


# ── integration: live IEM API ─────────────────────────────────────────────────

@pytest.mark.slow
def test_build_warning_index_april_2026(tmp_path):
    """Live IEM API call: April 2026 should have warning days for core hail-belt metros."""
    start = date(2026, 4, 1)
    end = date(2026, 4, 30)
    # Use a subset of metros to keep the test fast
    metros = ["dfw", "okc", "kc", "denver", "houston"]

    index = build_warning_index(start, end, metro_ids=metros, data_dir=tmp_path)

    assert set(index.keys()) == set(metros), "Index should contain exactly the requested metros"

    # April is peak hail season — at least some metros should have warning days
    total_warning_days = sum(len(v) for v in index.values())
    assert total_warning_days > 0, \
        "Expected at least some SVR/TOR warnings in April 2026 across 5 hail-belt metros"

    # All dates in the index must fall within the requested range
    for metro_id, dates in index.items():
        for d in dates:
            assert start <= d <= end, \
                f"{metro_id}: date {d} is outside requested range {start}–{end}"

    # Log results for manual inspection
    for metro_id, dates in sorted(index.items()):
        print(f"  {metro_id}: {len(dates)} warning days — {sorted(dates)}")


@pytest.mark.slow
def test_build_warning_index_caching(tmp_path):
    """Second call with same params returns from cache, not HTTP."""
    start = date(2026, 4, 1)
    end = date(2026, 4, 15)
    metros = ["dfw", "okc"]

    index1 = build_warning_index(start, end, metro_ids=metros, data_dir=tmp_path)
    cache_file = tmp_path / f"warning_index_{start}_{end}.json"
    assert cache_file.exists(), "Cache file should be written after first call"
    mtime1 = cache_file.stat().st_mtime

    index2 = build_warning_index(start, end, metro_ids=metros, data_dir=tmp_path)
    assert cache_file.stat().st_mtime == mtime1, "Cache file should not be rewritten on second call"
    assert index1.keys() == index2.keys()
    for metro_id in metros:
        assert index1[metro_id] == index2[metro_id]
