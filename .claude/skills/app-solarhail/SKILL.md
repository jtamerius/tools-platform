---
name: app-solarhail
description: Reference for the SolarHail-AI app — architecture, pipeline modules, AWS resources, open questions, and build phase status.
allowed-tools: Bash(aws *), Bash(python *)
---

# SolarHail-AI — Reference & Build Guide

## What It Is

Historical hail risk dashboard for 34 U.S. metros spanning hail alley and the midwest (ND to Louisiana, CO to Ohio). Users select a metro and time window to visualize aggregated hail exposure with estimated solar system impact, using H3 hex indexing.

Portfolio piece — historical data only, no live ingestion. Backfill window: 2026-02-02 to 2026-05-01.

## Architecture

```
IEM warning archive (public HTTP) ─────────────────────────────────┐
  iem_prefilter.py                                                   │
    Annual: mesonet.agron.iastate.edu/pickup/wwa/YYYY_tsmf_sbw.zip  │
    Current year: watchwarn.py API                                   │
    → warning_index_{start}_{end}.json (cached)                     │
    → per-metro set of dates with SVR/TOR polygon ─ 80-90% skip ───┘
                                                         ↓ pass
NOAA noaa-mrms-pds (public S3, us-east-1)
  └─ MRMS MESH_Max_30min GRIB2 files (streamed, never copied to local S3)
       └─ pipeline/src/ (Modules 1–5)
            ├─ mrms_reader.py      → hail pixels per metro bbox
            ├─ h3_snapper.py       → H3 res-8 cells, max MESH per cell
            ├─ overture_fetcher.py → building counts per cell (DuckDB → Overture S3)
            ├─ deepsolar_joiner.py → block-group solar disaggregated to cells
            ├─ impact_calculator.py→ final enriched Parquet
            └─ data_downloader.py  → fetches DeepSolar CSV + TIGER BG shapefile

Parquet → s3://{S3_BUCKET}/parquet/hail-events/year=YYYY/month=MM/day=DD/
Athena (solarhail-wg) → metro_risk view
API Gateway + Lambda → GET /metrics
React + Deck.gl + MapLibre → S3+CloudFront
```

## Directory

