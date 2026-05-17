"""COTRIP GraphQL client — fetches image capture timestamp + RWIS readings."""
from __future__ import annotations
import logging
import re
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

# weatherStationQuery is broken server-side; access RWIS via a nearby camera instead.
CAMERA_RWIS_QUERY = """
query {
    cameraQuery(cameraId: "%s") {
        camera {
            nearbyWeatherStation {
                weatherStationFields
            }
        }
    }
}
"""

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

CORRIDOR_BBOX = {"west": -108.0, "south": 37.2, "east": -107.5, "north": 37.65, "zoom": 11}


def _post(query: str, variables: dict = None) -> dict:
    payload = {"query": query}
    if variables:
        payload["variables"] = variables
    r = requests.post(
        config.COTRIP_GRAPHQL_URL,
        json=payload,
        headers=HEADERS,
        timeout=15,
    )
    if not r.ok:
        logger.warning("COTRIP %s %s — body: %s", r.status_code, r.url, r.text[:500])
    r.raise_for_status()
    return r.json()


def fetch_image_captured_at(cotrip_cam_id: str, filename: str, image_url: str = None) -> Optional[str]:
    """Return the image capture timestamp via Last-Modified header on the source image."""
    if not image_url:
        return None
    try:
        r = requests.head(image_url, headers={"User-Agent": HEADERS["User-Agent"]}, timeout=10)
        lm = r.headers.get("Last-Modified") or r.headers.get("last-modified")
        if lm:
            from email.utils import parsedate_to_datetime
            return parsedate_to_datetime(lm).astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    except Exception as e:
        logger.warning("fetch_image_captured_at HEAD failed: %s", e)
    return None


# Mapping: COTRIP field key → (schema field name, is_numeric)
RWIS_FIELD_MAP = {
    "TEMP_AIR_TEMPERATURE":       ("rwis_temp_air_f",          True),
    "TEMP_DEW_POINT":             ("rwis_temp_dewpoint_f",      True),
    "PAVEMENT_SURFACE_TEMPERATURE": ("rwis_pavement_temp_f",   True),
    "PAVEMENT_SURFACE_STATUS":    ("rwis_pavement_status",      False),
    "PRECIP_SITUATION":           ("rwis_precip_situation",     False),
    "PRECIP_RATE":                ("rwis_precip_rate_in_hr",    True),
    "PRECIP_PAST_HOUR":           ("rwis_precip_past_1hr_in",   True),
    "PRECIP_PAST_24_HOURS":       ("rwis_precip_past_24hr_in",  True),
    "VIS_VISIBILITY":             ("rwis_visibility_mi",        True),
    "WIND_AVG_SPEED":             ("rwis_wind_avg_mph",         True),
    "WIND_MAX_SPEED":             ("rwis_wind_max_mph",         True),
    "WIND_AVG_DIRECTION":         ("rwis_wind_avg_direction",   False),
    "WIND_MAX_DIRECTION":         ("rwis_wind_max_direction",   False),
}


def _parse_numeric(display_value: str) -> Optional[float]:
    m = re.search(r"([\d.]+)", display_value)
    if m:
        try:
            return float(m.group(1))
        except ValueError:
            pass
    return None


def fetch_rwis(cotrip_cam_id: str = None) -> dict:
    """Fetch RWIS readings via the nearby-weather-station field on a COTRIP camera.

    Uses cameraQuery rather than weatherStationQuery (which is broken server-side).
    """
    cam_id = cotrip_cam_id or config.RWIS_COTRIP_CAM_ID
    try:
        data = _post(CAMERA_RWIS_QUERY % cam_id)
    except Exception as e:
        logger.warning("RWIS cameraQuery failed (cam %s): %s", cam_id, e)
        return {}

    station = (
        (data.get("data") or {})
        .get("cameraQuery", {})
        .get("camera", {})
        .get("nearbyWeatherStation")
    )
    if not station:
        logger.warning("RWIS: no nearbyWeatherStation for cam %s", cam_id)
        return {}

    fields = station.get("weatherStationFields") or {}
    out: dict = {}
    for cotrip_key, (schema_name, is_numeric) in RWIS_FIELD_MAP.items():
        entry = fields.get(cotrip_key)
        if not entry:
            continue
        display = entry.get("displayValue", "")
        if not display or display in ("No Report", "N/A", ""):
            continue
        if is_numeric:
            val = _parse_numeric(display)
            if val is not None:
                out[schema_name] = val
        else:
            out[schema_name] = display
    return out
