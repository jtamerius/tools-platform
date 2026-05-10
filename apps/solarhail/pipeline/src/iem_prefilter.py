"""IEM NWS warning pre-filter: build per-metro set of dates with active SVR/TOR activity.

Before decoding any MRMS GRIB2 files, this module identifies which (metro, date) pairs
had at least one Severe Thunderstorm Warning (SV+W) or Tornado Warning (TO+W) polygon
intersecting the metro bounding box. Only those dates are passed to the MRMS reader,
cutting file-decode volume by 80-90%.

Data sources (both public, no auth):

  Annual consolidated archive (completed years ≤ last year):
    https://mesonet.agron.iastate.edu/pickup/wwa/YYYY_tsmf_sbw.zip
    ~6-7 MB per year. Contains all VTEC storm-based warning polygons.

  Current-year API (partial year, including ongoing backfill window):
    https://mesonet.agron.iastate.edu/cgi-bin/request/gis/watchwarn.py
    Filtered by sts/ets and phenomena. Returns shapefile zip.

Shapefile columns used:
  PHENOM  — phenomenon code: SV (severe tstorm), TO (tornado)
  SIG     — significance: W (warning), A (watch), Y (advisory)
  ISSUED  — polygon issue time (datetime)
  EXPIRED — polygon expiration time (datetime)

IEM archive reference: https://mesonet.agron.iastate.edu/info/datasets/vtec.html
"""

from __future__ import annotations

import io
import json
import logging
import tempfile
import zipfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import geopandas as gpd
import requests
from shapely.geometry import box

from .config import METROS, metro_bbox

logger = logging.getLogger(__name__)

# VTEC codes for events that correlate with damaging hail
WARNING_PHENOMENA = {"SV", "TO"}  # severe thunderstorm + tornado
WARNING_SIGNIFICANCE = "W"

IEM_ANNUAL_ARCHIVE_URL = "https://mesonet.agron.iastate.edu/pickup/wwa/{year}_tsmf_sbw.zip"
IEM_WATCHWARN_URL = (
    "https://mesonet.agron.iastate.edu/cgi-bin/request/gis/watchwarn.py"
    "?sts={sts}&ets={ets}&phenomena={ph}&significance=W"
)

# All states covering the 34 metros (used as coarse server-side filter where supported)
METRO_STATES = "TX,OK,KS,NE,CO,SD,ND,MN,MO,IA,IL,IN,OH,KY,TN,AR,LA,MS,AL"


def _current_year() -> int:
    return datetime.now(timezone.utc).year


def _download_zip_to_gdf(url: str, label: str) -> gpd.GeoDataFrame | None:
    """Download a zip of shapefile from url, return as GeoDataFrame."""
    logger.info("Fetching %s from %s", label, url)
    try:
        r = requests.get(url, timeout=120)
        if r.status_code == 404:
            logger.info("%s returned 404 — no data for this period", label)
            return None
        r.raise_for_status()
    except requests.RequestException as e:
        logger.warning("Failed to fetch %s: %s", label, e)
        return None

    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            zf = zipfile.ZipFile(io.BytesIO(r.content))
            zf.extractall(tmpdir)
            shp_files = list(Path(tmpdir).glob("*.shp"))
            if not shp_files:
                logger.warning("%s zip contained no .shp files", label)
                return None
            gdf = gpd.read_file(str(shp_files[0]))
            logger.info("Loaded %d warning polygons from %s", len(gdf), label)
            return gdf
    except Exception as e:
        logger.warning("Failed to parse %s shapefile: %s", label, e)
        return None


def _fetch_annual_archive(year: int) -> gpd.GeoDataFrame | None:
    """Download and return the IEM annual SBW archive for a completed year.

    Source: https://mesonet.agron.iastate.edu/pickup/wwa/YYYY_tsmf_sbw.zip
    """
    url = IEM_ANNUAL_ARCHIVE_URL.format(year=year)
    return _download_zip_to_gdf(url, f"{year} annual archive")


