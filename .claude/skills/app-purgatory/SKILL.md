---
name: app-purgatory
description: Reference for the Purgatory Crowding Intelligence app — architecture, ingest pipeline, AWS resources, and operational runbook.
allowed-tools: Bash(aws *), Bash(python *)
---

# Purgatory Crowding Intelligence — Reference & Build Guide

## What It Is

Traffic-cam + RWIS ingestion pipeline for predicting crowd levels at Purgatory Resort (Durango, CO). Polls Colorado DOT (COTRIP) cameras along US-550 every 15 min, runs YOLOv8n vehicle detection on the images, and flags anomalous records for a Claude (Bedrock) QC agent. A Cognito-gated React review + annotation UI lets an admin review flagged records, draw zone polygons, label vehicles, and manage the shared YOLO model.

Cognito-gated, **admin** group required. Production URL: `https://purg.jtamerius.com`.

## Phases

| Phase | Status | Description |
|-------|--------|-------------|
| **1.0** | In progress | Traffic-cam ingest — image fetch + YOLO + RWIS join + agent QC + review UI |
| **1.1** | In progress | Resort scrape — current conditions + forecast from purgatoryresort.com |
| **1.2** | Done | Annotate tab — zone editor (Inbound/Outbound polygons), vehicle labeling (BboxEditor), shared model management |
| 1.3 | Not started | Crowding prediction model (training data = post-review records) |

## Architecture

```
EventBridge (rate 15 min) → IngestFunction (container Lambda, fan-out)
  ├─ scans CamConfig DDB → self-invokes per active cam_id
  └─ per-cam invocation:
       ├─ cotrip.py        fetch image_captured_at + RWIS (partner cam only)
       ├─ image fetch      HTTPS GET → S3 raw/{cam_id}/{ts}.jpg
       ├─ yolo_count.py    YOLOv8n inference; bottom-center point in zone polygons
       │                   → vehicle_count (total) + vehicle_counts_by_zone {Inbound: N, Outbound: M}
       ├─ image stats      Pillow brightness/variance/edge density + image_width/image_height
       ├─ pvlib solar      altitude/azimuth at lat/lon
       ├─ flagging.py      5 rules → needs_review boolean
       └─ agent.py         3-tier Bedrock decision (propagation → metadata → image)
                           Writes to IngestTable with agent_* fields

EventBridge (rate 15 min) → ScrapeFunction (Python zip Lambda)
  └─ BeautifulSoup scrape of purgatoryresort.com → ResortTable

API Gateway HTTP v2 (Cognito JWT, admin group) → ApiFunction (Python zip Lambda):
  GET    /api/queue                  flagged records needing review
  GET    /api/search                 decision/source/visibility/confidence filters
  GET    /api/image?pk=&sk=          presigned S3 URL (600s TTL)
  GET    /api/neighbors?sk=          same-timestamp records across other cams
  GET    /api/history?cam_id=&hours= last N hours for a cam
  POST   /api/decisions              reviewer keep/unusable/follow_up
  GET    /api/cam-config?cam_id=     fetch cam config (includes zones)
  PUT    /api/cam-config             update cam zones
  GET    /api/label?pk=&sk=          fetch vehicle labels for an image
  POST   /api/label                  save vehicle labels
  GET    /api/models?cam_id=shared   list shared model versions
  POST   /api/model-upload-url       presigned PUT URL for new model .pt
  PATCH  /api/model-meta             activate/update inference params/metrics
  GET    /api/export-labels          export all-camera YOLO training ZIP

React + Plotly + Cognito → Amplify hosting (CI/CD deploy)
  Pages: ReviewPage (queue/search), AnnotatePage (zones/labels/models)
```

## Directory

