---
name: app-solarhail
description: Reference for the SolarHail app — architecture, pipeline modules, AWS resources, and operational runbook.
allowed-tools: Bash(aws *), Bash(python *)
---

# SolarHail — Reference & Build Guide

## What It Is

CONUS-scale historical hail risk dashboard showing H3-hex hail exposure for residential and utility-scale solar across the continental US. Users pan/zoom the map freely; stats update live for the visible viewport. Two tabs: **Commercial** (USPVDB utility-scale facilities) and **Home Solar** (DeepSolar residential estimates).

Portfolio piece — historical data only, no live ingestion. Backfill window: **2026-02-02 to 2026-05-09**.

## Architecture

```
NOAA noaa-mrms-pds (public S3, us-east-1)
  └─ MRMS MESH_Max_30min GRIB2 (streamed, never stored locally)
       └─ pipeline/scripts/run_conus_day.py   nightly Batch job
            ├─ mrms_reader.py       → hail pixels CONUS-wide
            ├─ h3_snapper.py        → H3 res-8 cells, max MESH per cell
            ├─ overture_fetcher.py  → load_precomputed_buildings()
            ├─ deepsolar_joiner.py  → solar_systems_exposed per cell
            └─ impact_calculator.py → join residential + commercial exposure

Per-day output:
  s3://.../parquet/hail-events/event_date=YYYY-MM-DD/conus.json.gz
  s3://.../parquet/hail-events/event_date=YYYY-MM-DD/conus_state_agg.json

Static precomputed data:
  s3://.../commercial-solar/uspvdb_facilities.json    (6611 USPVDB facilities, ~1.2 MB)
  s3://.../lookups/h3_to_state.parquet                (H3 res-8 → state mapping)
  s3://.../commercial-solar/uspvdb_h3_aggregated.parquet

API Gateway HTTP v2 + Lambda:
  GET /api/conus?start=&end=                   → merged hail events (weekly chunks)
  GET /api/conus/state-summary?start=&end=     → per-state severity aggregation
  GET /api/facilities                          → static USPVDB facilities JSON

React + Deck.gl + Mapbox → Amplify (CI/CD deploy)
  - H3HexagonLayer colored by hail intensity or solar exposure
  - ScatterplotLayer for commercial facility dots (capacity-scaled, amber)
  - Viewport-filtered live stats; no metro selector
```

## Directory

```
apps/solarhail/
├── pipeline/
│   ├── requirements.txt
│   ├── Dockerfile
│   ├── src/
│   │   ├── config.py              S3 bucket, prefixes, MRMS config, thresholds
│   │   ├── data_downloader.py     fetches DeepSolar CSV + TIGER BG shapefile
│   │   ├── mrms_reader.py         GRIB2 decode → hail pixels
│   │   ├── h3_snapper.py          pixels → H3 res-8 cells
│   │   ├── overture_fetcher.py    building counts (precomputed or live Overture)
│   │   ├── deepsolar_joiner.py    block-group solar → per-cell disaggregation
│   │   └── impact_calculator.py   final enriched output (residential + commercial)
│   ├── scripts/
│   │   ├── run_conus_day.py        nightly Batch entrypoint — processes one date CONUS-wide
│   │   ├── submit_backfill.py      submit Batch jobs for a date range
│   │   ├── precompute_buildings.py one-time: build conus_h3_building_counts.parquet
│   │   ├── precompute_uspvdb.py    one-time: snap USPVDB facilities to H3
│   │   ├── precompute_h3_state.py  one-time: build h3_to_state.parquet
│   │   ├── build_facilities_json.py  manual utility: convert USPVDB parquet → facilities JSON for API
│   │   └── patch_commercial_column.py  manual utility: backfill commercial_capacity_mwdc into existing conus.json.gz files
│   └── tests/                     pytest suite (fast unit + slow integration)
├── api/
│   └── handler.py                 Lambda handler — /api/conus, /api/conus/state-summary, /api/facilities
└── frontend/
    ├── src/
    │   ├── App.jsx                Root layout — sidebar + map
    │   ├── config/metros.js       BACKFILL_START / BACKFILL_END constants
    │   ├── hooks/
    │   │   ├── useHailData.js     fetches weekly chunks, accumulates, date-filters
    │   │   └── useCommercialFacilities.js  loads facilities JSON once, returns Map<h3_index → facilities>
    │   └── components/
    │       ├── HailMap.jsx        deck.gl map: H3HexagonLayer + ScatterplotLayer
    │       ├── StatsPanel.jsx     Home/Commercial tab stats + facility table
    │       ├── DateRangeSlider.jsx
    │       └── Legend.jsx
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
| Solar data (residential) | DeepSolar-3M block-group level |
| Solar disaggregation | Proportional to building count per cell within census block group |
| Solar data (commercial) | USPVDB (USGS utility-scale) — 6611 facilities, snapped to H3 res-8 |
| Census BG shapefile | TIGER 2023 national, 500k scale (~97 MB) |
| MESH thresholds | Moderate ≥25mm, Significant ≥38mm, Severe ≥50mm |
| Output format | NDJSON.gz, S3 prefix `parquet/hail-events/` |
| Basemap | Mapbox `satellite-streets-v12` — token in SSM `/tools/production/solarhail/mapbox` |
| Region | `us-east-1` |
| Frontend chunk size | Weekly (stays under API Gateway 6MB response limit) |

## AWS Resources (Production)

| Resource | Name |
|----------|------|
| S3 bucket | `tools-solarhail-production-606196119553` |
| Glue database | `solarhail_production` |
| Glue table | `hail_events` (partition projection on `event_date`) |
| Athena workgroup | `solarhail-wg-production` |
| ECR repo | `tools-solarhail-pipeline-production` |
| Batch compute env | `tools-solarhail-fargate-production` (Fargate Spot, max 128 vCPU) |
| Batch job queue | `tools-solarhail-queue-production` |
| Batch job definition | `tools-solarhail-pipeline-production` |
| Lambda function | `tools-solarhail-api-production` |
| API Gateway | HTTP v2 — `/api/conus`, `/api/conus/state-summary`, `/api/facilities` |
| CDK stack | `tools-app-solarhail-production` |

SSM parameters (all under `/tools/production/solarhail/`):
`s3-bucket`, `glue-database`, `athena-workgroup`, `batch-job-queue`, `batch-job-definition`, `ecr-repo-uri`, `api-url`, `mapbox`

## Operational Runbook

### Run a single day manually (local test)

```bash
cd apps/solarhail/pipeline
AWS_PROFILE=jtam python scripts/run_conus_day.py --date 2026-04-15
# Output → s3://tools-solarhail-staging-606196119553/parquet/hail-events/event_date=2026-04-15/conus.json.gz
```

### Submit Batch backfill for a date range

```bash
cd apps/solarhail/pipeline
AWS_PROFILE=jtam python scripts/submit_backfill.py --env production --start 2026-04-01 --end 2026-04-30
AWS_PROFILE=jtam python scripts/submit_backfill.py --env production --dry-run  # preview only
```

### Check S3 output

```bash
# List all dates with CONUS hail data
AWS_PROFILE=jtam aws s3 ls s3://tools-solarhail-production-606196119553/parquet/hail-events/ \
  --recursive | grep conus.json.gz | awk '{print $4}'

