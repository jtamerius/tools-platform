---
name: model-retrain-purgatory
description: Retrain and deploy the shared Purgatory YOLO vehicle detection model from the latest labeled dataset.
allowed-tools: Bash(python *), Bash(yolo *), Bash(aws *), Bash(pip *)
---

# Retrain Purgatory YOLO Model

One shared YOLOv8n model, single vehicle class (class 0), trained on labeled images from all cameras.
S3 path: `models/shared/v{N}/model.pt` in `tools-purgatory-raw-production-606196119553`.

## When to retrain

- After labeling a meaningful batch of new images (suggested: every ~50–100 new labels)
- Current labeled count: check via `purg.jtamerius.com` → Annotate → Labels → "X/Y labeled"
- Or query directly:

```bash
python3 -c "
import boto3
from boto3.dynamodb.conditions import Attr, Key
session = boto3.Session(profile_name='jtam')
ddb = session.resource('dynamodb', region_name='us-east-1')
table = ddb.Table('tools-purgatory-ingest-production')
cams = ['952-N', '952-S', '957-N', '1053-N']
total = 0
for cam in cams:
    r = table.query(
        KeyConditionExpression=Key('pk').eq(f'CAM#{cam}'),
        FilterExpression=Attr('labeled').eq(True),
        Select='COUNT',
    )
    print(f'{cam}: {r[\"Count\"]}')
    total += r['Count']
print(f'Total: {total}')
"
```

## Step 1 — Download labeled dataset

```bash
cd /Users/James/website_hub/website_hub
python apps/purgatory/scripts/download_dataset.py production
```

Downloads all labeled images + label files from S3 into `purgatory_dataset/` with a 70/15/15 train/val/test split. Safe to re-run — skips already-downloaded images.

Output structure:
```
purgatory_dataset/
  images/train|val|test/   {cam_id}_{timestamp}.jpg
  labels/train|val|test/   {cam_id}_{timestamp}.txt   (YOLO format: 0 cx cy w h)
  data.yaml                nc: 1, names: [vehicle]
```

## Step 2 — Train

Determine the next version number first:

```bash
AWS_PROFILE=jtam aws s3 ls s3://tools-purgatory-raw-production-606196119553/models/shared/ \
  --recursive | grep metadata.json
```

Then train (replace `vN` with the next version).

**Always start from the previous model's `best.pt`** — faster convergence, better results since the model already knows this camera context. Only use `yolov8n.pt` if there is no previous model.

Download the previous active model first:
```bash
AWS_PROFILE=jtam aws s3 cp \
  s3://tools-purgatory-raw-production-606196119553/models/shared/vPREV/model.pt \
  prev_best.pt
```

Then train — launch the live dashboard first, then start training:
```bash
python apps/purgatory/scripts/training_dashboard.py &
yolo train \
  data=purgatory_dataset/data.yaml \
  model=prev_best.pt \
  epochs=100 \
  imgsz=640 \
  name=purgatory_vN
```

The dashboard auto-finds the latest `results.csv` and refreshes every 15 seconds. To watch a specific run: `python apps/purgatory/scripts/training_dashboard.py runs/detect/purgatory_vN/results.csv`

Runs on Apple M2 MPS automatically. Output: `runs/detect/purgatory_vN/weights/best.pt`.

### Interpreting results

| Metric | Target | Notes |
|--------|--------|-------|
| mAP50 | > 0.75 | Primary quality signal |
| mAP50-95 | > 0.20 | Strict localization, harder to move |
| Precision | > 0.80 | False positive rate |
| Recall | > 0.60 | Miss rate — more important than precision for counting |

If mAP50 < 0.60: label more diverse images (different times of day, weather, traffic levels) before retraining.

## Step 3 — Upload and activate

```bash
python apps/purgatory/scripts/upload_model.py \
  runs/detect/purgatory_vN/weights/best.pt \
  production
```

This script:
1. Finds the current max version in `models/shared/` and increments
2. Deactivates any previously active version
3. Uploads `best.pt` to `models/shared/v{N}/model.pt`
4. Writes `metadata.json` with `active: true`

The ingest Lambda picks up the new model within 15 minutes (next EventBridge tick).

## Step 4 — Verify

Trigger a manual ingest on one cam and check the log:

```bash
AWS_PROFILE=jtam aws lambda invoke \
  --function-name tools-purgatory-ingest-production \
  --payload '{"cam_id":"952-N"}' --cli-binary-format raw-in-base64-out \
  --region us-east-1 --no-cli-pager /tmp/out.json && cat /tmp/out.json

AWS_PROFILE=jtam aws logs tail /aws/lambda/tools-purgatory-ingest-production \
  --since 5m --region us-east-1
```

Look for `model_s3_key: models/shared/v{N}/model.pt` in the log output.

## Updating inference parameters

If boxes are too noisy (lower conf) or missing vehicles (raise recall):

```bash
python3 -c "
import boto3, json
session = boto3.Session(profile_name='jtam')
s3 = session.client('s3', region_name='us-east-1')
key = 'models/shared/vN/metadata.json'
bucket = 'tools-purgatory-raw-production-606196119553'
meta = json.loads(s3.get_object(Bucket=bucket, Key=key)['Body'].read())
meta['inference']['conf'] = 0.35   # lower = more detections, more noise
meta['inference']['iou'] = 0.50
s3.put_object(Bucket=bucket, Key=key, Body=json.dumps(meta).encode(), ContentType='application/json')
print('updated')
"
```

Default inference params: `conf=0.45, iou=0.50, agnostic_nms=True, max_det=50`

## Model history

| Version | Trained | Images | mAP50 | Notes |
|---------|---------|--------|-------|-------|
| v1 | 2026-05-17 | 95 (4 cams) | 0.815 | First model — nighttime images only (labeled overnight) |
