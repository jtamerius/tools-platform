from __future__ import annotations

import json
import logging
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Optional, Union

from .models import EnsembleData, ErrorResult, ForecastResult, HourlyData
from .validator import validate_ensemble_response, validate_response

logger = logging.getLogger(__name__)

OPEN_METEO_URL          = "https://api.open-meteo.com/v1/forecast"
OPEN_METEO_ENSEMBLE_URL = "https://ensemble-api.open-meteo.com/v1/ensemble"

# Some models require a dedicated endpoint instead of the generic /v1/forecast.
_DET_URL_OVERRIDES: dict[str, str] = {
    "gfs_hrrr": "https://api.open-meteo.com/v1/gfs",
}

DEFAULT_MODELS = ["gfs_seamless", "ecmwf_ifs025", "icon_seamless", "gem_global"]

HOURLY_VARIABLES = [
    "temperature_2m",
    "precipitation",
    "wind_speed_10m",
    "snowfall",
    "freezing_level_height",
    "wind_gusts_10m",
    "cape",
    "surface_pressure",
]

# Variables requiring manual metric→imperial conversion (API flags don't cover these).
# snowfall: cm → in (÷ 2.54)
# freezing_level_height: m → ft (× 3.28084)
_UNIT_CONVERSIONS: dict[str, float] = {
    "snowfall":              1.0 / 2.54,    # cm → in
    "freezing_level_height": 3.28084,       # m  → ft
}

# Delays between retries (seconds)
_RETRY_DELAYS      = [2, 5, 15]  # network / 5xx errors — 3 retries, 4 attempts
_RATE_LIMIT_DELAYS = [62]        # HTTP 429/503 — 1 retry just past the 60s rate-limit window
# Worst-case budget: 4 models × (req~5s + 62s wait + req~5s) ≈ 288s < 300s Lambda timeout

_RATE_LIMIT_CODES = {429, 503}  # treat 503 (overloaded) same as 429


# ---------------------------------------------------------------------------
# Internal helpers — HTTP
# ---------------------------------------------------------------------------

def _http_get_with_retry(url: str, label: str) -> tuple[Optional[dict | list], Optional[str]]:
    """GET *url* with retry and backoff.

    Returns (data, None) on success, or (None, error_message) on failure.
    HTTP 429/503 use _RATE_LIMIT_DELAYS; other errors use _RETRY_DELAYS.
    """
    max_attempts = 1 + len(_RETRY_DELAYS)  # normal: 4 attempts; rate-limited: up to 1+len(_RATE_LIMIT_DELAYS)
    last_error: str = ""
    _rate_limited = False

    for attempt in range(1, max_attempts + 1):
        try:
            logger.debug("GET %s attempt=%d", label, attempt)
            with urllib.request.urlopen(url, timeout=45) as resp:
                return json.loads(resp.read()), None

        except urllib.error.HTTPError as exc:
            try:
                body = json.loads(exc.read())
                reason = body.get("reason", str(exc))
            except Exception:
                reason = str(exc)
            last_error = f"HTTP {exc.code}: {reason}"
            _rate_limited = exc.code in _RATE_LIMIT_CODES

        except Exception as exc:
            last_error = str(exc)
            _rate_limited = False

        logger.warning("[%s] Attempt %d failed: %s", label, attempt, last_error)
        rl_idx = attempt - 1
        if _rate_limited:
            if rl_idx >= len(_RATE_LIMIT_DELAYS):
                break  # exhausted rate-limit retries, give up now
            delay = _RATE_LIMIT_DELAYS[rl_idx]
            logger.info("[%s] Rate limited; waiting %ds before retry", label, delay)
            time.sleep(delay)
        elif attempt < max_attempts:
            delay = _RETRY_DELAYS[rl_idx]
            time.sleep(delay)

    return None, f"Failed for '{label}': {last_error}"


def _build_params(lat_csv: str, lon_csv: str, model: str) -> dict:
    return {
        "latitude":           lat_csv,
        "longitude":          lon_csv,
        "hourly":             ",".join(HOURLY_VARIABLES),
        "temperature_unit":   "fahrenheit",
        "precipitation_unit": "inch",
        "wind_speed_unit":    "mph",
        "forecast_days":      16,
        "timezone":           "UTC",
        "models":             model,
    }


def _fetch_with_retry(lat: float, lon: float, model: str) -> tuple[Optional[dict], Optional[str]]:
    """Fetch one deterministic model forecast for a single location."""
    params = _build_params(str(lat), str(lon), model)
    url = OPEN_METEO_URL + "?" + urllib.parse.urlencode(params)
    return _http_get_with_retry(url, model)  # type: ignore[return-value]


