"""Solar position via pvlib — no API call needed."""
from __future__ import annotations
from datetime import datetime

import pandas as pd
import pvlib


def solar_position(lat: float, lon: float, ts: datetime) -> dict:
    pos = pvlib.solarposition.get_solarposition(
        pd.DatetimeIndex([ts]), latitude=lat, longitude=lon,
    ).iloc[0]
    return {
        "solar_altitude_deg": round(float(pos["elevation"]), 2),
        "solar_azimuth_deg": round(float(pos["azimuth"]), 2),
    }