# Spot-check a specific date
AWS_PROFILE=jtam aws s3 cp \
  s3://tools-solarhail-production-606196119553/parquet/hail-events/event_date=2026-04-15/conus.json.gz \
  - | gunzip | head -5
```

### Check Batch job status

```bash
AWS_PROFILE=jtam aws batch list-jobs \
  --job-queue tools-solarhail-queue-production \
  --job-status RUNNING \
  --region us-east-1 --no-cli-pager
```

### Rebuild facilities JSON (if USPVDB data changes)

`build_facilities_json.py` is a **manual one-time utility** — not part of the nightly pipeline.

```bash
cd apps/solarhail/pipeline
SOLARHAIL_ENV=production AWS_PROFILE=jtam python scripts/build_facilities_json.py
# Uploads → s3://.../commercial-solar/uspvdb_facilities.json
```

### Overture Maps release rotation

Overture publishes new releases every ~6 weeks and removes old ones. Check available:

```bash
AWS_PROFILE=jtam aws s3 ls s3://overturemaps-us-west-2/release/ --region us-west-2 --no-cli-pager
```

Update `OVERTURE_RELEASE` in `apps/solarhail/pipeline/src/config.py` and push.

### CI pipeline

- `test-solarhail-pipeline-*` — runs pytest on `src/**`, `scripts/**`, `tests/**` changes
- `build-push-solarhail-pipeline-*` — builds Docker image if tests pass; tags with commit SHA + `latest`
- Frontend deploy — runs on `frontend/**` changes; fetches `VITE_MAPBOX_TOKEN` from SSM at build time

## Data Sources

| Source | Location | Notes |
|--------|----------|-------|
| MRMS MESH_Max_30min | `s3://noaa-mrms-pds/CONUS/MESH_Max_30min/` (public) | ~2-min cadence GRIB2, streamed |
| Overture buildings | `s3://overturemaps-us-west-2/release/2026-04-15.0/` (public) | Precomputed to `conus_h3_building_counts.parquet` |
| DeepSolar-3M | GitHub raw CSV (~2 MB) | Auto-downloaded to `pipeline/data/` |
| Census TIGER BG | census.gov zip (~97 MB) | Auto-downloaded + extracted to `pipeline/data/` |
| USPVDB | USGS utility-scale solar (~4k facilities) | Precomputed to S3; `build_facilities_json.py` builds API-facing JSON |
