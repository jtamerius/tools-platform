#!/usr/bin/env python3
"""Submit one AWS Batch job per date to reprocess CONUS hail data.

Used to backfill/reprocess existing conus.json.gz files — e.g. after fixing
the IEM time-window filter bug that was silently dropping hail events.

Each job runs run_conus_day.py for a single date, overwriting the existing
S3 file in place with corrected data.

Usage:
    # Dry run — see what would be submitted
    AWS_PROFILE=jtam python scripts/submit_conus_reprocess.py --dry-run

    # Reprocess all dates with data in production
    AWS_PROFILE=jtam python scripts/submit_conus_reprocess.py

    # Reprocess a specific date range
    AWS_PROFILE=jtam python scripts/submit_conus_reprocess.py --start 2026-04-01 --end 2026-04-30

Prerequisites:
    AWS credentials with batch:SubmitJob, s3:ListBucket, ssm:GetParameter.
"""

from __future__ import annotations

import argparse
from datetime import date, timedelta

import boto3

ENV = "production"
REGION = "us-east-1"


def list_existing_dates(s3_client, bucket: str) -> list[str]:
    """Return all event_date= prefixes that have a conus.json.gz file."""
    paginator = s3_client.get_paginator("list_objects_v2")
    dates = []
    for page in paginator.paginate(Bucket=bucket, Prefix="parquet/hail-events/", Delimiter="/"):
        for prefix in page.get("CommonPrefixes", []):
            p = prefix["Prefix"]  # e.g. parquet/hail-events/event_date=2026-04-25/
            date_str = p.split("event_date=")[-1].rstrip("/")
            # Check conus.json.gz exists
            resp = s3_client.list_objects_v2(Bucket=bucket, Prefix=f"{p}conus.json.gz")
            if resp.get("KeyCount", 0) > 0:
                dates.append(date_str)
    return sorted(dates)


def daterange(start: str, end: str) -> list[str]:
    d = date.fromisoformat(start)
    e = date.fromisoformat(end)
    out = []
    while d <= e:
        out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description="Reprocess CONUS hail dates via Batch")
    parser.add_argument("--start", help="Start date YYYY-MM-DD (default: all dates in S3)")
    parser.add_argument("--end",   help="End date YYYY-MM-DD (default: all dates in S3)")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    ssm   = boto3.client("ssm",   region_name=REGION)
    batch = boto3.client("batch", region_name=REGION)
    s3    = boto3.client("s3",    region_name=REGION)

    job_def   = ssm.get_parameter(Name=f"/tools/{ENV}/solarhail/batch-conus-job-definition")["Parameter"]["Value"]
    job_queue = ssm.get_parameter(Name=f"/tools/{ENV}/solarhail/batch-ondemand-queue")["Parameter"]["Value"]
    bucket    = ssm.get_parameter(Name=f"/tools/{ENV}/solarhail/s3-bucket")["Parameter"]["Value"]

    if args.start and args.end:
        dates = daterange(args.start, args.end)
    else:
        print("Scanning S3 for existing conus.json.gz dates...")
        dates = list_existing_dates(s3, bucket)

    print(f"env={ENV}  dates to reprocess: {len(dates)}")
    print(f"queue:  {job_queue}")
    print(f"jobDef: {job_def}\n")

    submitted = []
    for d in dates:
        job_name = f"solarhail-conus-reprocess-{d.replace('-', '')}"
        if args.dry_run:
            print(f"[dry-run] {job_name}  date={d}")
        else:
            resp = batch.submit_job(
                jobName=job_name,
                jobQueue=job_queue,
                jobDefinition=job_def,
                parameters={"event_date": d},
            )
            print(f"submitted {job_name} → {resp['jobId']}")
            submitted.append(resp["jobId"])

    if not args.dry_run:
        print(f"\n{len(submitted)} jobs submitted.")
        print(f"Monitor: aws batch list-jobs --job-queue \"{job_queue}\" --job-status RUNNING --region {REGION}")


if __name__ == "__main__":
    main()