```
apps/purgatory/
├── frontend/             React review UI (Cognito JWT-gated, admin group)
│   ├── src/
│   │   ├── App.jsx                       Cognito auth gate, sign-in form, nav tabs
│   │   ├── pages/
│   │   │   ├── ReviewPage.jsx            queue/search mode tabs
│   │   │   └── AnnotatePage.jsx          Zones / Labels / Models sub-tabs
│   │   ├── components/
│   │   │   ├── RecordPanel.jsx           image + counts + RWIS + agent reasoning
│   │   │   ├── TrafficPlot.jsx           Plotly 24h scatter
│   │   │   ├── FilterBar.jsx             cam/date/decision/source/confidence/visibility
│   │   │   ├── ZoneEditor.jsx            canvas polygon editor — Inbound/Outbound zones
│   │   │   ├── BboxEditor.jsx            canvas bbox editor — single vehicle class
│   │   │   └── Nav.jsx                   shared platform nav
│   │   └── hooks/useReviewApi.js         all API calls incl. label/model/zone routes
│   └── vite.config.js
├── ingest/               Container Lambda — image fetch + YOLO + RWIS + agent QC
│   ├── Dockerfile        downloads yolov8n.pt at build (baked-in fallback if no S3 model)
│   ├── requirements.txt  boto3, requests, Pillow, numpy, pvlib, shapely, ultralytics, torch
│   └── src/
│       ├── handler.py    fan-out + per-cam pipeline; _resolve_model_key() checks models/shared/
│       ├── config.py     env vars, YOLO config, thresholds
│       ├── cotrip.py     GraphQL MAP_FEATURES_QUERY + WEATHER_STATION_QUERY (station 374)
│       ├── yolo_count.py YOLOv8n inference — single vehicle class; zone containment via shapely
│       ├── flagging.py   5 rules: count-outlier, vis/edge disagreement, low YOLO conf, daily stratified, random
│       └── agent.py      Bedrock 3-tier (propagation → metadata → image) + DDB monthly cap
├── scrape/               Python zip Lambda — purgatoryresort.com scrape
│   └── src/handler.py    BeautifulSoup; writes RESORT#PURGATORY pk
├── api/                  Python zip Lambda — review UI backend
│   └── handler.py        14 routes; _jpeg_dims() for old records missing image dimensions
└── scripts/
    ├── cam_config_seed.json     cam records (952-N, 952-S, 957-N, 957-S, 1053-N, 3285-N, 3287-N, 3288-N, 3289-S, 3291-E, 954-RWIS)
    ├── seed_cam_config.py       resolves table via SSM, batch writes records
    ├── download_dataset.py      pulls all labeled images+labels from S3 → purgatory_dataset/
    └── upload_model.py          uploads best.pt as next shared model version, activates it

infra/cdk/lib/stacks/purgatory-stack.ts   CDK stack (S3, DDB, ECR-referenced, Lambdas, API GW)
```

## Locked Decisions

| Decision | Value |
|----------|-------|
| Ingest cadence | EventBridge rate(15 minutes) |
| YOLO model | YOLOv8n — baked into Docker image as fallback; active model loaded from `models/shared/` in S3 |
| YOLO class | Single class: **vehicle** (class 0) — counts cars, trucks, buses, motorcycles as one |
| YOLO inference conf | 0.45 (stored per-version in metadata.json; overrides training default) |
| Zone counting | Bottom-center point `((x1+x2)/2, y2)` tested against Inbound/Outbound shapely polygons |
| Zone names | Fixed: **Inbound** and **Outbound** — stored in cam config, drawn via ZoneEditor |
| RWIS station | COTRIP `374` (Purgatory corridor) |
| RWIS partner cam | `952-N` fetches RWIS once per tick; other cams reuse |
| Agent provider | **AWS Bedrock** (not direct Anthropic API) |
| Agent model | `us.anthropic.claude-haiku-4-5-20251001-v1:0` (cross-region inference profile) |
| Agent monthly cap | 200 invocations (DynamoDB counter per `YYYY-MM`) |
| Tier 1 → 2 threshold | confidence < 0.85 escalates to image-assisted |
| Tier 3 propagation | last 3 same-cam records same high-conf decision → skip API |
| S3 lifecycle | raw/ → Glacier Instant Retrieval @ 180 days |
| Region | `us-east-1` |
| Cognito group | `admin` |
| Subdomain | `purg` (production: `purg.jtamerius.com`) |

## S3 Key Conventions

| Prefix | Contents |
|--------|----------|
| `raw/{cam_id}/{sk}.jpg` | Raw images from ingest |
| `labels/{cam_id}/{sk}.txt` | YOLO label files (class cx cy w h, normalized) |
| `models/shared/v{N}/model.pt` | Trained model weights |
| `models/shared/v{N}/metadata.json` | Version metadata — `active`, `inference`, `metrics` |
| `exports/all/{ts}.zip` | Training dataset exports (all cameras merged) |

## AWS Resources (per env)