def _fetch_ensemble_model(lat: float, lon: float, model: str) -> tuple[Optional[dict], Optional[str]]:
    """Fetch one model's ensemble members for a single location."""
    params = _build_params(str(lat), str(lon), model)
    url = OPEN_METEO_ENSEMBLE_URL + "?" + urllib.parse.urlencode(params)
    return _http_get_with_retry(url, f"{model}[ensemble]")  # type: ignore[return-value]


def _fetch_bulk_raw(
    lats: list[float],
    lons: list[float],
    model: str,
    base_url: str,
    label_suffix: str,
) -> list[Optional[dict]]:
    """Fetch forecast data for multiple locations in a single API call.

    Returns a list of raw hourly dicts aligned to the input order.
    Entries are ``None`` for locations that fail validation or if the whole
    request fails.
    """
    lat_csv = ",".join(str(v) for v in lats)
    lon_csv = ",".join(str(v) for v in lons)
    params  = _build_params(lat_csv, lon_csv, model)
    url     = base_url + "?" + urllib.parse.urlencode(params)
    data, err = _http_get_with_retry(url, f"{model}[{label_suffix}]@{len(lats)}")

    if err or data is None:
        logger.warning("Bulk fetch failed for %s: %s", label_suffix, err)
        return [None] * len(lats)

    # Multi-location: list of dicts.  Single-location fallback: plain dict.
    items: list[Optional[dict]] = data if isinstance(data, list) else [data]

    # Pad or trim to match requested count (shouldn't happen, but be safe).
    if len(items) != len(lats):
        logger.warning(
            "Bulk response length mismatch: expected %d, got %d", len(lats), len(items)
        )
        items = list(items) + [None] * (len(lats) - len(items))

    return items


# ---------------------------------------------------------------------------
# Internal helpers — unit conversion
# ---------------------------------------------------------------------------

def _convert_units(hourly: dict) -> None:
    """In-place metric→imperial conversion for variables the API doesn't auto-convert."""
    for var, factor in _UNIT_CONVERSIONS.items():
        if var not in hourly:
            continue
        raw = hourly[var]
        if isinstance(raw, list):
            hourly[var] = [v * factor if v is not None else None for v in raw]


# ---------------------------------------------------------------------------
# Internal helpers — data alignment
# ---------------------------------------------------------------------------

def _find_common_times(model_times: dict[str, list[str]]) -> list[str]:
    """Union time arrays across all models and return sorted result.

    Using union (not intersection) allows short-range models (e.g. HRRR, HRDPS)
    to coexist with long-range models — missing timesteps are filled with None
    by _clip_to_times, and the visualisation clips each model at its last valid
    value via lastValidIdx.
    """
    if not model_times:
        return []
    combined: set[str] = set()
    for times in model_times.values():
        combined.update(times)
    return sorted(combined)


def _clip_to_times(
    raw: dict,
    common_times: list[str],
) -> dict[str, list[Optional[float]]]:
    """Clip a deterministic model's hourly variables to *common_times*.

    Missing indices are filled with None.  Unit conversions are applied first.
    """
    _convert_units(raw["hourly"])
    time_to_idx: dict[str, int] = {t: i for i, t in enumerate(raw["hourly"]["time"])}
    result: dict[str, list[Optional[float]]] = {}

    for var in HOURLY_VARIABLES:
        raw_values: list[Optional[float]] = raw["hourly"].get(var, [])
        clipped: list[Optional[float]] = []
        for t in common_times:
            idx = time_to_idx.get(t)
            if idx is not None and idx < len(raw_values):
                clipped.append(raw_values[idx])
            else:
                clipped.append(None)
        result[var] = clipped

    return result


def _parse_members(
    raw: dict,
    common_times: list[str],
) -> dict[str, list[list[Optional[float]]]]:
    """Extract all ensemble member series for each variable.

    Returns ``{var: [member0_values, member1_values, …]}`` where index 0 is
    the ensemble mean and indices 1… are perturbed members.  Unit conversions
    are applied first.
    """
    _convert_units(raw["hourly"])
    time_to_idx: dict[str, int] = {t: i for i, t in enumerate(raw["hourly"]["time"])}
    result: dict[str, list[list[Optional[float]]]] = {}

    for var in HOURLY_VARIABLES:
        mean_values: list[Optional[float]] = raw["hourly"].get(var, [])
        member_keys = sorted(k for k in raw["hourly"] if k.startswith(f"{var}_member"))
        all_series = [mean_values] + [raw["hourly"][k] for k in member_keys]

        clipped_series: list[list[Optional[float]]] = []
        for series in all_series:
            clipped: list[Optional[float]] = []
            for t in common_times:
                idx = time_to_idx.get(t)
                if idx is not None and idx < len(series):
                    clipped.append(series[idx])
                else:
                    clipped.append(None)
            clipped_series.append(clipped)

        result[var] = clipped_series

    return result


