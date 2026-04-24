---
name: app-weather
description: Reference for the weather-app — Amplify IDs, stack names, URLs, and notes on the dual-architecture (Amplify shell + legacy CloudFront backend) for staging and production.
allowed-tools: Bash(aws *)
---

# Weather App — Resource Reference

## Architecture

```
Amplify weather-app (React shell at weather.jtamerius.com)
  └─ embeds <iframe src="https://www.jtamerius.com/weather/">
        └─ served by CloudFront E15B1H9LICVP1J → s3://jtamerius/
              ← written by jtamerius-weather-collector Lambda (runs 0,12 UTC)

The Amplify app is a thin wrapper. ALL weather data and the rendered HTML
come from the legacy jtamerius-website / jtamerius-weather-collector stack.
See /weather-ensemble for the full pipeline reference.
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
it cleanly. Needs to be fixed (import existing app or delete+recreate stack).

## Legacy Data Pipeline Resources

The weather data backend is NOT part of the tools platform — it is a separate CDK stack:

| Resource | Name / ID |
|----------|-----------|
| Stack | `jtamerius-weather-collector` |
| Lambda | `jtamerius-weather-collector` (Python 3.12, runs every 12 h) |
| Data S3 | `s3://jtamerius/` (forecasts, grid_summary, locations, weather/) |
| CloudFront | `E15B1H9LICVP1J` → `www.jtamerius.com` |
| Deploy S3 | `s3://jtamerius-website-deploy/lambda_package.zip` |

See `/weather-ensemble` for full pipeline detail (EventBridge rules, S3 layout, debug commands).

## Auth

None — public app, no Cognito required.

## Directory

`apps/weather-app/` — Vite + React, `amplify.yml` present.
`apps/weather_app/` — Legacy local data directory (ensemble-plumes). NOT deployed.

## Common Commands

```bash
# Check weather data freshness
aws s3 ls s3://jtamerius/grid_summary/ --profile jtam | tail -5

# View Lambda logs
aws logs tail /aws/lambda/jtamerius-weather-collector --profile jtam --follow

# Manual deploy to staging
/amplify-deploy weather-app staging

# Full pipeline debug
/weather-ensemble
```
