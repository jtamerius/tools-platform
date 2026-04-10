#!/usr/bin/env python3
"""
ais_merge.py — SageMaker Processing Job script for Phase 1: Maritime Master
Record synthesis.

Reads Zstd-compressed AIS CSVs from /opt/ml/processing/input/ais, joins them
with AVIS static vessel metadata from /opt/ml/processing/input/avis, cleans
out-of-range coordinates and sentinel speed values, segments each vessel's
trajectory into discrete trip records by splitting on time gaps that exceed
GAP_THRESHOLD_HOURS, and writes the enriched dataset as Snappy-compressed
Parquet partitioned by VesselGroup to /opt/ml/processing/output.

Upload this file to the scripts/ prefix of the AIS input bucket before
starting the Step Functions pipeline:
  aws s3 cp src/processing/ais_merge.py \\
    s3://tools-maritime-ais-input-<env>-<account>/scripts/ais_merge.py

Required Python packages (not present in all SageMaker base images):
  pip install pyarrow zstandard
Use a custom ECR image or add a requirements.txt to the scripts/ prefix and
install at container startup via a wrapper entrypoint if needed.
"""

import logging
from pathlib import Path

import numpy as np
import pandas as pd

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger(__name__)

# ── Paths injected by SageMaker ───────────────────────────────────────────────
INPUT_AIS_DIR  = Path("/opt/ml/processing/input/ais")
INPUT_AVIS_DIR = Path("/opt/ml/processing/input/avis")
OUTPUT_DIR     = Path("/opt/ml/processing/output")

# ── Processing constants ──────────────────────────────────────────────────────
# NOAA AIS spec: SOG 102.3 knots is the "not available" sentinel value.
SOG_MAX_KNOTS = 102.2
# Split a vessel's ping stream into a new trip segment when the time gap
# between consecutive pings exceeds this threshold.
GAP_THRESHOLD_HOURS = 2

AIS_COLUMNS  = ["MMSI", "BaseDateTime", "LAT", "LON", "SOG", "COG"]
AVIS_COLUMNS = ["MMSI", "IMO", "Draft", "Length", "Width", "VesselType"]

# Coarse vessel categories derived from ITU/NOAA AIS VesselType numeric codes.
# Ranges follow the ITU-R M.1371 ship type table (tens digit = category).
_VESSEL_TYPE_GROUPS: list[tuple[range, str]] = [
    (range(70, 80), "Cargo"),
    (range(80, 90), "Tanker"),
    (range(60, 70), "Passenger"),
    (range(30, 40), "Fishing"),
    (range(50, 60), "Special"),
    (range(90, 100), "Other"),
]


def _vessel_group(vessel_type: int | float) -> str:
    if pd.isna(vessel_type):
        return "Unknown"
    vt = int(vessel_type)
    for r, label in _VESSEL_TYPE_GROUPS:
        if vt in r:
            return label
    return "Other"


# ── I/O helpers ───────────────────────────────────────────────────────────────

def load_ais(ais_dir: Path) -> pd.DataFrame:
    """Read all Zstd-compressed (*.csv.zst) and plain (*.csv) AIS files."""
    files = sorted(ais_dir.glob("*.csv.zst")) + sorted(ais_dir.glob("*.csv"))
    if not files:
        raise FileNotFoundError(f"No AIS CSV files in {ais_dir}")

    frames = []
    for f in files:
        compression = "zstd" if f.suffix == ".zst" else "infer"
        df = pd.read_csv(f, compression=compression, usecols=AIS_COLUMNS, low_memory=False)
        frames.append(df)
        logger.info("Loaded %s  (%d rows)", f.name, len(df))

    ais = pd.concat(frames, ignore_index=True)
    logger.info("Total AIS pings loaded: %d from %d file(s)", len(ais), len(files))
    return ais


def load_avis(avis_dir: Path) -> pd.DataFrame:
    """Read AVIS vessel metadata — Parquet preferred, CSV fallback."""
    parquet_files = list(avis_dir.glob("*.parquet"))
    csv_files     = list(avis_dir.glob("*.csv"))

    if parquet_files:
        avis = pd.read_parquet(parquet_files[0], columns=AVIS_COLUMNS)
    elif csv_files:
        avis = pd.read_csv(csv_files[0], usecols=AVIS_COLUMNS, low_memory=False)
    else:
        raise FileNotFoundError(f"No AVIS metadata file in {avis_dir}")

    logger.info("AVIS vessel records loaded: %d", len(avis))
    return avis


