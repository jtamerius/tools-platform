---
name: app-purgatory
description: Reference for the Purgatory Crowding Intelligence app — architecture, ingest pipeline, AWS resources, and operational runbook.
allowed-tools: Bash(aws *), Bash(python *)
---

# Purgatory Crowding Intelligence — Reference & Build Guide

## What It Is

Traffic-cam + RWIS ingestion pipeline for predicting crowd levels at Purgatory Resort (Durango, CO). Polls Colorado DOT (COTRIP) cameras along US-550 every 15 min, runs YOLOv8 vehicle detection on the images, and flags anomalous records for a Claude (Bedrock) QC agent. A Cognito-gated React review UI lets an admin keep/unusable/follow-up each flagged record.

Cognito-gated, **admin** group required. Production URL: `https://purg.jtamerius.com`.

## Phases

| Phase | Status | Description |
|-------|--------|-------------|
| **1.0** | In progress | Traffic-cam ingest — image fetch + YOLO + RWIS join + agent QC + review UI |
| **1.1** | In progress | Resort scrape — current conditions + forecast from purgatoryresort.com |
| 1.2 | Not started | ROI polygon annotation tool for per-cam vehicle counting zones |
| 1.3 | Not started | Crowding prediction model (training data = post-review records) |

## Architecture

```
EventBridge (rate 15 min) → IngestFunction (container Lambda, fan-out)
  ├─ scans CamConfig DDB → self-invokes per active cam_id
  └─ per-cam invocation:
       ├─ cotrip.py        fetch image_captured_at + RWIS (partner cam only)
       ├─ image fetch      HTTPS GET → S3 raw/{cam_id}/{ts}.jpg
       ├─ yolo_count.py    YOLOv8n inference; bottom-center point in ROI polygon
       ├─ image stats      Pillow brightness/variance/edge density
       ├─ pvlib solar      altitude/azimuth at lat/lon
       ├─ flagging.py      5 rules → needs_review boolean
       └─ agent.py         3-tier Bedrock decision (propagation → metadata → image)
                           Writes to IngestTable with agent_* fields

EventBridge (rate 15 min) → ScrapeFunction (Python zip Lambda)
  └─ BeautifulSoup scrape of purgatoryresort.com → ResortTable

API Gateway HTTP v2 (Cognito JWT, admin group) → ApiFunction (Python zip Lambda):
  GET  /api/queue          flagged records needing review (cursor-paginated)
  GET  /api/search         decision/source/visibility/confidence filters
  GET  /api/image          presigned S3 URL for a record's image (600s TTL)
  GET  /api/neighbors      same-timestamp records across other cams
  GET  /api/history        24h trace for a single cam
  POST /api/decisions      reviewer keep/unusable/follow_up

React + Plotly + Cognito → Amplify hosting (CI/CD deploy)
```

## Directory

```
apps/purgatory/
├── frontend/             React review UI (Cognito JWT-gated, admin group)
│   ├── src/
│   │   ├── App.jsx                       Cognito auth gate, sign-in form
│   │   ├── pages/ReviewPage.jsx          queue/search mode tabs
│   │   ├── components/
│   │   │   ├── RecordPanel.jsx           image + counts + RWIS + agent reasoning
│   │   │   ├── TrafficPlot.jsx           Plotly 24h scatter
│   │   │   ├── FilterBar.jsx             cam/date/decision/source/confidence/visibility
│   │   │   └── Nav.jsx                   shared platform nav
│   │   └── hooks/useReviewApi.js         fetchQueue/Search/Image/Neighbors/History/decide
│   └── vite.config.js
├── ingest/               Container Lambda — image fetch + YOLO + RWIS + agent QC
│   ├── Dockerfile        downloads yolov8n.pt at build (no binary in repo)
│   ├── requirements.txt  boto3, requests, Pillow, numpy, pvlib, shapely, ultralytics, torch
│   └── src/
│       ├── handler.py    fan-out + per-cam pipeline
│       ├── config.py     env vars, YOLO config, thresholds
│       ├── cotrip.py     GraphQL MAP_FEATURES_QUERY + WEATHER_STATION_QUERY (station 374)
│       ├── yolo_count.py YOLOv8n inference + ROI polygon containment
│       ├── flagging.py   5 rules: count-outlier, vis/edge disagreement, low YOLO conf, daily stratified, random
│       └── agent.py      Bedrock 3-tier (propagation → metadata → image) + DDB monthly cap
├── scrape/               Python zip Lambda — purgatoryresort.com scrape
│   └── src/handler.py    BeautifulSoup; writes RESORT#PURGATORY pk
├── api/                  Python zip Lambda — review UI backend
│   └── handler.py        6 routes, Cognito group check, DDB query/scan, S3 presign
└── scripts/
    ├── cam_config_seed.json     5 cam records (952-N, 952-S, 957-N, 1053-N, 954-RWIS)
    └── seed_cam_config.py       resolves table via SSM, batch writes records

infra/cdk/lib/stacks/purgatory-stack.ts   CDK stack (S3, DDB, ECR-referenced, Lambdas, API GW)
```

