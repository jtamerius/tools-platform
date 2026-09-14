# Hailstoned — architecture

Historical hail exposure for solar hardware across the continental US. Public radar tells you where
hail actually fell, but it arrives as terabytes of raw grids, so it mostly goes unread. This turns
it into a hex grid joined to where solar actually sits.

Live at [hailstoned.jtamerius.com](https://hailstoned.jtamerius.com) — public, no sign-in.
Covers a fixed historical window (2026-02-02 → 2026-05-09) rather than live radar.

## Dataflow

```
NOAA MRMS  (s3://noaa-mrms-pds, public)
  │  MESH_Max_30min GRIB2, ~2-minute cadence
  ▼
NWS warning pre-filter ─── IEM archive of SVR/TOR polygons, built once and cached
  │                        only (metro, date) pairs a warning covers get decoded
  │                        documented decode reduction: 80–90%
  ▼
AWS Batch job on Fargate Spot (retry on reclaim)
  ├─ mrms_reader ......... GRIB2 ──► hail pixels above threshold
  ├─ h3_snapper .......... pixels ──► H3 res-8 cells, max MESH per cell
  ├─ overture_fetcher .... building footprints per cell (precomputed lookup)
  ├─ deepsolar_joiner .... block-group residential solar, disaggregated by building count
  └─ impact_calculator ... join residential + utility-scale exposure
  ▼
S3  parquet/hail-events/event_date=YYYY-MM-DD/
  │   catalogued in Glue with partition projection — no crawler, no manual partitions
  ▼
API Gateway ──► Lambda ──► React + deck.gl + Mapbox (static site on Amplify)
   weekly chunks to stay under the 6 MB response cap
```

## The joins

Each H3 cell is matched against three independent views of where solar is:

| Source | What it gives | Handling |
|---|---|---|
| USGS USPVDB | 6,611 utility-scale facilities | Snapped to H3 once, precomputed |
| Stanford DeepSolar-3M | Residential estimates per census block group | Disaggregated to cells proportional to building count |
| Overture Maps | Building footprints | Precomputed to a CONUS H3 lookup |

Overture publishes a new release every ~6 weeks and removes old ones, so `OVERTURE_RELEASE` in
`pipeline/src/config.py` is pinned and has to be rotated.

## Notes on the implementation

**GRIB reading.** The object is fetched and gunzipped in memory, but `pygrib.open()` takes a path
rather than a file object, so the decompressed grid is staged to a temporary file for the duration
of the read and removed in a `finally`. Nothing is cached between calls — the unlink is guarded
because a job decoding hundreds of grids would otherwise fill its container disk on the first error.

**Why pre-filter.** Decoding every grid for every day dominates runtime, and most days have no
severe weather anywhere. Gating on a cheap metadata index — NWS warning polygons — removes most of
the work. `--no-prefilter` forces a known storm day through during testing.

**Why a fixed window.** A historical window deploys as a static site with a small API in front, so
it costs near zero to leave running. Making it live is a scheduling change rather than a redesign;
it simply isn't done.

**Viewport statistics.** The sidebar recomputes for whatever is on screen rather than serving a
precomputed national total, so panning is the interaction rather than a metro dropdown.

## Components

| Path | Role |
|---|---|
| `apps/solarhail/pipeline/src/` | Seven stages, one test file each (50 tests) |
| `apps/solarhail/pipeline/scripts/` | Batch entrypoint, backfill submission, one-time precomputes |
| `apps/solarhail/api/` | Lambda serving events, state summaries and the facilities file |
| `apps/solarhail/frontend/` | deck.gl H3 hexagon layer + capacity-scaled facility dots |
| `infra/cdk/lib/stacks/solarhail-stack.ts` | S3, Glue, Athena, ECR, Batch, Lambda, API Gateway |

Running the pipeline tests locally needs `pygrib`, which has a system GDAL/eccodes dependency.
