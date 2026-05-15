#!/usr/bin/env python3
"""Seed the Purgatory cam config DynamoDB table from cam_config_seed.json.

Usage:
  AWS_PROFILE=jtam python apps/purgatory/scripts/seed_cam_config.py staging
  AWS_PROFILE=jtam python apps/purgatory/scripts/seed_cam_config.py production

The table name is resolved from SSM: /tools/{env}/purgatory/cam-config-table
"""
from __future__ import annotations
import json
import sys
from decimal import Decimal
from pathlib import Path

import boto3

HERE = Path(__file__).parent
SEED_FILE = HERE / "cam_config_seed.json"


def _floats_to_decimal(o):
    if isinstance(o, float):
        return Decimal(str(o))
    if isinstance(o, dict):
        return {k: _floats_to_decimal(v) for k, v in o.items()}
    if isinstance(o, list):
        return [_floats_to_decimal(v) for v in o]
    return o


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in {"staging", "production"}:
        print("usage: seed_cam_config.py <staging|production>", file=sys.stderr)
        sys.exit(1)
    env = sys.argv[1]

    ssm = boto3.client("ssm", region_name="us-east-1")
    table_name = ssm.get_parameter(Name=f"/tools/{env}/purgatory/cam-config-table")["Parameter"]["Value"]
    print(f"seeding into {table_name}")

    ddb = boto3.resource("dynamodb", region_name="us-east-1")
    table = ddb.Table(table_name)

    records = json.loads(SEED_FILE.read_text())
    with table.batch_writer() as bw:
        for rec in records:
            bw.put_item(Item=_floats_to_decimal(rec))
            print(f"  · {rec['cam_id']}")

    print(f"seeded {len(records)} cam config records")


if __name__ == "__main__":
    main()