| Resource | Name |
|----------|------|
| S3 raw bucket | `tools-purgatory-raw-{env}-606196119553` |
| DynamoDB: ingest records | `tools-purgatory-ingest-{env}` (GSI `byNeedsReview`) |
| DynamoDB: cam config | `tools-purgatory-cam-config-{env}` |
| DynamoDB: resort conditions | `tools-purgatory-resort-{env}` |
| DynamoDB: agent counter | `tools-purgatory-agent-counter-{env}` |
| ECR repo | `tools-purgatory-ingest-{env}` (managed by CI bootstrap, not CDK) |
| Lambda: ingest (container) | `tools-purgatory-ingest-{env}` (3GB, 60s, self-invoke fan-out) |
| Lambda: scrape | `tools-purgatory-scrape-{env}` (512MB, 60s) |
| Lambda: review API | `tools-purgatory-api-{env}` (512MB, 30s) |
| EventBridge: ingest schedule | `tools-purgatory-ingest-{env}` (rate 15 min) |
| EventBridge: scrape schedule | `tools-purgatory-scrape-{env}` (rate 15 min) |
| API Gateway HTTP v2 | `tools-purgatory-api-{env}` (Cognito JWT authorizer) |
| Amplify app (production) | `d1vk0hg4hd7cnv` — branch `main`, domain `purg.jtamerius.com` |
| CDK stack — backend | `tools-app-purgatory-{env}` |
| CDK stack — hosting | `tools-shared-amplify-purgatory-{env}` |

SSM parameters (all under `/tools/{env}/purgatory/`):
`api-url`, `raw-bucket`, `ingest-table`, `cam-config-table`, `resort-table`, `ingest-ecr-uri`

> **No `anthropic-api-key` SSM param** — the agent uses Bedrock (`bedrock:InvokeModel` IAM permission on the Lambda role).

## Cameras (cam_config_seed.json)

| cam_id | COTRIP | Highway | MP | View | Distance to resort | Drive time | Purpose |
|--------|--------|---------|----|----|--------------------|------------|---------|
| `952-N` | 952 | US-550 | 48.6 | N | 1.0 km | 2 min | Primary resort signal (inbound) — also fetches RWIS |
| `952-S` | 952 | US-550 | 48.6 | S | 1.0 km | 2 min | Outbound resort traffic |
| `957-N` | 957 | US-550 | 25.65 | N | 37 km | 23 min | Early-warning signal at Animas View Dr |
| `957-S` | 957 | US-550 | 25.65 | S | 37 km | 23 min | Southbound at Animas View |
| `1053-N` | 1053 | US-550 | 16.25 | N | 52 km | 33 min | Earliest-warning signal south of Durango |
| `3285-N` | 3285 | US-550 | — | N | — | — | Additional corridor cam |
| `3287-N` | 3287 | US-550 | — | N | — | — | Additional corridor cam |
| `3288-N` | 3288 | US-550 | — | N | — | — | Additional corridor cam |
| `3289-S` | 3289 | US-550 | — | S | — | — | Additional corridor cam |
| `3291-E` | 3291 | US-550 | — | E | — | — | Additional corridor cam |
| `954-RWIS` | 954 | US-550 | 20.95 | — | 44 km | 28 min | RWIS sensors only (no image), station 374 |

## Shared YOLO Model

One model trained on labeled images from all cameras. No per-camera models.

- **Current version**: v1 — mAP50 0.815, trained on 95 images (2026-05-17)
- **S3 location**: `models/shared/v1/model.pt`
- To retrain: see `/model-retrain-purgatory` skill

The ingest handler loads the active shared model at startup via `_resolve_model_key()`. Falls back to the baked-in `yolov8n.pt` if no active model is found in S3.

## First-Time Deploy (production playbook)

1. **Manually deploy the IAM stack**:
   ```bash
   cd infra/cdk && AWS_PROFILE=jtam npx cdk deploy tools-shared-iam-production -c env=production
   ```

2. **Push to `main`** → triggers `Deploy — Production` workflow (ECR bootstrap → CDK → Docker build → frontend)

3. **Seed the cam config table**:
   ```bash
   AWS_PROFILE=jtam python apps/purgatory/scripts/seed_cam_config.py production
   ```

4. **Enable Bedrock model access** in the AWS console (one-time): Console → Bedrock → Model access → enable `Claude Haiku 4.5` for `us-east-1`.

## Operational Runbook

### Re-seed cam config (after zone polygon updates)

```bash
AWS_PROFILE=jtam python apps/purgatory/scripts/seed_cam_config.py production
```

Idempotent. Bump `roi_version` in the seed JSON when zone polygons change so flagging.py re-evaluates.

### Manually trigger an ingest

```bash
# Fan-out — scans cam config, self-invokes per cam
AWS_PROFILE=jtam aws lambda invoke \
  --function-name tools-purgatory-ingest-production \
  --region us-east-1 --no-cli-pager /tmp/out.json && cat /tmp/out.json

# Single cam
AWS_PROFILE=jtam aws lambda invoke \
  --function-name tools-purgatory-ingest-production \
  --payload '{"cam_id":"952-N"}' --cli-binary-format raw-in-base64-out \
  --region us-east-1 --no-cli-pager /tmp/out.json && cat /tmp/out.json
```

