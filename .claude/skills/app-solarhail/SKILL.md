---
name: app-solarhail
description: Reference for the SolarHail app — architecture, pipeline modules, AWS resources, phase status, and operational runbook.
allowed-tools: Bash(aws *), Bash(python *)
---

# SolarHail — Reference & Build Guide

## What It Is

Historical hail risk dashboard for 34 U.S. metros spanning hail alley and the midwest (ND to Louisiana, CO to Ohio). Users select a metro and time window to see H3-hex hail exposure with estimated solar system counts exposed. Toggles between hail intensity view and solar density overlay.

Portfolio piece — historical data only, no live ingestion. Backfill window: **2026-02-02 to 2026-05-01**.

## Architecture

```
NOAA noaa-mrms-pds (public S3, us-east-1)
  └─ MRMS MESH_Max_30min GRIB2 (streamed, never stored locally)
       └─ pipeline/src/ (Modules 1–5)
            ├─ mrms_reader.py       → hail pixels per metro bbox
            ├─ h3_snapper.py        → H3 res-8 cells, max MESH per cell
            ├─ overture_fetcher.py  → building counts per cell (DuckDB → Overture S3)
            ├─ deepsolar_joiner.py  → block-group solar disaggregated to cells
            ├─ impact_calculator.py → final enriched output (solar_systems_exposed)
            └─ data_downloader.py   → fetches DeepSolar CSV + TIGER BG shapefile

JSON.gz → s3://tools-solarhail-production-606196119553/parquet/hail-events/event_date=YYYY-MM-DD/{metro_id}.json.gz
Solar basemap → s3://tools-solarhail-production-606196119553/solar/{metro_id}.json.gz
Glue catalog → solarhail_production.hail_events (partition projection on event_date)
Athena workgroup → solarhail-wg-production
API Gateway HTTP v2 + Lambda → GET /api/events, /api/summary, /api/solar
React + Deck.gl + Mapbox → Amplify (CI/CD deploy)
```

## Directory

```
apps/solarhail/
├── pipeline/
│   ├── requirements.txt
│   ├── Dockerfile
│   ├── src/
│   │   ├── config.py            metro bboxes (34), thresholds, URLs, S3/Athena config
│   │   ├── data_downloader.py   fetches DeepSolar CSV + TIGER BG shapefile
│   │   ├── mrms_reader.py       Module 1
│   │   ├── h3_snapper.py        Module 2
│   │   ├── overture_fetcher.py  Module 3
│   │   ├── deepsolar_joiner.py  Module 4
│   │   ├── impact_calculator.py Module 5
│   │   └── main.py              CLI/Batch entrypoint (with S3 checkpoint/resume)
│   ├── tests/                   pytest suite (fast unit + slow integration)
│   └── scripts/
│       └── submit_backfill.py   submit one Batch job per metro
├── api/
│   └── handler.py               Lambda handler — /api/events, /api/summary, /api/solar
└── frontend/
    ├── src/
    │   ├── App.jsx              Root layout — desktop sidebar + mobile bottom sheet
    │   ├── App.module.css       Responsive layout (768px breakpoint)
    │   ├── config/metros.js     34 metro list with lat/lon
    │   ├── hooks/               useHailData, useSolarData, useMetroSummary
    │   └── components/          HailMap, MetroSelector, DateRangeSlider, StatsPanel, Legend
    ├── vite.config.js
    └── package.json
infra/cdk/lib/stacks/solarhail-stack.ts   CDK stack (S3, Glue, Athena, ECR, Batch, Lambda, API GW)
```

## Locked Decisions

