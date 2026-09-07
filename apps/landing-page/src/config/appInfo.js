import { APPS } from './apps'

/**
 * Long-form info for each app on the platform — the content behind /#/apps/:id.
 *
 * Prose fields (summary, pipeline detail, fact value) accept [label](url) spans,
 * rendered as external links by AppInfo.
 *
 * `id` matches the registry id in shared/config/src/apps.js where one exists.
 * Hailstoned is showcased on the home page but is not a Cognito-gated platform
 * app, so it carries its own `url` and `access` here.
 *
 * @type {Record<string, {
 *   name: string,
 *   tagline: string,
 *   accent: string,
 *   access: string,
 *   url?: string,
 *   host: string,
 *   summary: string[],
 *   pipeline: Array<{ label: string, detail: string }>,
 *   stack: string[],
 *   facts: Array<{ label: string, value: string }>,
 * }>}
 */
export const APP_INFO = {
  'weather-app': {
    name: 'Ensemble Weather',
    tagline: 'Multi-model ensemble forecasts for the Southwest US.',
    accent: '#0077b6',
    access: 'Public',
    host: 'weather.jtamerius.com',
    summary: [
      'Operational forecasts disagree, and the disagreement is the useful signal. This app pulls ' +
      'the GFS, NAM, and HRRR runs for a set of Southwest US locations and plots them together so ' +
      'the spread between models is visible at a glance rather than hidden behind a single number.',
      'Each variable — temperature, precipitation, wind — gets its own chart with one line per model ' +
      'and shaded windows marking storm events, so you can see where the models converge and where ' +
      'the forecast is genuinely uncertain.',
    ],
    pipeline: [
      { label: 'Collector Lambda', detail: 'A scheduled Python Lambda fires twice daily at 00 and 12 UTC, pulling the latest model runs.' },
      { label: 'S3 + CloudFront', detail: 'Runs are written as JSON to S3 and served through a CloudFront distribution.' },
      { label: 'Manifest fetch', detail: 'The frontend reads a manifest to discover available sites, then pulls each forecast run on demand.' },
      { label: 'Native React charts', detail: 'react-plotly.js renders the per-model variable charts and event windows directly — no iframe, no server-rendered images.' },
    ],
    stack: ['React · Vite', 'Plotly', 'Lambda · Python', 'S3 · CloudFront', 'Amplify'],
    facts: [
      { label: 'Models', value: 'GFS · NAM · HRRR' },
      { label: 'Coverage', value: 'Southwest US' },
      { label: 'Refresh', value: 'Every 12 hours (00 / 12 UTC)' },
      { label: 'Access', value: 'Public — no sign-in required' },
    ],
  },

  hailstoned: {
    name: 'Hailstoned',
    tagline: 'CONUS-scale historical hail exposure for solar assets.',
    accent: '#00915a',
    access: 'Public',
    url: 'https://hailstoned.jtamerius.com',
    host: 'hailstoned.jtamerius.com',
    summary: [
      'Hail is the dominant weather risk to solar hardware, and the historical record that would let ' +
      'you quantify it is buried in terabytes of radar output. Hailstoned distills months of NOAA MRMS ' +
      'radar history into an H3 hexagon grid and joins it against the locations of actual solar assets.',
      'Two views share the same hail surface: Commercial maps utility-scale facilities from the ' +
      '[USPVDB](https://www.usgs.gov/centers/geology-energy-and-minerals-science-center/science/solar-energy), ' +
      'and Home Solar uses [DeepSolar](https://web.stanford.edu/group/deepsolar/ds) residential estimates. ' +
      'Pan and zoom anywhere in the continental US and the exposure statistics recompute for whatever ' +
      'is in the viewport.',
      'This one is a portfolio piece rather than a live service — it runs on a fixed historical backfill ' +
      'with no ongoing ingestion, and deploys as a static site to keep its running cost near zero.',
    ],
    pipeline: [
      { label: 'MRMS radar', detail: 'MESH_Max_30min GRIB2 is streamed straight from NOAA’s public MRMS archive — the raw grids are never persisted locally.' },
      { label: 'H3 snapping', detail: 'Hail pixels are snapped to H3 resolution-8 cells, keeping the maximum MESH value observed in each cell.' },
      { label: 'Asset join', detail: 'Precomputed building footprints, USPVDB facilities, and DeepSolar residential estimates are joined per cell into an exposure count.' },
      { label: 'Nightly Batch job', detail: 'The whole chain runs on AWS Batch, writing one compressed CONUS file plus a state aggregation per event day.' },
      { label: 'API + Deck.gl', detail: 'An HTTP API serves merged events in weekly chunks; the frontend renders them as an H3HexagonLayer with capacity-scaled facility dots on top.' },
    ],
    stack: ['React', 'Deck.gl · Mapbox', 'H3', 'AWS Batch', 'Lambda · API Gateway', 'Parquet · S3'],
    facts: [
      { label: 'Coverage', value: 'Continental US, H3 resolution 8' },
      { label: 'Backfill window', value: '2026-02-02 → 2026-05-09' },
      { label: 'Facilities', value: '6,611 USPVDB utility-scale sites' },
      { label: 'Data sources', value: 'NOAA MRMS · USPVDB · DeepSolar · Overture' },
    ],
  },

  purgatory: {
    name: 'Purgatory Crowding',
    tagline: 'Traffic-cam and road-weather ingestion for ski-resort crowding prediction.',
    accent: '#b4530a',
    access: 'Admin only',
    host: 'purg.jtamerius.com',
    summary: [
      'How busy is the mountain going to be? The inputs exist in public but scattered: CDOT traffic ' +
      'cameras along the approach corridor, RWIS road-weather sensors, and the resort’s own conditions ' +
      'page. This app pulls all three on a fifteen-minute cadence and builds the labeled history a ' +
      'crowding model needs.',
      'Vehicle counts come from a YOLO detector run over each camera frame inside a container Lambda. ' +
      'Detections are then QC’d by an agent pass that flags frames the model likely got wrong — night ' +
      'shots, snow-covered lenses, reframed cameras — so bad counts don’t quietly poison the training set.',
      'The frontend is a review UI: page through snapshots, correct counts, and inspect the ingest ' +
      'record behind any point in the time series.',
    ],
    pipeline: [
      { label: 'Camera ingest', detail: 'An EventBridge rule triggers a container Lambda every 15 minutes to fetch the current frame from each configured traffic cam.' },
      { label: 'YOLO detection', detail: 'Vehicle detection runs in-process with the model weights baked into the ECR image, writing counts alongside the raw frame in S3.' },
      { label: 'Agent QC', detail: 'A Claude-backed pass reviews each detection for plausibility and flags suspect frames for human review.' },
      { label: 'Resort scrape', detail: 'A second Lambda scrapes current conditions and the resort forecast on the same 15-minute schedule.' },
      { label: 'Review API', detail: 'A Python Lambda backs the review UI, reading ingest records from DynamoDB and presigning S3 URLs for the snapshots.' },
    ],
    stack: ['React', 'YOLO · Ultralytics', 'Container Lambda · ECR', 'DynamoDB · S3', 'EventBridge', 'Claude API'],
    facts: [
      { label: 'Cadence', value: 'Ingest and scrape every 15 minutes' },
      { label: 'Inputs', value: 'Traffic cameras · RWIS · Resort conditions' },
      { label: 'Detection', value: 'YOLO vehicle counts, retrained from labeled review data' },
      { label: 'Access', value: 'Cognito JWT, admin group only' },
    ],
  },

  'adventure-builder': {
    name: 'Adventure Builder',
    tagline: 'Write and visualize branching choose-your-own-adventure stories.',
    accent: '#7048c8',
    access: 'Admin only',
    host: 'adventure.jtamerius.com',
    summary: [
      'Branching narratives are easy to start and hard to keep straight — the tenth page is where you ' +
      'lose track of which choices lead where. Adventure Builder treats the story as a graph you can ' +
      'see, so dead ends and orphaned pages are obvious instead of discovered on a replay.',
      'An AI writing assistant sits alongside the editor for drafting a page or suggesting where a ' +
      'branch might go, running on Bedrock so the whole app stays inside one AWS account.',
    ],
    pipeline: [
      { label: 'React editor', detail: 'A Vite frontend on Amplify handles page editing and renders the story graph.' },
      { label: 'Express on Lambda', detail: 'A Node 20 Express app runs behind API Gateway via serverless-express, keeping routing conventional.' },
      { label: 'Single-table DynamoDB', detail: 'Stories and pages share one table — stories keyed by user, pages keyed by story, with a GSI for page lookups by story id.' },
      { label: 'Bedrock assist', detail: 'The writing assistant calls amazon.nova-lite-v1:0 for draft text and branch suggestions.' },
    ],
    stack: ['React · Vite', 'Node 20 · Express', 'API Gateway v2', 'DynamoDB', 'Bedrock'],
    facts: [
      { label: 'Data model', value: 'Single-table design, stories + pages' },
      { label: 'AI model', value: 'Amazon Nova Lite via Bedrock' },
      { label: 'Codebase', value: 'Split frontend / API packages' },
      { label: 'Access', value: 'Cognito, admin group only' },
    ],
  },

  'investment-tracker': {
    name: 'Investment Tracker',
    tagline: 'Turns seller-statement emails into a tracked payment history.',
    accent: '#0f766e',
    access: 'Admin only',
    host: 'investments.jtamerius.com',
    summary: [
      'Monthly seller statements arrive as email attachments and are useless as a time series until ' +
      'someone types them into a spreadsheet. This app removes that step: statements are mailed to an ' +
      'address the platform owns, parsed automatically, and land in the ledger as structured payments.',
      'On top of the parsed history it tracks estimated current value per account, with a manual ' +
      'override layer for individual cells where the parse is wrong or a figure needs restating by hand.',
    ],
    pipeline: [
      { label: 'SES receipt', detail: 'Inbound statement email is caught by an SES receipt rule and dropped into a dedicated S3 bucket.' },
      { label: 'Parser Lambda', detail: 'The S3 write triggers a Python 3.12 Lambda that converts the .eml into structured payment records.' },
      { label: 'DynamoDB ledger', detail: 'Records land across accounts, payments, cell-override, and user-email tables.' },
      { label: 'Express API', detail: 'A Node 20 Express Lambda behind API Gateway serves the ledger and applies manual cell overrides on read.' },
    ],
    stack: ['React · Vite', 'Node 20 · Express', 'Python 3.12', 'DynamoDB', 'SES · S3'],
    facts: [
      { label: 'Ingestion', value: 'Email-driven — SES → S3 → parser' },
      { label: 'Tables', value: 'Accounts · Payments · Cell overrides · User emails' },
      { label: 'Corrections', value: 'Per-cell manual override layer' },
      { label: 'Access', value: 'Cognito, admin group only' },
    ],
  },

  'finance-app': {
    name: 'Finance Tracker',
    tagline: 'Personal finance tracking and analysis.',
    accent: '#b02a5b',
    access: 'Admin only',
    host: 'finance.jtamerius.com',
    summary: [
      'A private ledger for categorizing spending and looking at where money actually goes over time, ' +
      'built for one user rather than generalized into a product.',
      'It is deliberately the simplest backend on the platform: a single Python Lambda reading and ' +
      'writing flat files in S3, with no database to maintain and nothing running when nobody is ' +
      'looking at it.',
    ],
    pipeline: [
      { label: 'React frontend', detail: 'An Amplify-hosted Vite app handles entry, categorization, and the summary views.' },
      { label: 'Cognito access token', detail: 'The frontend sends the Cognito access token as a bearer credential — not the ID token.' },
      { label: 'Lambda validation', detail: 'The Python Lambda validates that token itself against Cognito before touching any data.' },
      { label: 'S3 as the store', detail: 'Ledger data lives as flat files in a private S3 bucket; there is no database in the path.' },
    ],
    stack: ['React · Vite', 'Lambda · Python 3.12', 'API Gateway HTTP', 'S3', 'Cognito'],
    facts: [
      { label: 'Storage', value: 'Flat files in S3 — no database' },
      { label: 'Auth', value: 'Cognito access token validated in-Lambda' },
      { label: 'Scope', value: 'Single-user personal ledger' },
      { label: 'Access', value: 'Cognito, admin group only' },
    ],
  },
}

/** Registry entry for an info id, if the app is in the shared registry. */
function registryEntry(id) {
  return APPS.find((a) => a.id === id)
}

/** Resolve the launch URL for an info id — registry first, then the info fallback. */
export function appUrl(id) {
  return registryEntry(id)?.url ?? APP_INFO[id]?.url ?? null
}

/** True when /#/apps/:id will render a real page. */
export function hasAppInfo(id) {
  return Boolean(APP_INFO[id])
}
