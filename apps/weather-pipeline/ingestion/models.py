from __future__ import annotations

from typing import Optional, TypedDict


class ForecastMeta(TypedDict):
    lat: float
    lon: float
    fetched_at: str            # ISO8601, UTC
    models: list[str]          # deterministic model IDs that succeeded
    ensemble_models: list[str] # ensemble model IDs that succeeded (empty if skipped/failed)


class HourlyData(TypedDict):
    time: list[str]                                        # ISO8601, UTC, common window
    temperature_2m:         dict[str, list[Optional[float]]]  # {model_id: [°F | None]}
    precipitation:          dict[str, list[Optional[float]]]  # {model_id: [in | None]}
    wind_speed_10m:         dict[str, list[Optional[float]]]  # {model_id: [mph | None]}
    snowfall:               dict[str, list[Optional[float]]]  # {model_id: [in | None]}
    snow_depth:             dict[str, list[Optional[float]]]  # {model_id: [in | None]}
    freezing_level_height:  dict[str, list[Optional[float]]]  # {model_id: [ft | None]}
    wind_gusts_10m:         dict[str, list[Optional[float]]]  # {model_id: [mph | None]}
    cape:                   dict[str, list[Optional[float]]]  # {model_id: [J/kg | None]}
    weather_code:           dict[str, list[Optional[float]]]  # {model_id: [WMO int | None]}
    surface_pressure:       dict[str, list[Optional[float]]]  # {model_id: [hPa | None]}


class EnsembleData(TypedDict):
    time: list[str]                                                   # ISO8601, UTC, common window
    temperature_2m:         dict[str, list[list[Optional[float]]]]    # {model_id: [member × timestep]}
    precipitation:          dict[str, list[list[Optional[float]]]]
    wind_speed_10m:         dict[str, list[list[Optional[float]]]]
    snowfall:               dict[str, list[list[Optional[float]]]]
    snow_depth:             dict[str, list[list[Optional[float]]]]
    freezing_level_height:  dict[str, list[list[Optional[float]]]]
    wind_gusts_10m:         dict[str, list[list[Optional[float]]]]
    cape:                   dict[str, list[list[Optional[float]]]]
    weather_code:           dict[str, list[list[Optional[float]]]]
    surface_pressure:       dict[str, list[list[Optional[float]]]]
    # member order per model: index 0 = ensemble mean, index 1…N = perturbed members


class ForecastResult(TypedDict):
    meta:    ForecastMeta
    hourly:  HourlyData
    members: Optional[EnsembleData]  # None when skipped (include_members=False) or all fail


class ErrorResult(TypedDict):
    error: bool
    message: str
    code: str