| Decision | Value |
|----------|-------|
| H3 resolution | 8 (~0.7 km²) |
| MRMS product | `MESH_Max_30min` (rolling max) |
| MRMS bucket | `noaa-mrms-pds` (public, `us-east-1`) |
| Stream-and-discard | GRIB2 never written to local S3 |
| GRIB library | pygrib |
| Building classes | `residential`, `commercial` |
| Building footprint filter | 50–10,000 sq ft (4.6–929 sq m) |
| Overture release | `2026-04-15.0` (update every ~6 weeks when releases rotate) |
| Solar data | DeepSolar-3M block-group level (rajanieprabha/DeepSolar-3M, GitHub) |
| Solar disaggregation | Proportional to building count per cell within census block group |
| Census BG shapefile | TIGER 2023 national, 500k scale (~97 MB) |
| Impact metric | `solar_systems_exposed` — inner join of hail cells × solar cells, no damage probability |
| Backfill window | 2026-02-02 to 2026-05-01 |
| Output format | JSON.gz (newline-delimited JSON), S3 prefix `parquet/hail-events/` |
| Basemap | Mapbox `satellite-streets-v12` — token in SSM `/tools/production/solarhail/mapbox` |
| Region | `us-east-1` |

## AWS Resources (Production)

| Resource | Name |
|----------|------|
| S3 bucket | `tools-solarhail-production-606196119553` |
| Glue database | `solarhail_production` |
| Glue table | `hail_events` (partition projection on `event_date`) |
| Athena workgroup | `solarhail-wg-production` |
| ECR repo | `tools-solarhail-pipeline-production` |
| Batch compute env | `tools-solarhail-fargate-production` (Fargate Spot, public subnets, max 128 vCPU) |
| Batch job queue | `tools-solarhail-queue-production` |
| Batch job definition | `tools-solarhail-pipeline-production` (retryAttempts: 3, Spot retry strategy) |
| Batch exec role | `tools-solarhail-batch-exec-production` |
| Batch job role | `tools-solarhail-pipeline-production` |
| Lambda function | `tools-solarhail-api-production` |
| API Gateway | HTTP v2 — `GET /api/events`, `GET /api/summary`, `GET /api/solar` |
| CDK stack | `tools-app-solarhail-production` |
| CloudWatch log group | `tools-app-solarhail-production-ContainerDefLogGroup2ABC7679-Y9WKfuoJend1` |

SSM parameters (all under `/tools/production/solarhail/`):
`s3-bucket`, `glue-database`, `athena-workgroup`, `batch-job-queue`, `batch-job-definition`, `ecr-repo-uri`, `api-url`, `mapbox`

## Metros (34 total)

### Core Hail Alley
`dfw`, `houston`, `san_antonio`, `austin`, `lubbock`, `amarillo`, `okc`, `tulsa`, `wichita`, `kc`, `omaha`, `lincoln`, `denver`, `colorado_springs`, `sioux_falls`, `fargo`, `minneapolis`

### Midwest
`st_louis`, `des_moines`, `chicago`, `indianapolis`, `columbus`, `cincinnati`, `cleveland`, `dayton`, `louisville`, `nashville`, `memphis`, `little_rock`, `shreveport`, `new_orleans`, `baton_rouge`, `jackson_ms`, `birmingham`

## Build Phase Status

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Local pipeline (Modules 1–5) | **Complete** — 46 fast + 8 slow integration tests |
| 2 | S3 + Glue + Athena (CDK) | **Complete** — deployed to production |
| 3 | ECR + Batch backfill (CDK) | **Complete** — backfill running; ~22/34 metros done |
| 4 | API (Lambda + API Gateway HTTP v2) | **Complete** — deployed to production |
| 5 | Frontend (React + Deck.gl + Mapbox) | **Complete** — deployed via Amplify, mobile-responsive |

## Operational Runbook

### Submit backfill jobs

```bash
cd apps/solarhail/pipeline

# Single metro
AWS_PROFILE=jtam python scripts/submit_backfill.py --env production --metros okc

# Subset
AWS_PROFILE=jtam python scripts/submit_backfill.py --env production --metros dfw houston chicago

# All 34 metros
AWS_PROFILE=jtam python scripts/submit_backfill.py --env production

# Dry run
AWS_PROFILE=jtam python scripts/submit_backfill.py --env production --dry-run
```