def _fetch_via_api(start: date, end: date, phenomenon: str) -> gpd.GeoDataFrame | None:
    """Download warnings via IEM watchwarn.py for a date range (current-year data).

    Source: https://mesonet.agron.iastate.edu/cgi-bin/request/gis/watchwarn.py
    """
    sts = f"{start}T00:00Z"
    ets = f"{end}T23:59Z"
    url = IEM_WATCHWARN_URL.format(sts=sts, ets=ets, ph=phenomenon)
    url += f"&states={METRO_STATES}"
    return _download_zip_to_gdf(url, f"watchwarn.py {phenomenon}+W {start}–{end}")


def _load_warnings(start: date, end: date) -> gpd.GeoDataFrame:
    """Load all SVR + TOR warnings covering the date range from the best source.

    Uses annual archive for completed years; live API for current year.
    Merges and deduplicates across sources.
    """
    gdfs: list[gpd.GeoDataFrame] = []
    current_year = _current_year()

    years_needed = set(range(start.year, end.year + 1))

    for year in sorted(years_needed):
        if year < current_year:
            # Completed year — use the consolidated annual archive
            gdf = _fetch_annual_archive(year)
            if gdf is not None:
                # Trim to our date range for this year
                if "ISSUED" in gdf.columns:
                    try:
                        issued = gpd.pd.to_datetime(gdf["ISSUED"], utc=True, errors="coerce")
                        mask = (issued.dt.date >= start) & (issued.dt.date <= end)
                        gdf = gdf[mask]
                    except Exception:
                        pass
                gdfs.append(gdf)
        else:
            # Current (partial) year — use the live API, one call per phenomenon
            year_start = max(start, date(year, 1, 1))
            year_end = min(end, date(year, 12, 31))
            for ph in WARNING_PHENOMENA:
                gdf = _fetch_via_api(year_start, year_end, ph)
                if gdf is not None:
                    gdfs.append(gdf)

    if not gdfs:
        logger.warning("No warning data fetched — pre-filter will pass all dates through")
        return gpd.GeoDataFrame()

    combined = gpd.GeoDataFrame(
        gpd.pd.concat([g for g in gdfs if not g.empty], ignore_index=True)
    )
    combined = combined[
        combined["PHENOM"].isin(WARNING_PHENOMENA) & (combined["SIG"] == WARNING_SIGNIFICANCE)
    ].copy()

    if combined.crs is None:
        combined = combined.set_crs("EPSG:4326")
    else:
        combined = combined.to_crs("EPSG:4326")

    logger.info("Total SVR/TOR warning polygons after filter: %d", len(combined))
    return combined


def get_conus_warning_windows(
    date_: date,
    data_dir: "Path | None" = None,
    force_refresh: bool = False,
) -> list[tuple[datetime, datetime]]:
    """Return all (ISSUED_utc, EXPIRED_utc) SVR/TOR warning windows active on date_.

    Covers all metro states. Used to filter MRMS keys before GRIB2 decoding.
    Cached as JSON in data_dir. Returns empty list if no warnings found — caller
    falls back to processing all keys.
    """
    from .data_downloader import DEFAULT_DATA_DIR
    if data_dir is None:
        data_dir = DEFAULT_DATA_DIR

    cache_path = data_dir / f"conus_windows_{date_}.json"
    if cache_path.exists() and not force_refresh:
        logger.info("Loading CONUS warning windows from cache: %s", cache_path)
        with open(cache_path) as f:
            raw = json.load(f)
        return [(datetime.fromisoformat(w[0]), datetime.fromisoformat(w[1])) for w in raw]

    warnings_gdf = _load_warnings(date_, date_)
    if warnings_gdf.empty:
        logger.info("No SVR/TOR warnings on %s — no time-window filter applied", date_)
        return []

    issued_dts  = gpd.pd.to_datetime(warnings_gdf["ISSUED"],  utc=True, errors="coerce")
    expired_dts = gpd.pd.to_datetime(warnings_gdf["EXPIRED"], utc=True, errors="coerce")

    windows: list[tuple[datetime, datetime]] = []
    for issued, expired in zip(issued_dts, expired_dts):
        if gpd.pd.isna(issued) or gpd.pd.isna(expired):
            continue
        if issued.date() == date_ or expired.date() == date_:
            windows.append((issued.to_pydatetime(), expired.to_pydatetime()))

    data_dir.mkdir(parents=True, exist_ok=True)
    with open(cache_path, "w") as f:
        json.dump([[w[0].isoformat(), w[1].isoformat()] for w in windows], f)

    logger.info("CONUS warning windows for %s: %d active windows", date_, len(windows))
    return windows