def _empty_hourly() -> dict:
    return {var: {} for var in HOURLY_VARIABLES}


def _empty_ensemble() -> dict:
    return {var: {} for var in HOURLY_VARIABLES}


def _assemble_result(
    lat: float,
    lon: float,
    raw_by_model: dict[str, dict],
    ens_raw: dict[str, dict],
    fetched_at: str,
) -> Union[ForecastResult, ErrorResult]:
    """Build a ForecastResult from pre-fetched raw dicts for one location."""
    if not raw_by_model:
        return {
            "error": True,
            "message": "All deterministic models failed",
            "code": "ALL_MODELS_FAILED",
        }

    det_model_times = {m: d["hourly"]["time"] for m, d in raw_by_model.items()}
    common_times = _find_common_times(det_model_times)

    if not common_times:
        return {
            "error": True,
            "message": "No time data from any deterministic model",
            "code": "NO_TIME_OVERLAP",
        }

    hourly: HourlyData = {"time": common_times, **{var: {} for var in HOURLY_VARIABLES}}  # type: ignore
    for model, raw in raw_by_model.items():
        clipped = _clip_to_times(raw, common_times)
        for var in HOURLY_VARIABLES:
            hourly[var][model] = clipped[var]  # type: ignore[literal-required]

    members = None
    ensemble_models: list[str] = []

    if ens_raw:
        ens_times_map = {m: d["hourly"]["time"] for m, d in ens_raw.items()}
        ens_common = _find_common_times(ens_times_map)
        if ens_common:
            members_data: EnsembleData = {"time": ens_common, **{var: {} for var in HOURLY_VARIABLES}}  # type: ignore
            for model, raw in ens_raw.items():
                parsed = _parse_members(raw, ens_common)
                for var in HOURLY_VARIABLES:
                    members_data[var][model] = parsed[var]  # type: ignore[literal-required]
            members = members_data
            ensemble_models = list(ens_raw.keys())

    return {
        "meta": {
            "lat": lat,
            "lon": lon,
            "fetched_at": fetched_at,
            "models": list(raw_by_model.keys()),
            "ensemble_models": ensemble_models,
        },
        "hourly": hourly,
        "members": members,
    }


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def fetch_forecast(
    lat: float,
    lon: float,
    models: Optional[list[str]] = None,
    include_members: bool = True,
) -> Union[ForecastResult, ErrorResult]:
    """Fetch an ensemble forecast for *(lat, lon)* from one or more NWP models.

    Args:
        lat:             Latitude in degrees (-90 … 90).
        lon:             Longitude in degrees (-180 … 180).
        models:          Model identifiers.  Defaults to ``DEFAULT_MODELS``.
        include_members: Set ``False`` to skip the ensemble fetch entirely.

    Returns:
        A ``ForecastResult`` dict on success, or an ``ErrorResult`` dict if every
        *deterministic* model failed (never raises).
    """
    if models is None:
        models = list(DEFAULT_MODELS)

    if not (-90.0 <= lat <= 90.0):
        return {"error": True, "message": f"Invalid latitude {lat!r}", "code": "INVALID_COORDS"}
    if not (-180.0 <= lon <= 180.0):
        return {"error": True, "message": f"Invalid longitude {lon!r}", "code": "INVALID_COORDS"}

    fetched_at = datetime.now(timezone.utc).isoformat()

    # Phase 1 — deterministic
    raw_by_model: dict[str, dict] = {}
    for model in models:
        data, err = _fetch_with_retry(lat, lon, model)
        if err:
            logger.warning("[%s] fetch error: %s", model, err)
            continue
        ok, reason = validate_response(data, model)
        if not ok:
            logger.warning("[%s] validation failed: %s", model, reason)
            continue
        raw_by_model[model] = data

    # Phase 2 — ensemble members
    ens_raw: dict[str, dict] = {}
    if include_members:
        for model in models:
            data, err = _fetch_ensemble_model(lat, lon, model)
            if err:
                logger.warning("[%s] ensemble fetch error: %s", model, err)
                continue
            ok, reason = validate_ensemble_response(data, model)
            if not ok:
                logger.warning("[%s] ensemble validation failed: %s", model, reason)
                continue
            ens_raw[model] = data

    return _assemble_result(lat, lon, raw_by_model, ens_raw, fetched_at)


