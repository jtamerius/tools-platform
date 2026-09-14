import { APPS } from './apps'

/**
 * Long-form info for each app on the platform — the content behind /#/apps/:id.
 *
 * This renders on a public page. Keep internal resource names out of it:
 * no bucket URIs, function names, ARNs, or API hostnames.
 *
 * Prose fields (summary, pipeline detail, fact value) accept [label](url)
 * spans, rendered as external links by AppInfo.
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
 *   status: string,
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
    tagline: 'See how much the forecast models disagree with each other.',
    accent: '#0077b6',
    access: 'Public',
    status: 'Live',
    host: 'weather.jtamerius.com',
    summary: [
      'I built this because I wanted to know how confident a forecast actually was before ' +
      'planning around it. Most weather apps show you one number for Saturday. That number ' +
      'comes from a model, other models said something different, and the app throws that away.',
      'This pulls the GFS, NAM, and HRRR runs for a set of Southwest locations and draws them on ' +
      'the same axes. If the lines sit on top of each other, the models agree and the forecast is ' +
      'worth trusting. If they fan out, it isn’t settled yet.',
      'Each variable gets its own chart — temperature, precipitation, wind — with shaded bands ' +
      'marking storm events.',
    ],
    pipeline: [
      { label: 'Collector', detail: 'A scheduled Python Lambda pulls the latest run of each model twice a day, at 00 and 12 UTC.' },
      { label: 'Storage', detail: 'Each run is written to S3 as JSON and served through CloudFront.' },
      { label: 'Manifest', detail: 'The frontend reads a manifest to find available locations, then loads only the runs you ask for.' },
      { label: 'Charts', detail: 'Plotly draws the per-model lines and event bands in the browser. Nothing is pre-rendered on a server.' },
    ],
    stack: ['React · Vite', 'Plotly', 'Lambda · Python', 'S3 · CloudFront', 'Amplify'],
    facts: [
      { label: 'Models', value: 'GFS · NAM · HRRR' },
      { label: 'Coverage', value: 'Southwest US' },
      { label: 'Refresh', value: 'Twice daily, 00 and 12 UTC' },
      { label: 'Access', value: 'Public, no sign-in' },
    ],
  },

  hailstoned: {
    name: 'Hailstoned',
    tagline: 'Historical hail exposure for solar sites across the US.',
    accent: '#00915a',
    access: 'Public',
    status: 'Live',
    host: 'hailstoned.jtamerius.com',
    summary: [
      'I work on clean energy siting, and hail is the main weather threat to solar hardware. The ' +
      'radar record that would tell you where hail actually falls is public, but it arrives as ' +
      'terabytes of raw grids, so most people never look at it.',
      'This processes months of NOAA radar into a hex grid and joins it to where solar actually ' +
      'sits: utility-scale facilities from the ' +
      '[USPVDB](https://www.usgs.gov/centers/geology-energy-and-minerals-science-center/science/solar-energy), ' +
      'and residential estimates from [DeepSolar](https://web.stanford.edu/group/deepsolar/ds). ' +
      'Pan anywhere in the lower 48 and the numbers recalculate for what is on screen.',
      'It runs on a fixed historical window rather than live data, and deploys as a static site, ' +
      'so it costs close to nothing to leave running.',
    ],
    pipeline: [
      { label: 'Radar', detail: 'Maximum hail size grids are streamed from NOAA’s public MRMS archive. The raw files are read in flight and never stored.' },
      { label: 'Hex grid', detail: 'Hail pixels are snapped to H3 cells, keeping the largest hail size seen in each cell.' },
      { label: 'Solar join', detail: 'Each cell is matched against building footprints, utility-scale facilities, and residential solar estimates to get a count of what was exposed.' },
      { label: 'Nightly job', detail: 'The full chain runs on AWS Batch, writing one file per event day plus a state-level summary.' },
      { label: 'Map', detail: 'An API serves events in weekly chunks. The frontend draws them as hexagons with facility dots sized by capacity on top.' },
    ],
    stack: ['React', 'Deck.gl · Mapbox', 'H3', 'AWS Batch', 'Lambda · API Gateway', 'Parquet · S3'],
    facts: [
      { label: 'Coverage', value: 'Continental US' },
      { label: 'Window', value: '2026-02-02 to 2026-05-09' },
      { label: 'Facilities', value: '6,611 utility-scale sites' },
      { label: 'Sources', value: 'NOAA MRMS · USPVDB · DeepSolar · Overture' },
    ],
  },

  purgatory: {
    name: 'Purgatory Crowding',
    tagline: 'Collecting traffic-camera and weather data to predict ski-day crowding.',
    accent: '#b4530a',
    access: 'Public',
    status: 'Early — collecting data',
    host: 'purg.jtamerius.com',
    summary: [
      'I ski at Purgatory and wanted to know how busy it would be before making the drive. ' +
      'Everything you would need to work that out is public, but none of it is in one place: ' +
      'CDOT traffic cameras on the approach, road-weather sensors, and the resort’s own ' +
      'conditions page.',
      'This app is early. Right now all it does is collect and clean data. Every fifteen minutes ' +
      'it grabs a frame from each camera, counts the vehicles in it with a YOLO detector, and ' +
      'records road and resort conditions from the same moment. A review UI lets me page through ' +
      'the snapshots and fix counts the detector got wrong.',
      'There is no crowding prediction yet, and won’t be until a full season is on disk. The ' +
      'point of this stage is a clean labeled history worth training on.',
    ],
    pipeline: [
      { label: 'Camera fetch', detail: 'A scheduled job pulls the current frame from each traffic camera every fifteen minutes.' },
      { label: 'Vehicle counting', detail: 'A YOLO detector runs on each frame and counts vehicles. The model weights ship inside the container image.' },
      { label: 'Automated check', detail: 'A Claude pass reviews each detection and flags the ones that look wrong, usually night shots or a snow-covered lens.' },
      { label: 'Conditions', detail: 'A second job records resort conditions and road weather on the same schedule, so every count has matching context.' },
      { label: 'Review UI', detail: 'I page through flagged frames and correct counts by hand. Those corrections become the training labels.' },
    ],
    stack: ['React', 'YOLO · Ultralytics', 'Container Lambda', 'DynamoDB · S3', 'EventBridge', 'Claude API'],
    facts: [
      { label: 'Stage', value: 'Data collection only, no model yet' },
      { label: 'Cadence', value: 'Every 15 minutes' },
      { label: 'Inputs', value: 'Traffic cameras · Road weather · Resort conditions' },
      { label: 'Access', value: 'Public, no sign-in' },
    ],
  },


  'investment-tracker': {
    name: 'Investment Tracker',
    tagline: 'Turns statement emails into a payment history without retyping.',
    accent: '#0f766e',
    access: 'Admin only',
    status: 'Live',
    host: 'investments.jtamerius.com',
    summary: [
      'Monthly seller statements arrive as email attachments. Charting them meant retyping numbers ' +
      'into a spreadsheet every month, which I did for a while and then stopped doing.',
      'Now the statements go to an address the platform owns and get parsed as they land, so the ' +
      'payment history builds itself. On top of that it tracks estimated current value per ' +
      'account, with a manual override for cells where the parse is wrong or a figure needs ' +
      'restating by hand.',
    ],
    pipeline: [
      { label: 'Email arrives', detail: 'SES catches inbound statement mail and drops it in a private bucket.' },
      { label: 'Parsing', detail: 'That write triggers a Python Lambda, which pulls structured payment records out of the message.' },
      { label: 'Ledger', detail: 'Records are stored in DynamoDB across accounts, payments, overrides, and sender addresses.' },
      { label: 'API', detail: 'A Node Express Lambda serves the ledger and applies manual overrides when reading.' },
    ],
    stack: ['React · Vite', 'Node · Express', 'Python', 'DynamoDB', 'SES · S3'],
    facts: [
      { label: 'Ingestion', value: 'Email, parsed on arrival' },
      { label: 'Corrections', value: 'Per-cell manual override' },
      { label: 'Tracks', value: 'Payments and estimated value per account' },
      { label: 'Access', value: 'Admin only' },
    ],
  },

  'finance-app': {
    name: 'Finance Tracker',
    tagline: 'A private ledger for tracking personal spending.',
    accent: '#b02a5b',
    access: 'Admin only',
    status: 'Live',
    host: 'finance.jtamerius.com',
    summary: [
      'A ledger for categorizing spending and seeing where the money goes over time. I built it ' +
      'for myself and never generalized it into something other people would use.',
      'The backend is one Python Lambda reading and writing flat files in a private bucket. There ' +
      'is no database to maintain and nothing running when I am not looking at it, which is the ' +
      'whole reason it still exists.',
    ],
    pipeline: [
      { label: 'Frontend', detail: 'A React app handles entry, categorizing, and the summary views.' },
      { label: 'Auth', detail: 'The frontend sends a Cognito access token, and the Lambda checks it against Cognito before touching any data.' },
      { label: 'Storage', detail: 'Ledger data lives as flat files in a private bucket. Nothing sits between the Lambda and the files.' },
    ],
    stack: ['React · Vite', 'Lambda · Python', 'API Gateway', 'S3', 'Cognito'],
    facts: [
      { label: 'Data store', value: 'Flat files in S3, no database' },
      { label: 'Backend', value: 'One Python Lambda' },
      { label: 'Scope', value: 'Single user' },
      { label: 'Access', value: 'Admin only' },
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
