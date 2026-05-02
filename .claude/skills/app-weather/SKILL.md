---
name: app-weather
description: Reference for the weather-app — Amplify IDs, stack names, URLs, and notes on the native React architecture (variable chart + event windows, no iframe) for staging and production.
allowed-tools: Bash(aws *)
---

# Weather App — Resource Reference

## Architecture

```
Amplify weather-app (React app at weather.jtamerius.com)
  └─ apps/weather-app/src/pages/WeatherPage.jsx
        ├─ fetches https://d326hhew368icp.cloudfront.net/locations/manifest.json
        └─ fetches https://d326hhew368icp.cloudfront.net/forecasts/{lat}_{lon}/{run_id}.json
              └─ CloudFront E15B1H9LICVP1J → s3://jtamerius/
                    ← written by jtamerius-weather-collector Lambda (runs 0,12 UTC)

The React app renders a native react-plotly.js variable chart (temperature, precip,
wind, etc.) with per-model lines and storm event windows. No iframe.

NOTE: CDN_BASE must be d326hhew368icp.cloudfront.net — www.jtamerius.com now serves
the landing page and returns 404 for /forecasts/ and /locations/ paths.
CloudFront distribution E15B1H9LICVP1J has Managed-CORS-With-Preflight policy
(5cc3b908-e619-4b99-88e5-2cf7f45965bd) on /forecasts/* and the default behavior.
```

## App IDs

| Environment | Amplify App ID | URL |
|-------------|---------------|-----|
| Staging     | `d3ro6gzwr4icy0` | `d3ro6gzwr4icy0.amplifyapp.com` |
| Production  | `d19cuiv0dybz8y` | `weather.jtamerius.com` |

## CloudFormation Stacks

| Stack | Environment | Status |
|-------|-------------|--------|
| `tools-shared-amplify-weather-staging` | Staging | ✓ UPDATE_COMPLETE |
| `tools-shared-amplify-weather-production` | Production | ⚠️ UPDATE_ROLLBACK_COMPLETE |

**⚠️ Issue:** `tools-shared-amplify-weather-production` is in `UPDATE_ROLLBACK_COMPLETE`.
Root cause: stack tried to create a new Amplify app when the 10-app account limit was already
reached. The Amplify app `d19cuiv0dybz8y` still exists and works — the stack just can't manage
it cleanly.

## Data Pipeline Resources

The weather data backend is NOT part of the tools platform — it is a separate stack:

| Resource | Name / ID |
|----------|-----------|
| Stack | `jtamerius-weather-collector` |
| Lambda | `jtamerius-weather-collector` (Python 3.12, runs every 12 h) |
| Data S3 | `s3://jtamerius/` (forecasts, grid_summary, locations, weather/) |
| CloudFront | `E15B1H9LICVP1J` → `d326hhew368icp.cloudfront.net` |
| CORS policy | `Managed-CORS-With-Preflight` on `/forecasts/*` + default behavior |
| Deploy S3 | `s3://jtamerius-website-deploy/lambda_package.zip` |

See `/weather-ensemble` for full pipeline detail (EventBridge rules, S3 layout, debug commands).

## React App Key Files

| File | Purpose |
|------|---------|
| `apps/weather-app/src/pages/WeatherPage.jsx` | Main page — location picker, variable selector, Plotly chart, event windows |
| `apps/weather-app/package.json` | Deps: `react-plotly.js`, `plotly.js-dist-min` |

**Run ID format** (matches Lambda `_run_id()`): `YYYY-MM-DDTHH` where HH = `00` or `12` (snapped to UTC).
**Fallback**: if current run_id returns 404, WeatherPage automatically retries the previous run.

## Auth

None — public app, no Cognito required.

## Directory

`apps/weather-app/` — Vite + React, `amplify.yml` present.
`apps/weather_app/` — Legacy Lambda source (ensemble-plumes). NOT deployed via this monorepo.

## Common Commands

```bash
# Check weather data freshness
aws s3 ls s3://jtamerius/grid_summary/ --profile jtam | tail -5

# Verify CORS headers are working
curl -si -H "Origin: https://weather.jtamerius.com" \
  "https://d326hhew368icp.cloudfront.net/locations/manifest.json" | grep access-control

# View Lambda logs
aws logs tail /aws/lambda/jtamerius-weather-collector --profile jtam --follow

# Manual deploy to staging
/amplify-deploy weather-app staging

# Full pipeline debug
/weather-ensemble
```
