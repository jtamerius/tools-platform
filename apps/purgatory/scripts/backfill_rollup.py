#!/usr/bin/env python3
"""Backfill the Purgatory rollup cell layer over a date range.

The rollup Lambda keeps itself current (trailing 2h every 15 min, trailing 30
days nightly), but the historical cells have to be built once. Invokes the
deployed Lambda in month-sized chunks rather than aggregating locally, so the
cells are written by exactly the same code path that maintains them.

Usage:
    python apps/purgatory/scripts/backfill_rollup.py production
    python apps/purgatory/scripts/backfill_rollup.py production --start 2026-05-20
    python apps/purgatory/scripts/backfill_rollup.py production --dry-run
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone

import boto3

# The shared detector settled on v5 at this instant; earlier records span four
# model versions in four days and are not comparable with what follows.
DEFAULT_START = "2026-05-20"
CHUNK_DAYS = 15


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("env", choices=["staging", "production"])
    ap.add_argument("--start", default=DEFAULT_START, help="YYYY-MM-DD (default: %(default)s)")
    ap.add_argument("--end", default=None, help="YYYY-MM-DD (default: today)")
    ap.add_argument("--chunk-days", type=int, default=CHUNK_DAYS)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    fn = f"tools-purgatory-rollup-{args.env}"
    start = datetime.strptime(args.start, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    end = (datetime.strptime(args.end, "%Y-%m-%d").replace(tzinfo=timezone.utc)
           if args.end else datetime.now(tz=timezone.utc))

    chunks = []
    cursor = start
    while cursor < end:
        chunk_end = min(cursor + timedelta(days=args.chunk_days), end)
        chunks.append((cursor, chunk_end))
        cursor = chunk_end

    print(f"{fn}: {len(chunks)} chunks from {start:%Y-%m-%d} to {end:%Y-%m-%d}")
    if args.dry_run:
        for a, b in chunks:
            print(f"  {a:%Y-%m-%d} → {b:%Y-%m-%d}")
        return 0

    lam = boto3.client("lambda")
    total = 0
    for i, (a, b) in enumerate(chunks, 1):
        payload = {
            "mode": "backfill",
            "start": a.isoformat().replace("+00:00", "Z"),
            "end": b.isoformat().replace("+00:00", "Z"),
        }
        resp = lam.invoke(FunctionName=fn, Payload=json.dumps(payload).encode())
        body = json.loads(resp["Payload"].read())
        if resp.get("FunctionError") or "error" in body:
            print(f"  [{i}/{len(chunks)}] FAILED {a:%Y-%m-%d}: {body}")
            return 1
        written = body.get("cells_written", 0)
        total += written
        print(f"  [{i}/{len(chunks)}] {a:%Y-%m-%d} → {b:%Y-%m-%d}: {written} cells")

    print(f"done — {total} cells written")
    return 0


if __name__ == "__main__":
    sys.exit(main())
