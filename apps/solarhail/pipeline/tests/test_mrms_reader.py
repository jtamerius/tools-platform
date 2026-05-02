"""Tests for mrms_reader.py (Module 1).

Two layers:
  unit  — bbox slicing and pixel construction logic with a synthetic numpy array
  slow  — live S3 stream of one real GRIB2 file on a known hail day (Apr 15 2026)

Run fast only:
    pytest tests/test_mrms_reader.py -m "not slow" -v

Run all:
    pytest tests/test_mrms_reader.py -v -s
"""

from datetime import date, datetime, timezone
from unittest.mock import MagicMock, patch

import numpy as np
import pytest

from src.config import MRMS_BUCKET, MRMS_PRODUCT, metro_bbox
from src.mrms_reader import HailPixel, _parse_timestamp, read_mrms_pixels


# ── unit: pure logic ──────────────────────────────────────────────────────────

def test_hailpixel_is_namedtuple():
    px = HailPixel(lat=35.5, lon=-97.5, mesh_mm=30.0,
                   timestamp=datetime(2026, 4, 15, 12, 0, tzinfo=timezone.utc))
    assert px.lat == 35.5
    assert px.lon == -97.5
    assert px.mesh_mm == 30.0


def test_parse_timestamp():
    msg = MagicMock()
    msg.year, msg.month, msg.day = 2026, 4, 15
    msg.hour, msg.minute = 18, 20
    ts = _parse_timestamp(msg)
    assert ts == datetime(2026, 4, 15, 18, 20, tzinfo=timezone.utc)


def test_read_mrms_pixels_threshold_filters(tmp_path):
    """Pixels below threshold should be excluded from output."""
    # Build a synthetic GRIB message that covers a small grid over OKC
    lat_min, lat_max, lon_min, lon_max = metro_bbox("okc")
    lat_center = (lat_min + lat_max) / 2
    lon_center = (lon_min + lon_max) / 2

    # 3x3 grid — only center pixel above threshold
    lats = np.array([
        [lat_center - 0.1, lat_center, lat_center + 0.1],
        [lat_center - 0.1, lat_center, lat_center + 0.1],
        [lat_center - 0.1, lat_center, lat_center + 0.1],
    ])
    lons = np.array([
        [lon_center - 0.1, lon_center - 0.1, lon_center - 0.1],
        [lon_center,       lon_center,       lon_center      ],
        [lon_center + 0.1, lon_center + 0.1, lon_center + 0.1],
    ])
    values = np.array([
        [10.0, 10.0, 10.0],
        [10.0, 35.0, 10.0],   # center pixel above 25 mm threshold
        [10.0, 10.0, 10.0],
    ])

    msg = MagicMock()
    msg.latlons.return_value = (lats, lons)
    msg.values = values
    msg.year, msg.month, msg.day = 2026, 4, 15
    msg.hour, msg.minute = 18, 0

    mock_grbs = MagicMock()
    mock_grbs.read.return_value = [msg]

    mock_response = MagicMock()
    mock_response.__getitem__ = MagicMock(return_value=MagicMock(read=MagicMock(return_value=b"")))

    import gzip as _gzip
    fake_gz = _gzip.compress(b"fake-grib-content")

    with patch("src.mrms_reader.pygrib.open", return_value=mock_grbs), \
         patch("src.mrms_reader.boto3.client") as mock_boto:
        mock_s3 = MagicMock()
        mock_s3.get_object.return_value = {"Body": MagicMock(read=MagicMock(return_value=fake_gz))}
        mock_boto.return_value = mock_s3

        pixels = read_mrms_pixels("fake/key.grib2.gz", "okc", threshold_mm=25.0,
                                  s3_client=mock_s3)

    assert len(pixels) == 1
    assert pixels[0].mesh_mm == 35.0
    assert lat_min <= pixels[0].lat <= lat_max
    assert lon_min <= pixels[0].lon <= lon_max


def test_read_mrms_pixels_invalid_metro():
    with pytest.raises(ValueError, match="Unknown metro_id"):
        read_mrms_pixels("fake/key.grib2.gz", "atlantis")


# ── integration: live S3 stream ───────────────────────────────────────────────

@pytest.mark.slow
def test_list_keys_for_apr15_okc():
    """Verify key listing for Apr 15 2026 — a confirmed SVR warning day over OKC."""
    import boto3
    from botocore import UNSIGNED
    from botocore.config import Config
    from src.main import list_mrms_keys_for_date

    s3 = boto3.client("s3", config=Config(signature_version=UNSIGNED), region_name="us-east-1")
    keys = list_mrms_keys_for_date(s3, date(2026, 4, 15), "okc")

    assert len(keys) > 0, "No MRMS files found for Apr 15 2026 — key path may be wrong"
    # ~2-min cadence over 24 hours = ~720 files
    assert len(keys) > 100, f"Expected ~720 files for a full day, got {len(keys)}"
    # Verify key format matches expected pattern
    assert all("MRMS_MESH_Max_30min_00.50_20260415" in k for k in keys)
    assert all(k.endswith(".grib2.gz") for k in keys)
    print(f"\n  {len(keys)} files found. First: {keys[0]}")
    print(f"  Last:  {keys[-1]}")


@pytest.mark.slow
def test_read_pixels_okc_apr15():
    """Stream one midday GRIB2 file over OKC on Apr 15 2026, verify pixel output."""
    import boto3
    from botocore import UNSIGNED
    from botocore.config import Config
    from src.main import list_mrms_keys_for_date

    s3 = boto3.client("s3", config=Config(signature_version=UNSIGNED), region_name="us-east-1")

    # Pick a midday file (most likely to have active storms)
    all_keys = list_mrms_keys_for_date(s3, date(2026, 4, 15), "okc")
    assert all_keys, "No files found — cannot proceed"

    # Find a key near 20:00 UTC (peak afternoon convection)
    target = "20260415-200000"
    candidates = [k for k in all_keys if target[:13] in k]
    key = candidates[0] if candidates else all_keys[len(all_keys) // 2]
    print(f"\n  Testing key: {key}")

    pixels = read_mrms_pixels(key, "okc", threshold_mm=20.0, s3_client=s3)

    print(f"  Pixels above 20mm: {len(pixels)}")
    if pixels:
        print(f"  Max MESH: {max(p.mesh_mm for p in pixels):.1f} mm")
        print(f"  Timestamp: {pixels[0].timestamp}")
        print(f"  Sample pixel: lat={pixels[0].lat:.3f}, lon={pixels[0].lon:.3f}")

    # Even on a confirmed warning day, some files won't have hail over the exact bbox.
    # We just verify the function runs cleanly and returns valid types.
    assert isinstance(pixels, list)
    for px in pixels:
        assert isinstance(px, HailPixel)
        lat_min, lat_max, lon_min, lon_max = metro_bbox("okc")
        assert lat_min <= px.lat <= lat_max, f"Pixel lat {px.lat} outside OKC bbox"
        assert lon_min <= px.lon <= lon_max, f"Pixel lon {px.lon} outside OKC bbox"
        assert px.mesh_mm >= 20.0
        assert px.timestamp.tzinfo is not None