Default date range: `2026-02-02` → `2026-05-01`. Jobs checkpoint to S3 (`checkpoints/{metro_id}.json`) after each date — Spot interruptions auto-resume on retry.

### Check Batch job status

```bash
# List running
AWS_PROFILE=jtam aws batch list-jobs \
  --job-queue tools-solarhail-queue-production \
  --job-status RUNNING \
  --region us-east-1 --no-cli-pager

# List succeeded
AWS_PROFILE=jtam aws batch list-jobs \
  --job-queue tools-solarhail-queue-production \
  --job-status SUCCEEDED \
  --query "jobSummaryList[].jobName" --output text \
  --region us-east-1 --no-cli-pager

# Describe specific job
AWS_PROFILE=jtam aws batch describe-jobs \
  --jobs <job-id> \
  --region us-east-1 \
  --query 'jobs[0].{status:status,statusReason:statusReason}' \
  --no-cli-pager
```

### Check S3 output

```bash
# Which metros have hail event data
AWS_PROFILE=jtam aws s3 ls s3://tools-solarhail-production-606196119553/parquet/hail-events/ \
  --recursive | awk '{print $4}' | sed 's|.*event_date=[^/]*/||; s|\.json\.gz||' | sort -u

# Which metros have solar basemaps (written at job start — indicates job began)
AWS_PROFILE=jtam aws s3 ls s3://tools-solarhail-production-606196119553/solar/

# Active checkpoint files (metros currently in-progress or interrupted)
AWS_PROFILE=jtam aws s3 ls s3://tools-solarhail-production-606196119553/checkpoints/
```

### Terminate a running Batch job

```bash
AWS_PROFILE=jtam aws batch terminate-job \
  --job-id <job-id> \
  --reason "reason text" \
  --region us-east-1
```

### View CloudWatch logs

```bash
AWS_PROFILE=jtam aws logs filter-log-events \
  --log-group-name "tools-app-solarhail-production-ContainerDefLogGroup2ABC7679-Y9WKfuoJend1" \
  --log-stream-names "<stream-from-describe-jobs>" \
  --filter-pattern "?ERROR ?Traceback ?Exception" \
  --region us-east-1 --no-cli-pager \
  --query 'events[*].message' --output text
```

### Overture Maps release rotation

Overture publishes new releases every ~6 weeks and removes old ones. Check available:

```bash
AWS_PROFILE=jtam aws s3 ls s3://overturemaps-us-west-2/release/ --region us-west-2 --no-cli-pager
```

Update `OVERTURE_RELEASE` in `apps/solarhail/pipeline/src/config.py` and push. CI runs `test_fetch_buildings_okc_live` (slow integration test) before building the Docker image — a stale release fails the test and blocks the push.

### CI pipeline

- `test-solarhail-pipeline-production` — runs all pytest tests on every `apps/solarhail/pipeline/src/**` change
- `build-push-solarhail-pipeline-production` — runs if tests pass; tags Docker image with commit SHA + `latest`
- Frontend deploy — runs on `apps/solarhail/frontend/**` changes; fetches `VITE_MAPBOX_TOKEN` from SSM at build time

## Data Sources

| Source | Location | Notes |
|--------|----------|-------|
| MRMS MESH_Max_30min | `s3://noaa-mrms-pds/CONUS/MESH_Max_30min/` (public) | ~2-min cadence GRIB2, streamed |
| Overture buildings | `s3://overturemaps-us-west-2/release/2026-04-15.0/` (public) | DuckDB httpfs query, no download |
| DeepSolar-3M | GitHub raw CSV (~2 MB) | Auto-downloaded to `pipeline/data/` |
| Census TIGER BG | census.gov zip (~97 MB) | Auto-downloaded + extracted to `pipeline/data/` |

## Cost Notes

- NOAA MRMS: free (same-region S3 reads)
- Overture S3: ~$0.09/GB (us-west-2→us-east-1 egress; small per metro)
- Batch backfill (34 metros): ~$2–5 one-time
- Athena + S3 ongoing: <$1/month
- Amplify + CloudFront: free tier for portfolio traffic
