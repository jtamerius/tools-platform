"""Upload a trained model.pt to S3 as the next shared model version and activate it.

Usage:
    python apps/purgatory/scripts/upload_model.py <path/to/best.pt> [env]
    python apps/purgatory/scripts/upload_model.py runs/detect/purgatory_v2/weights/best.pt production

Deactivates any previously active shared model version.
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import boto3

if len(sys.argv) < 2:
    print("Usage: upload_model.py <best.pt> [env]")
    sys.exit(1)

MODEL_PATH = Path(sys.argv[1])
ENV = sys.argv[2] if len(sys.argv) > 2 else "production"
AWS_PROFILE = "jtam"
S3_BUCKET = f"tools-purgatory-raw-{ENV}-606196119553"
MODEL_PREFIX = "models/shared/"

if not MODEL_PATH.exists():
    print(f"File not found: {MODEL_PATH}")
    sys.exit(1)

session = boto3.Session(profile_name=AWS_PROFILE)
s3 = session.client("s3", region_name="us-east-1")

# Find next version number
paginator = s3.get_paginator("list_objects_v2")
max_ver = 0
for page in paginator.paginate(Bucket=S3_BUCKET, Prefix=MODEL_PREFIX):
    for obj in page.get("Contents", []):
        for part in obj["Key"].split("/"):
            if part.startswith("v") and part[1:].isdigit():
                max_ver = max(max_ver, int(part[1:]))
version = max_ver + 1
print(f"Uploading as v{version}")

# Deactivate any currently active version
for page in paginator.paginate(Bucket=S3_BUCKET, Prefix=MODEL_PREFIX):
    for obj in page.get("Contents", []):
        key = obj["Key"]
        if not key.endswith("/metadata.json"):
            continue
        try:
            meta = json.loads(s3.get_object(Bucket=S3_BUCKET, Key=key)["Body"].read())
            if meta.get("active"):
                meta["active"] = False
                s3.put_object(Bucket=S3_BUCKET, Key=key,
                              Body=json.dumps(meta).encode(), ContentType="application/json")
                print(f"  Deactivated v{meta.get('version')}")
        except Exception:
            pass

# Upload model
model_key = f"{MODEL_PREFIX}v{version}/model.pt"
size_mb = MODEL_PATH.stat().st_size / 1024 / 1024
print(f"Uploading {MODEL_PATH} ({size_mb:.1f} MB) → {model_key}")
s3.upload_file(str(MODEL_PATH), S3_BUCKET, model_key)

# Write metadata
meta_key = f"{MODEL_PREFIX}v{version}/metadata.json"
metadata = {
    "version": version,
    "cam_id": "shared",
    "uploaded_at": datetime.now(tz=timezone.utc).isoformat().replace("+00:00", "Z"),
    "active": True,
    "inference": {"conf": 0.45, "iou": 0.50, "agnostic_nms": True, "max_det": 50},
    "metrics": {},
}
s3.put_object(Bucket=S3_BUCKET, Key=meta_key,
              Body=json.dumps(metadata).encode(), ContentType="application/json")

print(f"Done — shared model v{version} is now active")
print(f"Next ingest tick will use it automatically (within 15 min)")