def fetch_forecast_grid(
    locations: list[dict],
    models: Optional[list[str]] = None,
    batch_size: int = 100,
    include_members: bool = True,
) -> list[Union[ForecastResult, ErrorResult]]:
    """Fetch forecasts for a list of locations using batched multi-location API calls.

    Args:
        locations:       List of ``{"lat": float, "lon": float}`` dicts.
        models:          Model identifiers.  Defaults to ``DEFAULT_MODELS``.
        batch_size:      Locations per API request (keep ≤200 to stay within URL limits).
        include_members: Set ``False`` to skip ensemble fetches.

    Returns:
        List of ``ForecastResult | ErrorResult`` in the same order as *locations*.
    """
    if models is None:
        models = list(DEFAULT_MODELS)

    fetched_at = datetime.now(timezone.utc).isoformat()
    n = len(locations)
    results: list[Union[ForecastResult, ErrorResult]] = [
        {"error": True, "message": "Not fetched", "code": "ALL_MODELS_FAILED"}
    ] * n

    # Process in batches
    for batch_start in range(0, n, batch_size):
        batch = locations[batch_start : batch_start + batch_size]
        lats  = [loc["lat"] for loc in batch]
        lons  = [loc["lon"] for loc in batch]
        b_n   = len(batch)

        # --- deterministic phase ---
        raw_by_model_per_loc: list[dict[str, dict]] = [{} for _ in range(b_n)]
        for model in models:
            items = _fetch_bulk_raw(lats, lons, model, OPEN_METEO_URL, "det")
            for i, item in enumerate(items):
                if item is None:
                    continue
                ok, reason = validate_response(item, model)
                if not ok:
                    logger.warning("[%s] bulk det validation loc %d: %s", model, batch_start + i, reason)
                    continue
                raw_by_model_per_loc[i][model] = item

        # --- ensemble phase ---
        ens_raw_per_loc: list[dict[str, dict]] = [{} for _ in range(b_n)]
        if include_members:
            for model in models:
                items = _fetch_bulk_raw(lats, lons, model, OPEN_METEO_ENSEMBLE_URL, "ens")
                for i, item in enumerate(items):
                    if item is None:
                        continue
                    ok, reason = validate_ensemble_response(item, model)
                    if not ok:
                        logger.warning("[%s] bulk ens validation loc %d: %s", model, batch_start + i, reason)
                        continue
                    ens_raw_per_loc[i][model] = item

        # --- assemble results ---
        for i, loc in enumerate(batch):
            results[batch_start + i] = _assemble_result(
                loc["lat"], loc["lon"],
                raw_by_model_per_loc[i],
                ens_raw_per_loc[i],
                fetched_at,
            )

    return results


def fetch_model_grid(
    locations: list[dict],
    model: str,
    fetch_type: str,
) -> list[Optional[dict]]:
    """Fetch raw API data for one model and one fetch type across all locations.

    Used by the Lambda fetch handler — each Lambda invocation calls this once
    for a single (model, fetch_type) pair, with no inter-model delays needed.

    Args:
        locations:  List of ``{"lat": float, "lon": float}`` dicts.
        model:      Model identifier (e.g. ``"gfs_seamless"``).
        fetch_type: ``"det"`` for deterministic or ``"ens"`` for ensemble members.

    Returns:
        List of raw API response dicts aligned to *locations*.  Entry is ``None``
        if the request failed or validation did not pass.
    """
    lats = [loc["lat"] for loc in locations]
    lons = [loc["lon"] for loc in locations]

    if fetch_type == "det":
        base_url = _DET_URL_OVERRIDES.get(model, OPEN_METEO_URL)
        validate_fn = validate_response
    else:
        base_url = OPEN_METEO_ENSEMBLE_URL
        validate_fn = validate_ensemble_response

    raw_items = _fetch_bulk_raw(lats, lons, model, base_url, fetch_type)

    result: list[Optional[dict]] = []
    for i, item in enumerate(raw_items):
        if item is None:
            result.append(None)
            continue
        ok, reason = validate_fn(item, model)
        if not ok:
            logger.warning("[%s/%s] validation failed loc %d: %s", model, fetch_type, i, reason)
            result.append(None)
        else:
            result.append(item)
    return result