```
apps/solarhail/
├── pipeline/
│   ├── requirements.txt
│   ├── Dockerfile
│   └── src/
│       ├── config.py            metro bboxes (34 metros), thresholds, URLs
│       ├── data_downloader.py   fetches DeepSolar CSV + TIGER BG shapefile
│       ├── iem_prefilter.py     NWS warning index — 80-90% GRIB decode reduction
│       ├── mrms_reader.py       Module 1
│       ├── h3_snapper.py        Module 2
│       ├── overture_fetcher.py  Module 3
│       ├── deepsolar_joiner.py  Module 4
│       ├── impact_calculator.py Module 5
│       └── main.py              CLI/Batch entrypoint
├── api/                         (Phase 4 — not built yet)
├── frontend/                    (Phase 5 — not built yet)
└── infra/                       (Phase 2+ — not built yet)
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
| Solar data | DeepSolar-3M block-group level (rajanieprabha/DeepSolar-3M, GitHub) |
| Solar disaggregation | Proportional to building count per cell within census block group |
| H3-to-BG assignment | H3 cell centroid → block group (point-in-polygon) |
| Census BG shapefile | TIGER 2023 national, 500k scale (cb_2023_us_bg_500k.zip, ~97 MB) |
| Backfill window | 2026-02-02 to 2026-05-01 (3 months) |
| Region | `us-east-1` |
| Frontend | React + Deck.gl + MapLibre GL JS, S3+CloudFront |
| Auth | None — public site |
| MESH thresholds | 20 / 25 / 40 mm (configurable in config.py) |

## Damage Probability (piecewise)

| MESH range | Probability |
|------------|-------------|
| < 25 mm    | 0.10 |
| 25–40 mm   | 0.40 |
| 40–60 mm   | 0.70 |
| 60+ mm     | 0.95 |

## Metros (34 total)

### Core Hail Alley
| ID | Name | Bbox (lat_min, lat_max, lon_min, lon_max) |
|----|------|------------------------------------------|
| `dfw` | Dallas–Fort Worth, TX | 32.40, 33.60, -97.90, -96.30 |
| `houston` | Houston, TX | 29.30, 30.30, -95.90, -94.80 |
| `san_antonio` | San Antonio, TX | 29.10, 29.85, -98.80, -98.00 |
| `austin` | Austin, TX | 29.90, 30.65, -97.95, -97.30 |
| `lubbock` | Lubbock, TX | 33.40, 33.80, -102.10, -101.60 |
| `amarillo` | Amarillo, TX | 34.90, 35.40, -102.20, -101.50 |
| `okc` | Oklahoma City, OK | 35.20, 35.80, -97.80, -97.00 |
| `tulsa` | Tulsa, OK | 35.90, 36.40, -96.20, -95.60 |
| `wichita` | Wichita, KS | 37.50, 38.00, -97.60, -97.10 |
| `kc` | Kansas City, MO/KS | 38.70, 39.40, -94.90, -94.20 |
| `omaha` | Omaha, NE/IA | 41.10, 41.55, -96.30, -95.70 |
| `lincoln` | Lincoln, NE | 40.70, 40.95, -96.90, -96.50 |
| `denver` | Denver, CO | 39.40, 40.10, -105.30, -104.50 |
| `colorado_springs` | Colorado Springs, CO | 38.60, 39.00, -104.90, -104.50 |
| `sioux_falls` | Sioux Falls, SD | 43.40, 43.65, -97.00, -96.60 |
| `fargo` | Fargo, ND/MN | 46.70, 47.00, -97.10, -96.60 |
| `minneapolis` | Minneapolis–St. Paul, MN | 44.70, 45.10, -93.60, -92.80 |

### Midwest
| ID | Name | Bbox (lat_min, lat_max, lon_min, lon_max) |
|----|------|------------------------------------------|
| `st_louis` | St. Louis, MO/IL | 38.40, 38.85, -90.55, -90.00 |
| `des_moines` | Des Moines, IA | 41.40, 41.80, -93.80, -93.40 |
| `chicago` | Chicago, IL | 41.60, 42.10, -88.20, -87.40 |
| `indianapolis` | Indianapolis, IN | 39.60, 40.05, -86.40, -85.90 |
| `columbus` | Columbus, OH | 39.80, 40.20, -83.30, -82.70 |
| `cincinnati` | Cincinnati, OH/KY | 38.95, 39.30, -84.80, -84.20 |
| `cleveland` | Cleveland, OH | 41.30, 41.70, -81.90, -81.50 |
| `dayton` | Dayton, OH | 39.60, 39.90, -84.30, -83.90 |
| `louisville` | Louisville, KY/IN | 37.95, 38.40, -85.95, -85.40 |
| `nashville` | Nashville, TN | 35.90, 36.40, -87.10, -86.50 |
| `memphis` | Memphis, TN/AR/MS | 34.95, 35.35, -90.30, -89.70 |
| `little_rock` | Little Rock, AR | 34.50, 34.90, -92.60, -92.10 |
| `shreveport` | Shreveport, LA/TX | 32.30, 32.65, -94.10, -93.60 |
| `new_orleans` | New Orleans, LA | 29.80, 30.20, -90.40, -89.60 |
| `baton_rouge` | Baton Rouge, LA | 30.30, 30.65, -91.30, -90.90 |
| `jackson_ms` | Jackson, MS | 32.10, 32.50, -90.35, -89.90 |
| `birmingham` | Birmingham, AL | 33.30, 33.70, -87.00, -86.50 |

## Open Questions

### Remaining blockers (answer before Phase 2)
- [ ] **S3 bucket name** — must be globally unique; default `solarhail-analytics-jt` (change initials as needed)
- [ ] **Verify MRMS S3 key path** — easiest to confirm empirically: `aws s3 ls s3://noaa-mrms-pds/CONUS/MESH_Max_30min/ --no-sign-request`

### Phase 1 — no blockers, ready to run
All data sources download automatically on first run (DeepSolar CSV + TIGER BG shapefile).

### Phase 2 (Athena / S3)
- [ ] **Athena workgroup name** — default `solarhail-wg`; confirm or change

### Phase 3 (Batch backfill)
- [ ] **Fargate Spot vs EC2** — suggested Fargate Spot
- [ ] **Memory per task** — start at 4 GB, adjust if pygrib OOMs

### Phase 4 (API)
- [ ] **CloudFront cache TTL ladder** — ≤24h: 5min, 1–30d: 15min, 30–90d: 1hr; confirm