def write_output(df: pd.DataFrame, output_dir: Path) -> None:
    """Write enriched records as Parquet partitioned by VesselGroup."""
    output_dir.mkdir(parents=True, exist_ok=True)
    for group, subset in df.groupby("VesselGroup", observed=True):
        out_path = output_dir / f"vessel_group={group}" / "data.parquet"
        out_path.parent.mkdir(parents=True, exist_ok=True)
        subset.to_parquet(out_path, index=False, engine="pyarrow", compression="snappy")
        logger.info("Wrote %d rows → %s", len(subset), out_path.relative_to(output_dir))


# ── Processing stages ─────────────────────────────────────────────────────────

def clean_ais(ais: pd.DataFrame) -> pd.DataFrame:
    """Coerce types and drop rows with invalid coordinates, timestamps, or SOG."""
    ais["BaseDateTime"] = pd.to_datetime(ais["BaseDateTime"], errors="coerce")
    ais["MMSI"]         = pd.to_numeric(ais["MMSI"], errors="coerce").astype("Int64")
    ais["LAT"]          = pd.to_numeric(ais["LAT"],  errors="coerce")
    ais["LON"]          = pd.to_numeric(ais["LON"],  errors="coerce")
    ais["SOG"]          = pd.to_numeric(ais["SOG"],  errors="coerce")
    ais["COG"]          = pd.to_numeric(ais["COG"],  errors="coerce")

    before = len(ais)
    ais = ais.dropna(subset=["MMSI", "BaseDateTime", "LAT", "LON"])
    ais = ais[ais["LAT"].between(-90, 90) & ais["LON"].between(-180, 180)]
    ais = ais[ais["SOG"].between(0, SOG_MAX_KNOTS)]
    after = len(ais)

    logger.info(
        "Cleaning: dropped %d invalid rows  (%d → %d, %.1f%% retained)",
        before - after, before, after, 100 * after / before if before else 0,
    )
    return ais.reset_index(drop=True)


def merge_avis(ais: pd.DataFrame, avis: pd.DataFrame) -> pd.DataFrame:
    """Left-join AIS pings with AVIS metadata on MMSI and assign VesselGroup."""
    # Keep one AVIS record per MMSI (deduplicate on first occurrence).
    avis_dedup = (
        avis[["MMSI", "Draft", "Length", "Width", "VesselType"]]
        .drop_duplicates(subset=["MMSI"], keep="first")
    )
    enriched = ais.merge(avis_dedup, on="MMSI", how="left")
    enriched["VesselGroup"] = enriched["VesselType"].apply(_vessel_group)

    matched = enriched["VesselType"].notna().sum()
    logger.info(
        "AVIS join: %d / %d pings matched (%.1f%%)",
        matched, len(enriched), 100 * matched / len(enriched) if len(enriched) else 0,
    )
    return enriched


def segment_trajectories(df: pd.DataFrame) -> pd.DataFrame:
    """
    Assign a globally unique TripSegmentId to each ping.

    Pings are sorted by (MMSI, BaseDateTime). A new trip segment begins for a
    vessel whenever the time between consecutive pings exceeds GAP_THRESHOLD_HOURS
    (default 2 h), isolating port calls, anchorage periods, or data outages from
    active voyages. The resulting TripSegmentId has the form "<MMSI>_<n>" where
    n is the per-vessel segment counter (0-based).
    """
    df = df.sort_values(["MMSI", "BaseDateTime"]).reset_index(drop=True)
    gap = pd.Timedelta(hours=GAP_THRESHOLD_HOURS)

    # TimeDelta is NaN at each vessel's first ping — treat that as a segment start.
    time_delta    = df.groupby("MMSI", sort=False)["BaseDateTime"].diff()
    new_segment   = time_delta.isna() | (time_delta > gap)
    segment_index = new_segment.groupby(df["MMSI"], sort=False).cumsum() - 1

    df["TripSegmentId"] = df["MMSI"].astype(str) + "_" + segment_index.astype(int).astype(str)
    df = df.drop(columns=[])  # no temp columns to drop — kept inline above

    logger.info(
        "Segmentation: %d pings → %d trip segments across %d vessels",
        len(df), df["TripSegmentId"].nunique(), df["MMSI"].nunique(),
    )
    return df


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    logger.info("=== Maritime Master Record synthesis — starting ===")

    ais      = load_ais(INPUT_AIS_DIR)
    avis     = load_avis(INPUT_AVIS_DIR)
    ais      = clean_ais(ais)
    enriched = merge_avis(ais, avis)
    enriched = segment_trajectories(enriched)
    write_output(enriched, OUTPUT_DIR)

    logger.info("=== Maritime Master Record synthesis — complete ===")
    logger.info(
        "Summary: %d pings / %d segments / %d vessels written to %s",
        len(enriched),
        enriched["TripSegmentId"].nunique(),
        enriched["MMSI"].nunique(),
        OUTPUT_DIR,
    )


if __name__ == "__main__":
    main()
