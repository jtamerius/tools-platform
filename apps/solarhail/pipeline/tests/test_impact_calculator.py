"""Tests for impact_calculator.py (Module 5).

Pure unit tests — no I/O, no external dependencies.

Run:
    pytest tests/test_impact_calculator.py -v
"""

from datetime import datetime, timezone

import pandas as pd
import pytest

from src.impact_calculator import FINAL_SCHEMA, calculate_impact

TS = datetime(2026, 4, 15, 20, 0, tzinfo=timezone.utc)


def _hail_df(h3_index, mesh_mm, metro_id="okc"):
    return pd.DataFrame({
        "h3_index": [h3_index],
        "max_mesh_mm": [mesh_mm],
        "timestamp": [TS],
        "metro_id": [metro_id],
    })


def _solar_df(h3_index, solar_systems):
    return pd.DataFrame({
        "h3_index": [h3_index],
        "estimated_solar_systems": [solar_systems],
    })


def test_output_columns():
    """Output has exactly the columns in FINAL_SCHEMA."""
    result = calculate_impact(_hail_df("cell_a", 35.0), _solar_df("cell_a", 100.0))
    assert list(result.columns) == FINAL_SCHEMA


def test_solar_systems_exposed_value():
    """solar_systems_exposed equals the estimated_solar_systems from the solar input."""
    result = calculate_impact(_hail_df("cell_a", 35.0), _solar_df("cell_a", 87.0))
    assert len(result) == 1
    assert result.iloc[0]["solar_systems_exposed"] == 87.0


def test_mesh_preserved():
    """max_mesh_mm passes through unchanged."""
    result = calculate_impact(_hail_df("cell_a", 42.5), _solar_df("cell_a", 10.0))
    assert result.iloc[0]["max_mesh_mm"] == 42.5


def test_unmatched_hail_dropped():
    """Hail cell with no matching solar data is excluded from output."""
    hail = pd.DataFrame({
        "h3_index": ["cell_a", "cell_b"],
        "max_mesh_mm": [30.0, 45.0],
        "timestamp": [TS, TS],
        "metro_id": ["okc", "okc"],
    })
    result = calculate_impact(hail, _solar_df("cell_a", 100.0))

    assert len(result) == 1
    assert result.iloc[0]["h3_index"] == "cell_a"


def test_multiple_cells():
    """Multiple matched cells all appear in output with correct values."""
    hail = pd.DataFrame({
        "h3_index": ["cell_a", "cell_b", "cell_c"],
        "max_mesh_mm": [20.0, 35.0, 65.0],
        "timestamp": [TS, TS, TS],
        "metro_id": ["okc", "okc", "okc"],
    })
    solar = pd.DataFrame({
        "h3_index": ["cell_a", "cell_b", "cell_c"],
        "estimated_solar_systems": [10.0, 20.0, 30.0],
    })

    result = calculate_impact(hail, solar)

    assert len(result) == 3
    by_cell = result.set_index("h3_index")["solar_systems_exposed"]
    assert by_cell["cell_a"] == 10.0
    assert by_cell["cell_b"] == 20.0
    assert by_cell["cell_c"] == 30.0


def test_empty_hail_returns_empty():
    """Empty hail input → empty output with final schema columns."""
    hail = pd.DataFrame(columns=["h3_index", "max_mesh_mm", "timestamp", "metro_id"])
    result = calculate_impact(hail, _solar_df("cell_a", 50.0))

    assert isinstance(result, pd.DataFrame)
    assert len(result) == 0
    assert list(result.columns) == FINAL_SCHEMA


def test_zero_solar_included():
    """Cell with 0 solar systems still appears in output — it's valid exposure data."""
    result = calculate_impact(_hail_df("cell_a", 50.0), _solar_df("cell_a", 0.0))
    assert len(result) == 1
    assert result.iloc[0]["solar_systems_exposed"] == 0.0


def test_metadata_preserved():
    """timestamp and metro_id pass through unchanged."""
    result = calculate_impact(_hail_df("cell_a", 30.0, metro_id="dfw"), _solar_df("cell_a", 10.0))
    assert result.iloc[0]["timestamp"] == TS
    assert result.iloc[0]["metro_id"] == "dfw"
