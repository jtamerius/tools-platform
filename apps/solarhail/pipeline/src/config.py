"""Metro bounding boxes, thresholds, and pipeline constants."""

import os
from datetime import date

H3_RESOLUTION = 8

MESH_THRESHOLDS_MM = {
    "low": 20.0,
    "medium": 25.0,
    "high": 40.0,
}

# Backfill window: 3 months ending yesterday
BACKFILL_START = date(2026, 2, 2)
BACKFILL_END = date(2026, 5, 1)

# lat_min, lat_max, lon_min, lon_max — bounding boxes for all metros
METROS = {
    # ── Core Hail Alley ──────────────────────────────────────────────────────
    "dfw":              ("Dallas–Fort Worth, TX",      32.40, 33.60, -97.90, -96.30),
    "houston":          ("Houston, TX",                29.30, 30.30, -95.90, -94.80),
    "san_antonio":      ("San Antonio, TX",            29.10, 29.85, -98.80, -98.00),
    "austin":           ("Austin, TX",                 29.90, 30.65, -97.95, -97.30),
    "lubbock":          ("Lubbock, TX",                33.40, 33.80, -102.10, -101.60),
    "amarillo":         ("Amarillo, TX",               34.90, 35.40, -102.20, -101.50),
    "okc":              ("Oklahoma City, OK",          35.20, 35.80, -97.80, -97.00),
    "tulsa":            ("Tulsa, OK",                  35.90, 36.40, -96.20, -95.60),
    "wichita":          ("Wichita, KS",                37.50, 38.00, -97.60, -97.10),
    "kc":               ("Kansas City, MO/KS",         38.70, 39.40, -94.90, -94.20),
    "omaha":            ("Omaha, NE/IA",               41.10, 41.55, -96.30, -95.70),
    "lincoln":          ("Lincoln, NE",                40.70, 40.95, -96.90, -96.50),
    "denver":           ("Denver, CO",                 39.40, 40.10, -105.30, -104.50),
    "colorado_springs": ("Colorado Springs, CO",       38.60, 39.00, -104.90, -104.50),
    "sioux_falls":      ("Sioux Falls, SD",            43.40, 43.65, -97.00, -96.60),
    "fargo":            ("Fargo, ND/MN",               46.70, 47.00, -97.10, -96.60),
    "minneapolis":      ("Minneapolis–St. Paul, MN",   44.70, 45.10, -93.60, -92.80),
    # ── Midwest ──────────────────────────────────────────────────────────────
    "st_louis":         ("St. Louis, MO/IL",           38.40, 38.85, -90.55, -90.00),
    "des_moines":       ("Des Moines, IA",             41.40, 41.80, -93.80, -93.40),
    "chicago":          ("Chicago, IL",                41.60, 42.10, -88.20, -87.40),
    "indianapolis":     ("Indianapolis, IN",           39.60, 40.05, -86.40, -85.90),
    "columbus":         ("Columbus, OH",               39.80, 40.20, -83.30, -82.70),
    "cincinnati":       ("Cincinnati, OH/KY",          38.95, 39.30, -84.80, -84.20),
    "cleveland":        ("Cleveland, OH",              41.30, 41.70, -81.90, -81.50),
    "dayton":           ("Dayton, OH",                 39.60, 39.90, -84.30, -83.90),
    "louisville":       ("Louisville, KY/IN",          37.95, 38.40, -85.95, -85.40),
    "nashville":        ("Nashville, TN",              35.90, 36.40, -87.10, -86.50),
    "memphis":          ("Memphis, TN/AR/MS",          34.95, 35.35, -90.30, -89.70),
    "little_rock":      ("Little Rock, AR",            34.50, 34.90, -92.60, -92.10),
    "shreveport":       ("Shreveport, LA/TX",          32.30, 32.65, -94.10, -93.60),
    "new_orleans":      ("New Orleans, LA",            29.80, 30.20, -90.40, -89.60),
    "baton_rouge":      ("Baton Rouge, LA",            30.30, 30.65, -91.30, -90.90),
    "jackson_ms":       ("Jackson, MS",                32.10, 32.50, -90.35, -89.90),
    "birmingham":       ("Birmingham, AL",             33.30, 33.70, -87.00, -86.50),
}

def metro_bbox(metro_id: str) -> tuple[float, float, float, float]:
    """Return (lat_min, lat_max, lon_min, lon_max) for a metro."""
    _, lat_min, lat_max, lon_min, lon_max = METROS[metro_id]
    return lat_min, lat_max, lon_min, lon_max

def metro_name(metro_id: str) -> str:
    return METROS[metro_id][0]


MRMS_BUCKET = "noaa-mrms-pds"
MRMS_PRODUCT = "CONUS/MESH_Max_30min_00.50"

# DeepSolar-3M block-group dataset (rajanieprabha/DeepSolar-3M on GitHub)
# https://github.com/rajanieprabha/DeepSolar-3M/blob/main/dataset/blockgroup_level_data.csv
DEEPSOLAR_URL = "https://raw.githubusercontent.com/rajanieprabha/DeepSolar-3M/main/dataset/blockgroup_level_data.csv"
DEEPSOLAR_BG_FIPS_COL = "block_group_FIPS"
DEEPSOLAR_COUNT_COL = "Total PV system count"

# Census TIGER 2023 national block group shapefile (cartographic boundary, 500k scale, ~97 MB)
# https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_bg_500k.zip
# GEOID column: 12-digit block group FIPS (state 2 + county 3 + tract 6 + BG 1)
TIGER_BG_NATIONAL_URL = "https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_bg_500k.zip"

# Overture release — pin to a specific release before building
OVERTURE_RELEASE = "2026-04-15.0"
OVERTURE_BUCKET = "overturemaps-us-west-2"

# Building class filter (NULL class = unclassified buildings, ~94% of Overture data)
OVERTURE_CLASSES = ("residential", "commercial")

# Overrideable via env vars — defaults match the staging CDK stack.
# In production set SOLARHAIL_ENV=production (or set each var explicitly).
_ENV = os.environ.get("SOLARHAIL_ENV", "staging")
_ACCOUNT = "606196119553"

S3_BUCKET = os.environ.get("SOLARHAIL_S3_BUCKET", f"tools-solarhail-{_ENV}-{_ACCOUNT}")
# Hive partition layout: parquet/hail-events/event_date=YYYY-MM-DD/{metro_id}.parquet
S3_PARQUET_PREFIX = "parquet/hail-events"
ATHENA_DATABASE = os.environ.get("SOLARHAIL_ATHENA_DB", f"solarhail_{_ENV}")
ATHENA_WORKGROUP = os.environ.get("SOLARHAIL_ATHENA_WG", f"solarhail-wg-{_ENV}")