### Phase 5 (Frontend)
- [ ] **Map base style** — light (suggested)
- [ ] **Color ramp** — yellow→red (suggested)
- [ ] **Mobile layout** — collapse sidebar to bottom sheet?
- [ ] **Custom domain** — default CloudFront URL for v1

## AWS Resources (TBD — fill in after each phase)

| Resource | Name / ID |
|----------|-----------|
| S3 bucket | `solarhail-analytics-jt` (TBD — confirm) |
| Athena workgroup | `solarhail-wg` (TBD) |
| Athena database | `solarhail` (TBD) |
| Batch compute env | TBD |
| API Lambda | TBD |
| API Gateway | TBD |
| CloudFront (frontend) | TBD |
| CloudFront (API) | TBD |

## Build Phase Status

| Phase | Modules | Status |
|-------|---------|--------|
| 1 — Local pipeline | 1–5 | 🔨 In progress |
| 2 — S3 + Athena | 8 | Not started |
| 3 — Batch backfill | 11 | Not started |
| 4 — API | 12 | Not started |
| 5 — Frontend | 13 | Not started |
| 6 — Polish | 14 | Not started |

## Phase 1 — Running the Pipeline Locally

### Setup

```bash
cd apps/solarhail/pipeline
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

### Run one metro-day (data downloads automatically on first run)

```bash
# DeepSolar CSV (~1 MB) and Census TIGER BG shapefile (~97 MB) download to pipeline/data/
python -m src.main --metro dfw --date 2026-03-15 --out /tmp/solarhail_output
```

### Run full backfill for one metro

```bash
python -m src.main \
  --metro dfw \
  --start-date 2026-02-02 \
  --end-date 2026-05-01 \
  --out /tmp/solarhail_output
```

### Verify MRMS key path (do this first)

```bash
# Browse the public bucket — no AWS credentials needed
aws s3 ls s3://noaa-mrms-pds/CONUS/MESH_Max_30min/ --no-sign-request
# Expected: subdirs like 00.50/ containing MRMS_MESH_Max_30min_00.50_YYYYMMDD-HHMMSS.grib2.gz
```

### Verify output Parquet

```python
import pandas as pd
df = pd.read_parquet('/tmp/solarhail_output/dfw_20260315.parquet')
print(df.dtypes)
print(df.head())
print(f"Cells: {len(df)}, Max MESH: {df.max_mesh_mm.max():.1f} mm")
```

### Visualize H3 cells (quick sanity check)

```python
import h3, folium, pandas as pd

df = pd.read_parquet('/tmp/solarhail_output/dfw_20260315.parquet')
m = folium.Map(location=[33.0, -97.1], zoom_start=9)
for _, row in df.iterrows():
    boundary = h3.h3_to_geo_boundary(row['h3_index'], geo_json=True)
    folium.Polygon(
        locations=[(lat, lon) for lon, lat in boundary],
        fill=True, fill_opacity=min(row['max_mesh_mm'] / 80, 1.0),
        color='red', weight=1
    ).add_to(m)
m.save('/tmp/dfw_hail.html')
```

## Data Sources

| Source | URL | Notes |
|--------|-----|-------|
| MRMS MESH_Max_30min | `s3://noaa-mrms-pds/CONUS/MESH_Max_30min/` (public) | ~2-min cadence GRIB2, streamed directly |
| Overture buildings | `s3://overturemaps-us-west-2/` (public) | Queried via DuckDB, release `2024-09-18.0` |
| DeepSolar-3M | [GitHub](https://github.com/rajanieprabha/DeepSolar-3M/blob/main/dataset/blockgroup_level_data.csv) | Block-group level, ~2018–2021 vintage, auto-downloaded |
| Census TIGER BG | [cb_2023_us_bg_500k.zip](https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_bg_500k.zip) | 2023 national, 500k scale, ~97 MB, auto-downloaded |

## Cost Notes

- NOAA MRMS S3: free (same-region reads, no egress)
- Overture S3: ~$0.09/GB egress (us-west-2 → local; negligible per metro)
- Census / DeepSolar: free public HTTP downloads (~98 MB total, one-time)
- Backfill Batch: ~$2–5 one-time for 34 metros × 3 months
- Athena + S3 ongoing: <$1/month
- CloudFront: free tier covers portfolio traffic