## Locked Decisions

| Decision | Value |
|----------|-------|
| Ingest cadence | EventBridge rate(15 minutes) |
| YOLO model | YOLOv8n (downloaded at Docker build, baked into image) |
| YOLO classes | car (2), motorcycle (3), bus (5), truck (7) |
| YOLO confidence | 0.25 |
| ROI containment | Bottom-center point `((x1+x2)/2, y2)` via shapely |
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
| `952-S` | 952 | US-550 | 48.6 | S | 1.0 km | 2 min | Outbound resort traffic — pair with 952-N for ratio |
| `957-N` | 957 | US-550 | 25.65 | N | 37 km | 23 min | Early-warning signal at Animas View Dr |
| `1053-N` | 1053 | US-550 | 16.25 | N | 52 km | 33 min | Earliest-warning signal south of Durango |
| `954-RWIS` | 954 | US-550 | 20.95 | — | 44 km | 28 min | RWIS sensors only (no image), station 374 |

## First-Time Deploy (production playbook)

The chicken-and-egg between ECR (needs image) and Lambda (needs image to exist) means the CI bootstrap step in the deploy workflow handles repo creation + placeholder image. The flow:

1. **Manually deploy the IAM stack** (it's the only stack not deployed via CI/CD):
   ```bash
   cd infra/cdk && AWS_PROFILE=jtam npx cdk deploy tools-shared-iam-production -c env=production
   ```
   Adds `tools-purgatory-ingest-*` to ECR push policy + `ecr:CreateRepository` account-scoped.

2. **Push to `main`** → triggers `Deploy — Production` workflow:
   - `deploy-amplify-purgatory-production` — creates the Amplify app (already done once → `d1vk0hg4hd7cnv`)
   - `deploy-purgatory-app-production` — bootstrap step creates ECR repo, sets lifecycle policy, pushes `public.ecr.aws/lambda/python:3.12` as placeholder, then CDK creates DDB/S3/Lambdas/API GW
   - `build-push-purgatory-ingest-production` — builds the real YOLO image, overwrites `:latest`
   - `deploy-purgatory-frontend-production` — reads `VITE_API_URL` from SSM, builds React app, deploys to Amplify

3. **Seed the cam config table** (cron does nothing until this is done):
   ```bash
   AWS_PROFILE=jtam python apps/purgatory/scripts/seed_cam_config.py production
   ```

4. **Enable Bedrock model access** in the AWS console (one-time, account-level):
   - Console → Bedrock → Model access → enable `Claude Haiku 4.5` for `us-east-1`.

Within 15 minutes the EventBridge rule fires, ingest fans out per cam, images land in S3, records land in DDB. Open `https://purg.jtamerius.com`, sign in as admin, review queue.

## Operational Runbook

### Re-seed cam config (e.g. after ROI polygon updates)

```bash
AWS_PROFILE=jtam python apps/purgatory/scripts/seed_cam_config.py production
```

Idempotent — `cam_id` is the partition key, so updates overwrite. Bump `roi_version` when polygon changes so flagging.py knows to re-evaluate.

### Manually trigger an ingest (skip the 15-min wait)

```bash
# Fan-out (no payload) — scans cam config, self-invokes per cam
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

### Spot-check raw images

```bash
AWS_PROFILE=jtam aws s3 ls s3://tools-purgatory-raw-production-606196119553/raw/952-N/ \
  --recursive --human-readable | tail -10
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

GitHub Actions paths-filter triggers (per env, prod = `main`, staging = `staging`):

| Filter | Files | Job |
|--------|-------|-----|
| `infra-amplify-purgatory` | `amplify-stack.ts`, `amplify-hosting.ts`, `app.ts` | `deploy-amplify-purgatory-{env}` |
| `infra-purgatory` | `purgatory-stack.ts`, `ingest/src/**`, `scrape/src/**`, `api/**` | `deploy-purgatory-app-{env}` |
| `purgatory-ingest` | `ingest/Dockerfile`, `ingest/requirements.txt`, `ingest/src/**` | `build-push-purgatory-ingest-{env}` |
| `purgatory` | `frontend/**`, `shared/**` | `deploy-purgatory-frontend-{env}` |

`deploy-purgatory-app-*` runs an ECR bootstrap step before CDK:

```
1. aws ecr create-repository (idempotent)
2. aws ecr put-lifecycle-policy (keep last 5 images)
3. if no `latest` tag exists, push public.ecr.aws/lambda/python:3.12 as placeholder
4. npx cdk deploy tools-app-purgatory-{env}
```

## CDK Gotchas (history of deploy failures)

These are baked into `purgatory-stack.ts` — don't undo them unless you've found a better way.

| Symptom | Root cause | Fix |
|---------|------------|-----|
| `Circular dependency: IngestFunctionLogRetention…` | `logRetention` on a Lambda creates a custom-resource Lambda that tangles with EventBridge permissions | Replaced with explicit `LogGroup` + `logGroup` prop on all three Lambdas |
| `Circular dependency: IngestFunctionServiceRoleDefaultPolicy…` (after fixing logRetention) | `ingestFn.grantInvoke(ingestFn)` embeds the function's own CFn token into its role policy | Use `addToRolePolicy` with a literal ARN string |
| `Circular dependency: IngestSchedule…` (after fixing self-invoke) | `targets.LambdaFunction` calls `rule.node.addDependency(fn.permissionsNode)` internally | Use `events.CfnRule` + `lambda.CfnPermission` with literal ARN strings (no `targets.LambdaFunction`) |
| `Source image … does not exist` on first deploy | CDK creates Lambda → tries to pull ECR image → image doesn't exist yet | CI bootstrap step pushes placeholder image before CDK runs |
| `ECR repo already exists` on re-deploy after rollback | CDK was creating ECR with `RemovalPolicy.RETAIN`; rollback skipped delete | Switched to `ecr.Repository.fromRepositoryName` — repo lifecycle now lives in CI bootstrap |
| `ecr:InitiateLayerUpload denied` | GitHub Actions IAM role had ECR perms only for solarhail repo | Added `tools-purgatory-ingest-*` to `ECRPushAndRead` policy + `ecr:CreateRepository` account-scoped |

## Data Sources

| Source | Endpoint | Notes |
|--------|----------|-------|
| COTRIP cameras | `https://www.cotrip.org/api/graphql` (`MAP_FEATURES_QUERY`) | Returns `image_captured_at` with `?{ms}` cache-buster suffix |
| COTRIP RWIS | `https://www.cotrip.org/api/graphql` (`WEATHER_STATION_QUERY`) | Station `374`; field map in `cotrip.py` (Air Temperature, Visibility, Wind, …) |
| Image fetch | per-cam `image_url` from cam config | Direct HTTPS GET, no auth |
| Purgatory resort | `https://www.purgatoryresort.com` | Scraped via BeautifulSoup; selectors are still placeholders pending live page audit |

## Open Work

- **Phase 1.1 step 1**: Resolve Purgatory scrape selectors against the live page. If the page turns out to be client-rendered, swap to Playwright on Lambda (or move scrape to a small EC2/Fargate task).
- **Phase 1.2**: ROI polygon annotation tool — draw polygons on sample frames per cam, write to `cam_config_table`, bump `roi_version`.
- **Phase 1.3**: Crowding prediction model. Training data = `agent_decision = keep` records joined with same-day resort conditions.
- RWIS field-key audit — confirm `Air Temperature`, `Visibility`, etc. match what the first GraphQL response actually returns.
- Replace placeholder COTRIP scrape selectors once a real page response is captured.
