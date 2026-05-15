"""COTRIP GraphQL client — fetches image capture timestamp + RWIS readings."""
from __future__ import annotations
import logging
from datetime import datetime, timezone
from typing import Optional

import requests

from . import config

logger = logging.getLogger(__name__)

HEADERS = {
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0",
    "Referer": "https://www.cotrip.org/",
    "Origin": "https://www.cotrip.org",
}

MAP_FEATURES_QUERY = """
query MapFeatures($input: MapFeaturesArgs!) {
    mapFeaturesQuery(input: $input) {
        mapFeatures {
            tooltip
            features { id geometry properties }
            ... on Camera {
                views(limit: 5) { ... on CameraView { sources { type src } } category url uri }
            }
        }
    }
}
"""

WEATHER_STATION_QUERY = """
query WeatherStation($rwisId: String!) {
    weatherStationQuery(rwisId: $rwisId) {
        weatherStationFields { key value unit }
    }
}
"""

CORRIDOR_BBOX = {"west": -108.0, "south": 37.2, "east": -107.5, "north": 37.65, "zoom": 11}


def _post(query: str, variables: dict) -> dict:
    r = requests.post(
        config.COTRIP_GRAPHQL_URL,
        json={"query": query, "variables": variables},
        headers=HEADERS,
        timeout=15,
    )
    r.raise_for_status()
    return r.json()


def fetch_image_captured_at(cotrip_cam_id: str, filename: str) -> Optional[str]:
    """Find the cache-buster timestamp on the image URL for this cam view.

    Returns ISO 8601 UTC string, or None if not discoverable.
    """
    try:
        data = _post(MAP_FEATURES_QUERY, {
            "input": {
                **CORRIDOR_BBOX,
                "nonClusterableUris": ["dashboard"],
                "layerSlugs": ["normalCameras"],
            },
        })
    except Exception as e:
        logger.warning("mapFeaturesQuery failed: %s", e)
        return None

    features = (data.get("data") or {}).get("mapFeaturesQuery", {}).get("mapFeatures", []) or []
    for f in features:
        for v in (f.get("views") or []):
            url = v.get("url") or v.get("uri") or ""
            if filename in url and "?" in url:
                ts_str = url.split("?", 1)[1].split("&", 1)[0]
                try:
                    ts_ms = int(ts_str)
                    return datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).isoformat().replace("+00:00", "Z")
                except ValueError:
                    pass
    return None


# RWIS field key → schema field name. Keys observed from cotrip station 374.
RWIS_FIELD_MAP = {
    "Air Temperature": "rwis_temp_air_f",
    "Dewpoint": "rwis_temp_dewpoint_f",
    "Pavement Status": "rwis_pavement_status",
    "Pavement Temperature": "rwis_pavement_temp_f",
    "Precipitation Situation": "rwis_precip_situation",
    "Precipitation Rate": "rwis_precip_rate_in_hr",
    "Precipitation Past 1 Hour": "rwis_precip_past_1hr_in",
    "Precipitation Past 24 Hours": "rwis_precip_past_24hr_in",
    "Visibility": "rwis_visibility_mi",
    "Average Wind Speed": "rwis_wind_avg_mph",
    "Max Wind Speed": "rwis_wind_max_mph",
    "Average Wind Direction": "rwis_wind_avg_direction",
    "Max Wind Direction": "rwis_wind_max_direction",
}

NUMERIC_FIELDS = {
    "rwis_temp_air_f", "rwis_temp_dewpoint_f", "rwis_pavement_temp_f",
    "rwis_precip_rate_in_hr", "rwis_precip_past_1hr_in", "rwis_precip_past_24hr_in",
    "rwis_visibility_mi", "rwis_wind_avg_mph", "rwis_wind_max_mph",
}


def fetch_rwis(station_id: str = None) -> dict:
    """Fetch RWIS readings; returns a dict matching the ingest schema field names."""
    sid = station_id or config.RWIS_STATION_ID
    try:
        data = _post(WEATHER_STATION_QUERY, {"rwisId": sid})
    except Exception as e:
        logger.warning("weatherStationQuery failed: %s", e)
        return {}

    fields = (data.get("data") or {}).get("weatherStationQuery", {}).get("weatherStationFields", []) or []
    out: dict = {}
    for f in fields:
        schema_name = RWIS_FIELD_MAP.get(f.get("key"))
        if not schema_name:
            continue
        val = f.get("value")
        if val in (None, ""):
            continue
        if schema_name in NUMERIC_FIELDS:
            try:
                out[schema_name] = float(val)
            except (TypeError, ValueError):
                pass
        else:
            out[schema_name] = str(val)
    return out
