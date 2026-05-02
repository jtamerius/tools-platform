"""Download and cache DeepSolar-3M CSV and Census TIGER national block group shapefile.

Data sources (both public, no credentials required):

  DeepSolar-3M block-group dataset:
    https://github.com/rajanieprabha/DeepSolar-3M/blob/main/dataset/blockgroup_level_data.csv
    Columns: block_group_FIPS (12-digit), "Total PV system count", area, percentages
    Vintage: ~2018–2021 national solar installation survey

  Census TIGER 2023 national block group shapefile (cartographic boundary, 500k scale):
    https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_bg_500k.zip
    ~97 MB zip, ~240 MB unzipped. GEOID column = 12-digit block group FIPS.
    Downloaded once and cached; covers all 34 metros without state-by-state downloads.
"""

from __future__ import annotations

import logging
import zipfile
from pathlib import Path

import requests

from .config import DEEPSOLAR_URL, TIGER_BG_NATIONAL_URL

logger = logging.getLogger(__name__)

DEFAULT_DATA_DIR = Path(__file__).parent.parent / "data"


def _download(url: str, dest: Path, desc: str = "") -> None:
    label = desc or url.split("/")[-1]
    logger.info("Downloading %s → %s", label, dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    r = requests.get(url, stream=True, timeout=300)
    r.raise_for_status()
    total = int(r.headers.get("Content-Length", 0))
    downloaded = 0
    with open(dest, "wb") as f:
        for chunk in r.iter_content(chunk_size=1 << 20):
            f.write(chunk)
            downloaded += len(chunk)
    logger.info("Downloaded %.1f MB", downloaded / 1e6)


def fetch_deepsolar(data_dir: Path = DEFAULT_DATA_DIR) -> Path:
    """Download DeepSolar-3M block-group CSV if not already cached.

    Source:
      https://github.com/rajanieprabha/DeepSolar-3M/blob/main/dataset/blockgroup_level_data.csv

    Returns:
        Local path to the CSV file.
    """
    dest = data_dir / "deepsolar_blockgroup.csv"
    if dest.exists():
        logger.info("DeepSolar CSV already cached: %s", dest)
        return dest
    _download(DEEPSOLAR_URL, dest, desc="DeepSolar-3M blockgroup CSV")
    return dest


def fetch_tiger_blockgroups(data_dir: Path = DEFAULT_DATA_DIR) -> Path:
    """Download Census TIGER 2023 national block group shapefile if not already cached.

    Source:
      https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_bg_500k.zip
      ~97 MB download, ~240 MB unzipped. One-time download covers all 34 metros.

    Returns:
        Local path to the .shp file.
    """
    extract_dir = data_dir / "tiger_bg_national"
    shp_path = extract_dir / "cb_2023_us_bg_500k.shp"

    if shp_path.exists():
        logger.info("TIGER national BG shapefile already cached: %s", shp_path)
        return shp_path

    zip_dest = data_dir / "cb_2023_us_bg_500k.zip"
    _download(TIGER_BG_NATIONAL_URL, zip_dest, desc="Census TIGER 2023 national block groups (~97 MB)")

    extract_dir.mkdir(parents=True, exist_ok=True)
    logger.info("Extracting to %s", extract_dir)
    with zipfile.ZipFile(zip_dest) as zf:
        zf.extractall(extract_dir)
    zip_dest.unlink()
    logger.info("TIGER BG shapefile ready: %s", shp_path)
    return shp_path


def fetch_all(data_dir: Path = DEFAULT_DATA_DIR) -> tuple[Path, Path]:
    """Download DeepSolar CSV and TIGER block group shapefile (both cached after first run).

    Returns:
        (deepsolar_csv_path, tiger_shp_path)
    """
    csv_path = fetch_deepsolar(data_dir)
    shp_path = fetch_tiger_blockgroups(data_dir)
    return csv_path, shp_path
