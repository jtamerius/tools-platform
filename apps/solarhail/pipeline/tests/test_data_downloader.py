"""Integration tests for data_downloader.py.

These tests make real HTTP requests — no mocking. The goal is to verify the actual
URLs resolve, files are valid, and caching works correctly.

Marks:
  slow — tests that download large files (TIGER BG ~97 MB). Skip with:
    pytest -m "not slow" -v

Run all:
    cd apps/solarhail/pipeline
    pytest tests/test_data_downloader.py -v
"""

import pytest
import pandas as pd
import geopandas as gpd

from src.data_downloader import fetch_all, fetch_deepsolar, fetch_tiger_blockgroups
from src.config import DEEPSOLAR_BG_FIPS_COL, DEEPSOLAR_COUNT_COL


# ── DeepSolar ────────────────────────────────────────────────────────────────

def test_fetch_deepsolar(tmp_path):
    """CSV downloads, exists on disk, and has the expected schema."""
    path = fetch_deepsolar(tmp_path)

    assert path.exists(), f"Expected file at {path}"
    assert path.suffix == ".csv"
    assert path.stat().st_size > 500_000, "File suspiciously small — download may be truncated"

    df = pd.read_csv(path, dtype={DEEPSOLAR_BG_FIPS_COL: str})

    assert DEEPSOLAR_BG_FIPS_COL in df.columns, \
        f"Missing column '{DEEPSOLAR_BG_FIPS_COL}'; found: {list(df.columns)}"
    assert DEEPSOLAR_COUNT_COL in df.columns, \
        f"Missing column '{DEEPSOLAR_COUNT_COL}'; found: {list(df.columns)}"

    assert len(df) > 100_000, f"Expected >100k rows, got {len(df)}"

    sample_fips = df[DEEPSOLAR_BG_FIPS_COL].dropna().iloc[0]
    assert len(str(sample_fips)) == 12, \
        f"Expected 12-digit block group FIPS, got '{sample_fips}' ({len(str(sample_fips))} chars)"

    assert df[DEEPSOLAR_COUNT_COL].dtype in ("int64", "float64"), \
        f"Expected numeric solar count column, got {df[DEEPSOLAR_COUNT_COL].dtype}"


def test_fetch_deepsolar_caching(tmp_path):
    """Second call returns the same path without re-downloading."""
    path1 = fetch_deepsolar(tmp_path)
    mtime1 = path1.stat().st_mtime

    path2 = fetch_deepsolar(tmp_path)
    mtime2 = path2.stat().st_mtime

    assert path1 == path2
    assert mtime1 == mtime2, "File was re-downloaded on second call — caching is broken"


# ── Census TIGER block groups ─────────────────────────────────────────────────

@pytest.mark.slow
def test_fetch_tiger_blockgroups(tmp_path):
    """Shapefile downloads (~97 MB), extracts correctly, and has the expected schema."""
    shp_path = fetch_tiger_blockgroups(tmp_path)

    assert shp_path.exists(), f"Expected .shp at {shp_path}"
    assert shp_path.suffix == ".shp"

    # Zip should be cleaned up after extraction
    zip_path = tmp_path / "cb_2023_us_bg_500k.zip"
    assert not zip_path.exists(), "Zip file was not deleted after extraction"

    gdf = gpd.read_file(str(shp_path))

    assert "GEOID" in gdf.columns, \
        f"Missing 'GEOID' column; found: {list(gdf.columns)}"

    assert len(gdf) > 200_000, f"Expected >200k block groups nationally, got {len(gdf)}"

    sample_geoid = gdf["GEOID"].iloc[0]
    assert len(str(sample_geoid)) == 12, \
        f"Expected 12-digit block group GEOID, got '{sample_geoid}'"

    # Should be re-projectable to WGS84 without error
    gdf_wgs84 = gdf.to_crs("EPSG:4326")
    assert gdf_wgs84.crs.to_epsg() == 4326


@pytest.mark.slow
def test_fetch_tiger_blockgroups_caching(tmp_path):
    """Second call returns the same path without re-downloading."""
    path1 = fetch_tiger_blockgroups(tmp_path)
    mtime1 = path1.stat().st_mtime

    path2 = fetch_tiger_blockgroups(tmp_path)
    mtime2 = path2.stat().st_mtime

    assert path1 == path2
    assert mtime1 == mtime2, "Shapefile was re-downloaded on second call — caching is broken"


# ── fetch_all ────────────────────────────────────────────────────────────────

@pytest.mark.slow
def test_fetch_all(tmp_path):
    """fetch_all returns a (csv_path, shp_path) tuple with both files present."""
    csv_path, shp_path = fetch_all(tmp_path)

    assert csv_path.exists() and csv_path.suffix == ".csv"
    assert shp_path.exists() and shp_path.suffix == ".shp"
