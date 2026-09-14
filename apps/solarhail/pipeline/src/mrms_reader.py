"""Module 1: Read one MRMS MESH_Max_30min GRIB2 file, return hail pixels for a metro bbox."""

from __future__ import annotations

import gzip
import os
import io
import logging
import tempfile
from datetime import datetime, timezone
from typing import NamedTuple

import boto3
import numpy as np
import pygrib

from .config import METROS, MESH_THRESHOLDS_MM, MRMS_BUCKET, metro_bbox

logger = logging.getLogger(__name__)


class HailPixel(NamedTuple):
    lat: float
    lon: float
    mesh_mm: float
    timestamp: datetime


def _parse_timestamp(msg) -> datetime:
    """Extract valid time from GRIB message."""
    year = msg.year
    month = msg.month
    day = msg.day
    hour = msg.hour
    minute = msg.minute
    return datetime(year, month, day, hour, minute, tzinfo=timezone.utc)


def read_mrms_pixels(
    s3_key: str,
    metro_id: str | None,
    threshold_mm: float = MESH_THRESHOLDS_MM["medium"],
    s3_client=None,
) -> list[HailPixel]:
    """Stream one MRMS GRIB2 file from NOAA S3, return pixels above threshold.

    Files are never written to disk — streamed directly from S3 into memory.

    Args:
        s3_key: S3 key under noaa-mrms-pds, e.g. CONUS/MESH_Max_30min_00.50/20260415/MRMS_MESH_Max_30min_00.50_20260415-120000.grib2.gz
        metro_id: Key from config.METROS dict, or None for full CONUS (no bbox filter).
        threshold_mm: Minimum MESH value to include.
        s3_client: Optional pre-configured boto3 S3 client (unsigned for public bucket).

    Returns:
        List of HailPixel for cells above threshold (within metro bbox if metro_id given).
    """
    if metro_id is not None:
        if metro_id not in METROS:
            raise ValueError(f"Unknown metro_id: {metro_id}")
        lat_min, lat_max, lon_min, lon_max = metro_bbox(metro_id)

    if s3_client is None:
        from botocore import UNSIGNED
        from botocore.config import Config
        s3_client = boto3.client("s3", config=Config(signature_version=UNSIGNED), region_name="us-east-1")

    logger.info("Streaming %s from %s", s3_key, MRMS_BUCKET)
    response = s3_client.get_object(Bucket=MRMS_BUCKET, Key=s3_key)
    raw_bytes = response["Body"].read()

    # MRMS files are gzip-compressed; pygrib.open() requires a file path, not BytesIO
    grib_bytes = gzip.decompress(raw_bytes)
    with tempfile.NamedTemporaryFile(suffix=".grib2", delete=False) as tmp:
        tmp.write(grib_bytes)
        tmp_path = tmp.name

    grbs = pygrib.open(tmp_path)
    msg = grbs.read(1)[0]
    grbs.close()

    import os
    os.unlink(tmp_path)

    lats, lons = msg.latlons()

    # MRMS grid uses 0–360 longitudes; convert to -180–180 to match metro bboxes
    lons = np.where(lons > 180, lons - 360, lons)

    # msg.values returns memoryview in some pygrib versions — force numpy array
    values = np.array(msg.values)

    timestamp = _parse_timestamp(msg)

    # Spatial mask — full CONUS when metro_id is None
    if metro_id is not None:
        spatial_mask = (lats >= lat_min) & (lats <= lat_max) & (lons >= lon_min) & (lons <= lon_max)
    else:
        spatial_mask = np.ones(lats.shape, dtype=bool)

    # Threshold mask (handle masked arrays)
    if isinstance(values, np.ma.MaskedArray):
        valid_mask = ~values.mask & spatial_mask & (values.data >= threshold_mm)
        flat_vals = values.data[valid_mask]
    else:
        valid_mask = spatial_mask & (values >= threshold_mm)
        flat_vals = values[valid_mask]

    flat_lats = lats[valid_mask]
    flat_lons = lons[valid_mask]

    pixels = [
        HailPixel(lat=float(flat_lats[i]), lon=float(flat_lons[i]),
                  mesh_mm=float(flat_vals[i]), timestamp=timestamp)
        for i in range(len(flat_vals))
    ]

    label = metro_id or "CONUS"
    logger.info("%s: %d pixels above %.1f mm at %s", label, len(pixels), threshold_mm, timestamp)
    return pixels
