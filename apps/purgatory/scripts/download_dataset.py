"""Download all labeled images + labels from S3 and build a YOLO dataset directory.

Usage:
    python apps/purgatory/scripts/download_dataset.py [env]  (default: production)

Output: purgatory_dataset/
    images/train|val|test/
    labels/train|val|test/
    data.yaml
"""
import random
import sys
from pathlib import Path

import boto3
from boto3.dynamodb.conditions import Attr, Key

ENV = sys.argv[1] if len(sys.argv) > 1 else "production"
AWS_PROFILE = "jtam"
INGEST_TABLE = f"tools-purgatory-ingest-{ENV}"
CAM_CONFIG_TABLE = f"tools-purgatory-cam-config-{ENV}"
S3_BUCKET = f"tools-purgatory-raw-{ENV}-606196119553"
SPLIT = (0.70, 0.15, 0.15)

session = boto3.Session(profile_name=AWS_PROFILE)
ddb = session.resource("dynamodb", region_name="us-east-1")
s3 = session.client("s3", region_name="us-east-1")

print(f"Env: {ENV}")

cam_table = ddb.Table(CAM_CONFIG_TABLE)
cams = cam_table.scan(
    FilterExpression=Attr("active").eq(True) & Attr("cam_type").eq("traffic"),
    ProjectionExpression="cam_id",
).get("Items", [])
cam_ids = [c["cam_id"] for c in cams]
print(f"Cameras: {cam_ids}")

table = ddb.Table(INGEST_TABLE)
records = []
for cam_id in cam_ids:
    kw = {
        "KeyConditionExpression": Key("pk").eq(f"CAM#{cam_id}"),
        "FilterExpression": Attr("labeled").eq(True) & Attr("s3_key").exists(),
    }
    while True:
        r = table.query(**kw)
        records.extend(r.get("Items", []))
        if "LastEvaluatedKey" not in r:
            break
        kw["ExclusiveStartKey"] = r["LastEvaluatedKey"]

print(f"Labeled records: {len(records)}")
if not records:
    print("No labeled records found — nothing to do.")
    sys.exit(1)

random.seed(42)
random.shuffle(records)
n = len(records)
n_train = int(n * SPLIT[0])
n_val = int(n * SPLIT[1])
splits = {
    "train": records[:n_train],
    "val": records[n_train:n_train + n_val],
    "test": records[n_train + n_val:],
}

base = Path("purgatory_dataset")
for split_name in splits:
    (base / "images" / split_name).mkdir(parents=True, exist_ok=True)
    (base / "labels" / split_name).mkdir(parents=True, exist_ok=True)

downloaded = 0
skipped = 0
for split_name, recs in splits.items():
    print(f"\n{split_name}: {len(recs)} records")
    for rec in recs:
        cam_id = rec["pk"].replace("CAM#", "")
        sk = rec["sk"]
        s3_key = rec.get("s3_key", "")
        filename = s3_key.split("/")[-1] if s3_key else f"{sk}.jpg"
        stem = filename.rsplit(".", 1)[0]
        img_name = f"{cam_id}_{filename}"
        lbl_name = f"{cam_id}_{stem}.txt"

        img_path = base / "images" / split_name / img_name
        lbl_path = base / "labels" / split_name / lbl_name

        try:
            if not img_path.exists():
                s3.download_file(S3_BUCKET, s3_key, str(img_path))
        except Exception as e:
            print(f"  skip {s3_key}: {e}")
            skipped += 1
            continue

        label_key = f"labels/{cam_id}/{sk}.txt"
        try:
            s3.download_file(S3_BUCKET, label_key, str(lbl_path))
        except Exception:
            lbl_path.write_text("")

        downloaded += 1
        print(f"  {img_name}", end="\r")

print(f"\n\nDone — {downloaded} downloaded, {skipped} skipped")

(base / "data.yaml").write_text(
    f"path: {base.resolve()}\n"
    "train: images/train\n"
    "val: images/val\n"
    "test: images/test\n"
    "nc: 1\n"
    "names: [vehicle]\n"
)

print(f"\nDataset: {base.resolve()}")
print(f"  train={len(splits['train'])}  val={len(splits['val'])}  test={len(splits['test'])}")
print(f"\nNext:")
print(f"  pip install ultralytics")
print(f"  yolo train data={base.resolve()}/data.yaml model=yolov8n.pt epochs=50 imgsz=640 name=purgatory_v1")
