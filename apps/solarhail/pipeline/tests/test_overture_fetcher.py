"""Tests for overture_fetcher.py (Module 3).

Unit tests mock DuckDB entirely — no S3 access, no DuckDB install required.
The slow integration test hits real Overture S3 data.

Run fast only:
    pytest tests/test_overture_fetcher.py -m "not slow" -v

Run all:
    pytest tests/test_overture_fetcher.py -v -s
"""

from unittest.mock import MagicMock, patch

import pandas as pd
import pytest

from src.config import H3_RESOLUTION, METROS
from src.overture_fetcher import fetch_buildings


# ── helpers ───────────────────────────────────────────────────────────────────

def _mock_con(raw_df: pd.DataFrame):
    """Return a mock duckdb connection whose execute().df() returns raw_df."""
    con = MagicMock()
    execute_result = MagicMock()
    execute_result.df.return_value = raw_df
    con.execute.return_value = execute_result
    return con


def _buildings_df(lats, lons):
    return pd.DataFrame({"centroid_lat": lats, "centroid_lon": lons})


# ── fetch_buildings unit tests ────────────────────────────────────────────────

def test_fetch_buildings_unknown_metro():
    with pytest.raises(ValueError, match="Unknown metro_id"):
        fetch_buildings("atlantis")


def test_fetch_buildings_empty_returns_schema():
    """Empty DuckDB result → empty DataFrame with correct columns."""
    empty_df = _buildings_df([], [])

    with patch("src.overture_fetcher.duckdb.connect", return_value=_mock_con(empty_df)):
        result = fetch_buildings("okc")

    assert isinstance(result, pd.DataFrame)
    assert list(result.columns) == ["h3_index", "building_count"]
    assert len(result) == 0


def test_fetch_buildings_single_cell():
    """Buildings at the same location → one H3 cell with correct count."""
    # OKC center — three buildings at the same (approximate) lat/lon
    okc_lat, okc_lon = 35.47, -97.52
    raw_df = _buildings_df([okc_lat, okc_lat + 0.0001, okc_lat - 0.0001],
                           [okc_lon, okc_lon + 0.0001, okc_lon - 0.0001])

    with patch("src.overture_fetcher.duckdb.connect", return_value=_mock_con(raw_df)):
        result = fetch_buildings("okc")

    # All three should land in the same res-8 cell
    assert len(result) == 1
    assert result.iloc[0]["building_count"] == 3
    assert isinstance(result.iloc[0]["h3_index"], str)
    assert len(result.iloc[0]["h3_index"]) == 15


def test_fetch_buildings_multiple_cells():
    """Buildings spread across distinct cells → one row per cell."""
    import h3

    # Place buildings at centers of two neighboring cells
    cell_a = h3.latlng_to_cell(35.47, -97.52, H3_RESOLUTION)
    neighbors = [c for c in h3.grid_disk(cell_a, 1) if c != cell_a]
    cell_b = neighbors[0]

    lat_a, lon_a = h3.cell_to_latlng(cell_a)
    lat_b, lon_b = h3.cell_to_latlng(cell_b)

    raw_df = _buildings_df([lat_a, lat_a, lat_b], [lon_a, lon_a, lon_b])

    with patch("src.overture_fetcher.duckdb.connect", return_value=_mock_con(raw_df)):
        result = fetch_buildings("okc")

    assert len(result) == 2
    assert set(result["h3_index"]) == {cell_a, cell_b}
    counts = result.set_index("h3_index")["building_count"]
    assert counts[cell_a] == 2
    assert counts[cell_b] == 1


def test_fetch_buildings_h3_resolution_8():
    """All output h3_index values must be resolution 8."""
    import h3

    lats = [35.47 + i * 0.5 for i in range(5)]
    lons = [-97.52 + i * 0.5 for i in range(5)]
    raw_df = _buildings_df(lats, lons)

    with patch("src.overture_fetcher.duckdb.connect", return_value=_mock_con(raw_df)):
        result = fetch_buildings("okc")

    for cell in result["h3_index"]:
        assert h3.get_resolution(cell) == H3_RESOLUTION == 8


def test_fetch_buildings_valid_for_all_metros():
    """fetch_buildings accepts every configured metro_id without raising."""
    empty_df = _buildings_df([], [])
    con = _mock_con(empty_df)

    with patch("src.overture_fetcher.duckdb.connect", return_value=con):
        for metro_id in METROS:
            result = fetch_buildings(metro_id)
            assert isinstance(result, pd.DataFrame)


def test_fetch_buildings_building_count_dtype():
    """building_count column must be integer-compatible."""
    okc_lat, okc_lon = 35.47, -97.52
    raw_df = _buildings_df([okc_lat, okc_lat + 0.001], [okc_lon, okc_lon + 0.001])

    with patch("src.overture_fetcher.duckdb.connect", return_value=_mock_con(raw_df)):
        result = fetch_buildings("okc")

    assert result["building_count"].dtype.kind in ("i", "u")


def test_fetch_buildings_connection_closed():
    """DuckDB connection is always closed, even on success."""
    empty_df = _buildings_df([], [])
    con = _mock_con(empty_df)

    with patch("src.overture_fetcher.duckdb.connect", return_value=con):
        fetch_buildings("okc")

    con.close.assert_called_once()


# ── integration: live Overture S3 via DuckDB ─────────────────────────────────

@pytest.mark.slow
def test_fetch_buildings_okc_live():
    """Query real Overture S3 for OKC — verify non-trivial building count."""
    result = fetch_buildings("okc")

    assert isinstance(result, pd.DataFrame)
    assert list(result.columns) == ["h3_index", "building_count"]
    assert len(result) > 100, f"Expected >100 H3 cells for OKC, got {len(result)}"
    assert result["building_count"].sum() > 10_000, "Expected >10k buildings in OKC metro"

    import h3
    for cell in result["h3_index"]:
        assert h3.get_resolution(cell) == 8

    print(f"\n  OKC: {len(result)} H3 cells, {result['building_count'].sum():,} buildings")
