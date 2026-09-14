from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

REQUIRED_HOURLY_KEYS = {"time", "temperature_2m", "precipitation", "wind_speed_10m"}
HOURLY_VARIABLES = ["temperature_2m", "precipitation", "wind_speed_10m"]


def _check_times(hourly: dict[str, Any], model_id: str) -> tuple[bool, str]:
    """Shared time-array checks used by both validators."""
    times = hourly.get("time", [])
    if not times:
        return False, f"[{model_id}] Time array is empty"
    for i in range(1, len(times)):
        if times[i] <= times[i - 1]:
            return False, (
                f"[{model_id}] Timestamps not monotonically increasing at index {i}: "
                f"{times[i - 1]} >= {times[i]}"
            )
    return True, ""


def validate_response(data: dict[str, Any], model_id: str) -> tuple[bool, str]:
    """Validate a raw Open-Meteo deterministic-forecast response.

    Checks:
    - 'hourly' key present
    - all required variable keys present
    - time array non-empty and monotonically increasing
    - at least one non-null value across all variables

    Returns:
        (True, "") on success, or (False, reason) on failure.
    """
    if "hourly" not in data:
        return False, f"[{model_id}] Missing 'hourly' key in response"

    hourly = data["hourly"]

    for key in REQUIRED_HOURLY_KEYS:
        if key not in hourly:
            return False, f"[{model_id}] Missing key '{key}' in hourly data"

    ok, msg = _check_times(hourly, model_id)
    if not ok:
        return False, msg

    has_non_null = any(
        v is not None
        for var in HOURLY_VARIABLES
        for v in hourly.get(var, [])
    )
    if not has_non_null:
        return False, f"[{model_id}] All variable values are null"

    return True, ""


def validate_ensemble_response(data: dict[str, Any], model_id: str) -> tuple[bool, str]:
    """Validate a raw Open-Meteo ensemble response.

    Checks:
    - 'hourly' key present
    - 'time' non-empty and monotonically increasing
    - at least one member key present for each variable
      (e.g. 'temperature_2m_member01' confirms the ensemble endpoint was hit)

    Returns:
        (True, "") on success, or (False, reason) on failure.
    """
    if "hourly" not in data:
        return False, f"[{model_id}] Missing 'hourly' key in ensemble response"

    hourly = data["hourly"]

    ok, msg = _check_times(hourly, model_id)
    if not ok:
        return False, msg

    for var in HOURLY_VARIABLES:
        has_member = any(k.startswith(f"{var}_member") for k in hourly)
        if not has_member:
            return False, (
                f"[{model_id}] No member keys found for '{var}' in ensemble response "
                f"(expected '{var}_member01', etc.)"
            )

    return True, ""