### Inspect recent ingest logs

```bash
AWS_PROFILE=jtam aws logs tail /aws/lambda/tools-purgatory-ingest-production \
  --since 30m --follow --region us-east-1
```

### Check agent monthly cap usage

```bash
MONTH=$(date -u +%Y-%m)
AWS_PROFILE=jtam aws dynamodb get-item \
  --table-name tools-purgatory-agent-counter-production \
  --key '{"pk":{"S":"AGENT_COUNTER"},"sk":{"S":"'$MONTH'"}}' \
  --region us-east-1 --no-cli-pager
```

### Check active model version

```bash
AWS_PROFILE=jtam aws s3 ls \
  s3://tools-purgatory-raw-production-606196119553/models/shared/ --recursive
```

### Query records flagged for review

```bash
AWS_PROFILE=jtam aws dynamodb query \
  --table-name tools-purgatory-ingest-production \
  --index-name byNeedsReview \
  --key-condition-expression "needs_review_pk = :v" \
  --expression-attribute-values '{":v":{"S":"REVIEW"}}' \
  --region us-east-1 --no-cli-pager --max-items 5
```

## CI Pipeline

GitHub Actions paths-filter triggers (prod = `main`, staging = `staging`):

| Filter | Files | Job |
|--------|-------|-----|
| `infra-amplify-purgatory` | `amplify-stack.ts`, `amplify-hosting.ts`, `app.ts` | `deploy-amplify-purgatory-{env}` |
| `infra-purgatory` | `purgatory-stack.ts`, `ingest/src/**`, `scrape/src/**`, `api/**` | `deploy-purgatory-app-{env}` |
| `purgatory-ingest` | `ingest/Dockerfile`, `ingest/requirements.txt`, `ingest/src/**` | `build-push-purgatory-ingest-{env}` |
| `purgatory` | `frontend/**`, `shared/**` | `deploy-purgatory-frontend-{env}` |

## CDK Gotchas (history of deploy failures)

| Symptom | Root cause | Fix |
|---------|------------|-----|
| `Circular dependency: IngestFunctionLogRetention…` | `logRetention` creates custom-resource Lambda that tangles with EventBridge | Replaced with explicit `LogGroup` + `logGroup` prop |
| `Circular dependency: IngestFunctionServiceRoleDefaultPolicy…` | `ingestFn.grantInvoke(ingestFn)` embeds CFn token into role policy | Use `addToRolePolicy` with literal ARN string |
| `Circular dependency: IngestSchedule…` | `targets.LambdaFunction` calls `rule.node.addDependency` internally | Use `events.CfnRule` + `lambda.CfnPermission` with literal ARNs |
| `Source image … does not exist` on first deploy | CDK creates Lambda before ECR image exists | CI bootstrap pushes placeholder image before CDK runs |
| `ECR repo already exists` on re-deploy after rollback | CDK created ECR with `RemovalPolicy.RETAIN`; rollback skipped delete | Switched to `ecr.Repository.fromRepositoryName` |
| `ecr:InitiateLayerUpload denied` | GitHub Actions IAM role scoped only to solarhail ECR | Added `tools-purgatory-ingest-*` to ECRPushAndRead + account-scoped `ecr:CreateRepository` |

## Data Sources

| Source | Endpoint | Notes |
|--------|----------|-------|
| COTRIP cameras | `https://www.cotrip.org/api/graphql` (`MAP_FEATURES_QUERY`) | Returns `image_captured_at` with `?{ms}` cache-buster |
| COTRIP RWIS | `https://www.cotrip.org/api/graphql` (`WEATHER_STATION_QUERY`) | Station `374`; field map in `cotrip.py` |
| Image fetch | per-cam `image_url` from cam config | Direct HTTPS GET, no auth |
| Purgatory resort | `https://www.purgatoryresort.com` | Scraped via BeautifulSoup; selectors are placeholders pending live page audit |

## Open Work

- **Phase 1.1**: Resolve Purgatory scrape selectors against the live page. If client-rendered, swap to Playwright.
- **Phase 1.3**: Crowding prediction model — training data = `agent_decision = keep` records joined with same-day resort conditions.
- RWIS field-key audit — confirm `Air Temperature`, `Visibility`, etc. match live GraphQL response.
- Label more images across daytime/weather conditions to improve model generalization (currently 95 nighttime images only).
