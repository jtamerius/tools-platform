#!/usr/bin/env python3
"""Submit one AWS Batch job per metro to run the full backfill.

Each job processes a single metro over the configured date range with
UPLOAD_S3=true, writing Parquet output to S3 under the Hive partition path.

Usage:
    # Staging (default)
    python scripts/submit_backfill.py

    # Production
    python scripts/submit_backfill.py --env production

    # Subset of metros
    python scripts/submit_backfill.py --metros okc dfw kc

    # Dry run — print what would be submitted without submitting
    python scripts/submit_backfill.py --dry-run

Prerequisites:
    pip install boto3
    AWS credentials with batch:SubmitJob and ssm:GetParameter permissions.
"""

from __future__ import annotations

import argparse
import json
import sys

import boto3

# ── Defaults ─────────────────────────────────────────────────────────────────

DEFAULT_START_DATE = "2026-02-02"
DEFAULT_END_DATE = "2026-05-01"

ALL_METROS = [
    "dfw", "houston", "san_antonio", "austin", "lubbock", "amarillo",
    "okc", "tulsa", "wichita", "kc", "omaha", "lincoln",
    "denver", "colorado_springs", "sioux_falls", "fargo", "minneapolis",
    "st_louis", "des_moines", "chicago", "indianapolis", "columbus",
    "cincinnati", "cleveland", "dayton", "louisville", "nashville",
    "memphis", "little_rock", "shreveport", "new_orleans", "baton_rouge",
    "jackson_ms", "birmingham",
]


def _ssm_get(ssm_client, name: str) -> str:
    return ssm_client.get_parameter(Name=name)["Parameter"]["Value"]


def submit_backfill(
    env: str,
    metros: list[str],
    start_date: str,
    end_date: str,
    dry_run: bool,
) -> None:
    region = "us-east-1"
    ssm = boto3.client("ssm", region_name=region)
    batch = boto3.client("batch", region_name=region)

    job_queue = _ssm_get(ssm, f"/tools/{env}/solarhail/batch-job-queue")
    job_def   = _ssm_get(ssm, f"/tools/{env}/solarhail/batch-job-definition")

    print(f"env={env}  dates={start_date}→{end_date}  metros={len(metros)}")
    print(f"queue: {job_queue}")
    print(f"jobDef: {job_def}\n")

    submitted = []
    for metro in metros:
        job_name = f"solarhail-backfill-{metro}-{start_date.replace('-', '')}"
        container_override = {
            "environment": [
                {"name": "METRO",       "value": metro},
                {"name": "START_DATE",  "value": start_date},
                {"name": "END_DATE",    "value": end_date},
                {"name": "UPLOAD_S3",   "value": "true"},
                {"name": "SOLARHAIL_ENV", "value": env},
            ],
        }

        if dry_run:
            print(f"[dry-run] would submit: {job_name}")
            print(f"          overrides: {json.dumps(container_override, indent=2)}")
        else:
            resp = batch.submit_job(
                jobName=job_name,
                jobQueue=job_queue,
                jobDefinition=job_def,
                containerOverrides=container_override,
            )
            job_id = resp["jobId"]
            print(f"submitted {job_name} → {job_id}")
            submitted.append({"metro": metro, "jobId": job_id, "jobName": job_name})

    if not dry_run:
        print(f"\n{len(submitted)} jobs submitted.")
        print("Monitor in AWS Batch console or run:")
        print(f'  aws batch list-jobs --job-queue "{job_queue}" --job-status RUNNING')


def main() -> None:
    parser = argparse.ArgumentParser(description="Submit SolarHail backfill Batch jobs")
    parser.add_argument("--env", default="staging", choices=["staging", "production"])
    parser.add_argument("--metros", nargs="+", default=ALL_METROS,
                        help="Metro IDs to process (default: all 34)")
    parser.add_argument("--start-date", default=DEFAULT_START_DATE)
    parser.add_argument("--end-date", default=DEFAULT_END_DATE)
    parser.add_argument("--dry-run", action="store_true",
                        help="Print jobs that would be submitted without submitting")
    args = parser.parse_args()

    invalid = [m for m in args.metros if m not in ALL_METROS]
    if invalid:
        print(f"Unknown metro(s): {invalid}", file=sys.stderr)
        sys.exit(1)

    submit_backfill(
        env=args.env,
        metros=args.metros,
        start_date=args.start_date,
        end_date=args.end_date,
        dry_run=args.dry_run,
    )


if __name__ == "__main__":
    main()