def build_warning_index(
    start_date: date,
    end_date: date,
    metro_ids: list[str] | None = None,
    data_dir: Path | None = None,
    force_refresh: bool = False,
) -> dict[str, frozenset[date]]:
    """Build a per-metro index of dates with active SVR or TOR warning polygons.

    Result is cached as JSON in data_dir so subsequent runs are instant.

    Args:
        start_date: First date of backfill window.
        end_date: Last date of backfill window.
        metro_ids: List of metro IDs to compute. Defaults to all 34 metros.
        data_dir: Cache directory. Defaults to pipeline/data/.
        force_refresh: If True, re-download even if cache exists.

    Returns:
        Dict mapping metro_id → frozenset of date objects with warning activity.
        A date absent from the set means no SVR/TOR warning intersected the metro bbox.
    """
    from .data_downloader import DEFAULT_DATA_DIR
    if data_dir is None:
        data_dir = DEFAULT_DATA_DIR

    if metro_ids is None:
        metro_ids = list(METROS.keys())

    cache_path = data_dir / f"warning_index_{start_date}_{end_date}.json"

    if cache_path.exists() and not force_refresh:
        logger.info("Loading warning index from cache: %s", cache_path)
        with open(cache_path) as f:
            raw = json.load(f)
        return {
            mid: frozenset(date.fromisoformat(d) for d in dates)
            for mid, dates in raw.items()
            if mid in metro_ids
        }

    warnings_gdf = _load_warnings(start_date, end_date)

    index: dict[str, set[date]] = {mid: set() for mid in metro_ids}

    if warnings_gdf.empty:
        # Fall-safe: return all dates for all metros (no filtering applied)
        all_dates: set[date] = set()
        d = start_date
        while d <= end_date:
            all_dates.add(d)
            d += timedelta(days=1)
        return {mid: frozenset(all_dates) for mid in metro_ids}

    # Parse issue date from ISSUED column
    try:
        issued_dates = gpd.pd.to_datetime(
            warnings_gdf["ISSUED"], utc=True, errors="coerce"
        ).dt.date
        warnings_gdf = warnings_gdf.copy()
        warnings_gdf["_issued_date"] = issued_dates
    except Exception as e:
        logger.warning("Could not parse ISSUED column: %s — using geometry-only filter", e)
        warnings_gdf["_issued_date"] = None

    for metro_id in metro_ids:
        lat_min, lat_max, lon_min, lon_max = metro_bbox(metro_id)
        metro_box = box(lon_min, lat_min, lon_max, lat_max)

        # Spatial filter: keep only warnings that intersect this metro's bbox
        try:
            hits = warnings_gdf[warnings_gdf.intersects(metro_box)]
        except Exception as e:
            logger.warning("Spatial check failed for %s: %s", metro_id, e)
            hits = warnings_gdf  # conservative fallback

        if hits.empty:
            continue

        for issued_date in hits["_issued_date"].dropna():
            if start_date <= issued_date <= end_date:
                index[metro_id].add(issued_date)

    # Log reduction stats
    total_dates = (end_date - start_date).days + 1
    for mid, warn_dates in index.items():
        pct = 100 * len(warn_dates) / total_dates
        logger.info("Metro %s: %d / %d dates have warnings (%.0f%% of calendar)",
                    mid, len(warn_dates), total_dates, pct)

    total_pairs = sum(len(v) for v in index.values())
    total_possible = len(metro_ids) * total_dates
    reduction = 100 * (1 - total_pairs / max(total_possible, 1))
    logger.info(
        "Pre-filter reduces (metro, date) pairs from %d to %d — %.0f%% reduction",
        total_possible, total_pairs, reduction,
    )

    # Cache to disk
    data_dir.mkdir(parents=True, exist_ok=True)
    serializable = {mid: sorted(d.isoformat() for d in dates) for mid, dates in index.items()}
    with open(cache_path, "w") as f:
        json.dump(serializable, f, indent=2)
    logger.info("Warning index cached to %s", cache_path)

    return {mid: frozenset(dates) for mid, dates in index.items()}
