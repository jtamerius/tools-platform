"""
lambda_handler.py — Lambda handler for the maritime AIS ETL pipeline.

Reads AIS CSV files and AVIS vessel metadata from S3, runs the same
clean/merge/segment pipeline as ais_merge.py, and writes partitioned
Parquet to the output bucket.

Environment variables:
    INPUT_BUCKET   S3 bucket with raw/ (AIS CSVs) and avis/ (AVIS metadata)
    OUTPUT_BUCKET  S3 bucket for Parquet output (master-record/)
"""

import json
import logging
import os

import awswrangler as wr
import pandas as pd

INPUT_BUCKET = os.environ["INPUT_BUCKET"]
OUTPUT_BUCKET = os.environ["OUTPUT_BUCKET"]

AIS_COLUMNS  = ["MMSI", "BaseDateTime", "LAT", "LON", "SOG", "COG"]
AVIS_COLUMNS = ["MMSI", "Draft", "Length", "Width", "VesselType"]
SOG_MAX      = 102.2
GAP_HOURS    = 2

_VESSEL_GROUPS = [
    (range(70, 80), "Cargo"),
    (range(80, 90), "Tanker"),
    (range(60, 70), "Passenger"),
    (range(30, 40), "Fishing"),
    (range(50, 60), "Special"),
    (range(90, 100), "Other"),
]


def _vessel_group(vt) -> str:
    if pd.isna(vt):
        return "Unknown"
    for r, label in _VESSEL_GROUPS:
        if int(vt) in r:
            return label
    return "Other"


def handler(event, context):
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    log = logging.getLogger()
    log.info("=== Maritime ETL — starting ===")

    # ── Load AIS ──────────────────────────────────────────────────────────────
    ais_objects = wr.s3.list_objects(f"s3://{INPUT_BUCKET}/raw/")
    if not ais_objects:
        raise RuntimeError(f"No AIS files found at s3://{INPUT_BUCKET}/raw/")

    log.info("Loading %d AIS file(s)...", len(ais_objects))
    frames = []
    for s3_path in ais_objects:
        compression = "zstd" if s3_path.endswith(".zst") else "infer"
        df = wr.s3.read_csv(
            path=s3_path, usecols=AIS_COLUMNS,
            compression=compression, low_memory=False,
        )
        frames.append(df)
        log.info("  %s — %d rows", s3_path.split("/")[-1], len(df))
    ais = pd.concat(frames, ignore_index=True)
    log.info("Total AIS pings: %d", len(ais))

    # ── Load AVIS ─────────────────────────────────────────────────────────────
    avis_objects = wr.s3.list_objects(f"s3://{INPUT_BUCKET}/avis/")
    if avis_objects:
        first = avis_objects[0]
        if first.endswith(".parquet"):
            avis = wr.s3.read_parquet(path=first, columns=AVIS_COLUMNS)
        else:
            avis = wr.s3.read_csv(path=first, usecols=AVIS_COLUMNS, low_memory=False)
        log.info("AVIS records: %d", len(avis))
    else:
        log.warning("No AVIS metadata found — all vessels will be VesselGroup=Unknown")
        avis = pd.DataFrame(columns=AVIS_COLUMNS)

    # ── Clean ─────────────────────────────────────────────────────────────────
    ais["BaseDateTime"] = pd.to_datetime(ais["BaseDateTime"], errors="coerce")
    for col in ["MMSI", "LAT", "LON", "SOG", "COG"]:
        ais[col] = pd.to_numeric(ais[col], errors="coerce")
    before = len(ais)
    ais = ais.dropna(subset=["MMSI", "BaseDateTime", "LAT", "LON"])
    ais = ais[ais["LAT"].between(-90, 90) & ais["LON"].between(-180, 180)]
    ais = ais[ais["SOG"].between(0, SOG_MAX)]
    log.info(
        "Cleaned: %d → %d rows (%.1f%% retained)",
        before, len(ais), 100 * len(ais) / before if before else 0,
    )

    # ── Merge ─────────────────────────────────────────────────────────────────
    avis_dedup = avis[["MMSI", "Draft", "Length", "Width", "VesselType"]].drop_duplicates("MMSI")
    df = ais.merge(avis_dedup, on="MMSI", how="left")
    df["VesselGroup"] = df["VesselType"].apply(_vessel_group)
    matched = df["VesselType"].notna().sum()
    log.info(
        "AVIS join: %d/%d pings matched (%.1f%%)",
        matched, len(df), 100 * matched / len(df) if len(df) else 0,
    )

    # ── Segment trajectories ──────────────────────────────────────────────────
    df = df.sort_values(["MMSI", "BaseDateTime"]).reset_index(drop=True)
    gap = pd.Timedelta(hours=GAP_HOURS)
    time_delta = df.groupby("MMSI", sort=False)["BaseDateTime"].diff()
    new_seg = time_delta.isna() | (time_delta > gap)
    seg_idx = new_seg.groupby(df["MMSI"], sort=False).cumsum() - 1
    df["TripSegmentId"] = df["MMSI"].astype(str) + "_" + seg_idx.astype(int).astype(str)
    log.info(
        "Segmented: %d trips across %d vessels",
        df["TripSegmentId"].nunique(), df["MMSI"].nunique(),
    )

    # ── Write partitioned Parquet ─────────────────────────────────────────────
    out_path = f"s3://{OUTPUT_BUCKET}/master-record/"
    wr.s3.to_parquet(
        df=df,
        path=out_path,
        dataset=True,
        partition_cols=["VesselGroup"],
        compression="snappy",
        mode="overwrite_partitions",
    )
    log.info("Written to %s", out_path)
    log.info("=== Maritime ETL — complete ===")

    return {
        "statusCode": 200,
        "body": json.dumps({
            "pings": len(df),
            "trips": int(df["TripSegmentId"].nunique()),
            "vessels": int(df["MMSI"].nunique()),
        }),
    }
