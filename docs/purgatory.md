# Purgatory Crowding — architecture

Traffic-camera ingestion and vehicle counting along the US-550 approach to Purgatory Resort,
built to produce a labeled history worth training a crowding model on. **There is no prediction
model yet** — the pipeline, quality control and review tooling are done; prediction starts when a
full ski season is on disk.

Live at [purg.jtamerius.com](https://purg.jtamerius.com) — public, no sign-in.

## Dataflow

```
EventBridge (every 15 min) ──► Ingest (container Lambda, fans out per camera)
                                 │
                                 ├─ COTRIP API ....... capture timestamp
                                 ├─ HTTPS GET ........ frame ──► S3  raw/{cam}/{ts}.jpg
                                 ├─ YOLOv8 ........... vehicle count, split by zone polygon
                                 ├─ image stats ...... brightness, variance, edge density
                                 ├─ pvlib ............ solar altitude + azimuth
                                 ├─ flagging ......... 5 rules ──► needs_review
                                 └─ QC agent ......... Claude on Bedrock, 3 tiers,
                                                       monthly invocation cap in DynamoDB
                                 ▼
                            Ingest table (DynamoDB)
                                 │
EventBridge (every 15 min) ──► Rollup Lambda ──► Rollup table
   + nightly 30-day re-derive     one row per (camera × MT date × MT hour)
                                  sufficient statistics: n, Σy, Σy², covariates
                                 │
API Gateway (HTTP v2) ──► API Lambda ──► React frontend (Amplify)
   public GET routes                      corridor rail · live frame · zone overlay
   JWT-gated writes
```

## Why the rollup layer exists

The dashboard needs a baseline drawn from **all** history while the view shows a **window**. Those
are different data extents, so no amount of client-side memoising can be correct — before the
rollup existed, the page pulled the entire ~82 MB ingest table into the browser, twice per load.

Cells store sufficient statistics rather than pre-averaged values, so they merge by addition at any
depth: a day row rebuilt from 24 stored hour cells is exactly equal to the same day rebuilt from raw
records, and a test asserts that equality. Every time scale downstream is a summation depth over one
artifact instead of a different query shape.

Two correctness properties the tests pin:

- The rebuild window snaps outward to whole hours. A raw 2-hour incremental pass would otherwise
  rewrite the hour at each edge from a partial view and silently drop ticks.
- Day rows are rebuilt from every stored hour cell of that day, not from the run's window, or each
  tick would overwrite a complete row with a partial one.

Mountain-time DST is handled explicitly: a spring-forward day expects 92 ticks, not 96, and a
fall-back day 100. Coverage gating is load-bearing, so without this every March reads as an outage.

## Counting

`vehicle_count` is **instantaneous in-frame occupancy**, not a flow rate — it counts boxes whose
bottom-centre falls inside a zone polygon in a single frame. So it is averaged, never summed, and
cameras are combined by **median of per-camera means**, never by total.

That last choice is not stylistic. The ten cameras differ ~17× in how much road they see, because
the corridor is a transect: quiet mountain highway at the resort, urban arterials through Durango
at 39–44 km, rural again south of town. An unweighted sum is therefore dominated by the busiest few
cameras — the ones least related to resort crowding — and a single camera losing its view reads as
a corridor-wide decline. It did: a naive sum reported an 18.5% June→August traffic drop that was
almost entirely one camera failing.

## Camera health

A changepoint scan over each camera's daily series looks for a large sustained drop in counts that
is **not** accompanied by a drop in detector confidence — the signature of a camera looking
somewhere else rather than a road going quiet. Against production it returns one finding: camera
3291-E fell to 19% of its prior level around 2026-07-10 while confidence held at 0.670 → 0.663.

The first version compared a trailing 21-day window against the 42 before it and returned "ok" for
that camera, because two months on the broken level had become its own baseline. See
`apps/purgatory/frontend/src/lib/__tests__/detector-window.test.js`.

## Components

| Path | Role |
|---|---|
| `apps/purgatory/ingest/` | Container Lambda — fetch, YOLO, enrich, flag, QC agent |
| `apps/purgatory/rollup/` | Aggregate cell layer; stdlib + boto3 only (see below) |
| `apps/purgatory/api/` | Read API; public GETs, JWT-gated writes |
| `apps/purgatory/scrape/` | Resort conditions scrape |
| `apps/purgatory/frontend/` | React UI — corridor rail, live frames, review and annotate tools |
| `infra/cdk/lib/stacks/purgatory-stack.ts` | S3, DynamoDB, Lambdas, EventBridge, API Gateway |

The rollup Lambda's `requirements.txt` is deliberately empty. The CDK bundler runs `pip install -t`
on the build host, so any binary wheel would ship host-architecture objects into an x86-64 Lambda
and fail at import. An NB CDF via `math.lgamma` and an Acklam inverse normal are ~30 lines of
stdlib.

## Known gaps

- No crowding prediction model.
- Road-weather (RWIS) has been dead since 2026-08-12: CDOT retired the GraphQL API behind it and
  moved to REST services. The UI renders the outage rather than hiding it.
- Camera 3291-E's view changed in July and has not been re-aimed.
