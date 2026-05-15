"""Purgatory resort scrape Lambda — Phase 1.1.

Pulls current conditions + 5-day forecast from purgatoryresort.com.

NOTE: The exact selectors below are placeholders. Before the first deploy,
inspect the live page (Phase 1.1 step 1 in the spec) and update the
extractors below. Static-HTML parsing is attempted first; if the page is
client-rendered, replace this Lambda with a Playwright-on-Lambda variant.
"""
from __future__ import annotations
import logging
import os
import re
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

import boto3
import requests
from bs4 import BeautifulSoup

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
logger = logging.getLogger(__name__)

RESORT_TABLE = os.environ["RESORT_TABLE"]
CONDITIONS_URL = os.environ.get("CONDITIONS_URL", "https://www.purgatoryresort.com/the-mountain/conditions")
FORECAST_URL = os.environ.get("FORECAST_URL", "https://www.purgatoryresort.com/the-mountain/conditions")

HEADERS = {"User-Agent": "Mozilla/5.0 PurgatoryCrowdingBot/0.1 (jtamerius@gmail.com)"}

_ddb = boto3.resource("dynamodb")


def _now_iso() -> str:
    return datetime.now(tz=timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _round_quarter() -> str:
    dt = datetime.now(tz=timezone.utc).replace(second=0, microsecond=0)
    dt = dt.replace(minute=(dt.minute // 15) * 15)
    return dt.isoformat().replace("+00:00", "Z")


def _parse_int(s: Optional[str]) -> Optional[int]:
    if s is None: return None
    m = re.search(r"-?\d+", s)
    return int(m.group()) if m else None


def _parse_float(s: Optional[str]) -> Optional[float]:
    if s is None: return None
    m = re.search(r"-?\d+(?:\.\d+)?", s)
    return float(m.group()) if m else None


def fetch_conditions() -> dict:
    """Pull current conditions from the resort page.

    Field selectors are placeholders — update after live-page inspection.
    Return value uses schema field names so it can be merged directly.
    """
    out: dict = {"source": "purgatory_scrape"}
    try:
        r = requests.get(CONDITIONS_URL, headers=HEADERS, timeout=20)
        r.raise_for_status()
    except Exception as e:
        logger.warning("conditions GET failed: %s", e)
        return out

    soup = BeautifulSoup(r.text, "html.parser")
    txt = soup.get_text(" ", strip=True)

    # Current temp — typical pattern: "Current Temperature 28°F"
    m = re.search(r"(?:Current\s+Temp\w*|Temp\w*)[^0-9-]{0,40}(-?\d+)\s*°?\s*F", txt, flags=re.I)
    if m: out["resort_temp_f"] = int(m.group(1))

    # Conditions text (Sunny / Snowing / etc.) — usually adjacent to current temp
    m = re.search(r"(Sunny|Mostly\s+Sunny|Partly\s+Cloudy|Mostly\s+Cloudy|Cloudy|Snowing|Snow\s+Showers|Raining|Rain\s+Showers|Light\s+Snow|Heavy\s+Snow)",
                  txt, flags=re.I)
    if m: out["resort_conditions"] = m.group(1).title()

    # High / Low / Wind — best-effort regex; refine after inspection
    m = re.search(r"High[^0-9-]{0,20}(-?\d+)", txt, flags=re.I)
    if m: out["resort_temp_high_f"] = int(m.group(1))
    m = re.search(r"Low[^0-9-]{0,20}(-?\d+)", txt, flags=re.I)
    if m: out["resort_temp_low_f"] = int(m.group(1))
    m = re.search(r"Wind[^0-9]{0,20}(\d+)\s*mph", txt, flags=re.I)
    if m: out["resort_wind_speed_mph"] = int(m.group(1))

    return out


def fetch_forecast() -> dict:
    """Pull 5-day forecast (today + 4 days).

    Placeholder selectors — refine after live-page inspection.
    """
    out: dict = {}
    try:
        r = requests.get(FORECAST_URL, headers=HEADERS, timeout=20)
        r.raise_for_status()
    except Exception as e:
        logger.warning("forecast GET failed: %s", e)
        return out

    soup = BeautifulSoup(r.text, "html.parser")

    # Best-effort: find day-cards. Expected structure: a repeating element with
    # day label, condition icon/text, high, low, daytime snow, nighttime snow.
    day_cards = soup.select(".forecast-day, .day-forecast, [data-day-index]")[:5]
    for idx, card in enumerate(day_cards):
        text = card.get_text(" ", strip=True)
        cond_match = re.search(r"(Sunny|Cloudy|Snowing|Raining|Partly\s+Cloudy|Mostly\s+Cloudy|Snow|Rain)",
                               text, flags=re.I)
        if cond_match:
            out[f"forecast_day_{idx}_conditions"] = cond_match.group(1).title()
        hi = _parse_int(re.search(r"High[^0-9-]{0,10}(-?\d+)", text, flags=re.I).group() if re.search(r"High", text, flags=re.I) else None)
        if hi is not None: out[f"forecast_day_{idx}_high_f"] = hi
        lo_m = re.search(r"Low[^0-9-]{0,10}(-?\d+)", text, flags=re.I)
        if lo_m: out[f"forecast_day_{idx}_low_f"] = int(lo_m.group(1))
        day_snow = re.search(r"Day[^0-9]{0,20}(\d+(?:\.\d+)?)\s*(?:in|\")", text, flags=re.I)
        if day_snow: out[f"forecast_day_{idx}_snow_day_in"] = float(day_snow.group(1))
        night_snow = re.search(r"Night[^0-9]{0,20}(\d+(?:\.\d+)?)\s*(?:in|\")", text, flags=re.I)
        if night_snow: out[f"forecast_day_{idx}_snow_night_in"] = float(night_snow.group(1))

    return out


def _floats_to_decimal(obj):
    if isinstance(obj, float):
        return Decimal(str(obj))
    if isinstance(obj, dict):
        return {k: _floats_to_decimal(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_floats_to_decimal(v) for v in obj]
    return obj


def handler(event, context):
    sk = _round_quarter()
    record: dict = {
        "pk": "RESORT#PURGATORY",
        "sk": sk,
        "fetched_at": _now_iso(),
        "snow_stake_depth_in": None,
        "snow_stake_source": None,
        "webcam_base_people_count": None,
        "webcam_liftline_people_count": None,
        "lifts_open": None,
        "lifts_total": None,
    }
    record.update(fetch_conditions())
    record.update(fetch_forecast())

    table = _ddb.Table(RESORT_TABLE)
    table.put_item(Item=_floats_to_decimal(record))
    return {"ok": True, "sk": sk, "fields": len(record)}
