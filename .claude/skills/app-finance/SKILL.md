---
name: app-finance
description: Reference for the finance-app — Amplify IDs, stack names, URLs, and finance-tracker Lambda for staging and production.
allowed-tools: Bash(aws *)
---

# Finance App — Resource Reference

## Architecture

```
GitHub Actions → Amplify finance-app (React, finance.jtamerius.com)
  → jtamerius-finance-tracker Lambda via API Gateway HTTP API
        └─ reads/writes s3://jtamerius-finance-data/

Auth: Cognito access token (Bearer) validated inside Lambda via cognito-idp:GetUser.
Frontend uses getAccessTokenJwt() from shared/auth — NOT the ID token.
```

## App IDs

| Environment | Amplify App ID | URL |
|-------------|---------------|-----|
| Staging     | `d3r6r8egymbh24` | `d3r6r8egymbh24.amplifyapp.com` |
| Production  | `dhn8umbcf7yjw`  | `finance.jtamerius.com` |

## CloudFormation Stacks

| Stack | Environment | Status |
|-------|-------------|--------|
| `tools-shared-amplify-finance-staging` | Staging | ✓ UPDATE_COMPLETE |
| `tools-shared-amplify-finance-production` | Production | ⚠️ UPDATE_ROLLBACK_COMPLETE |

**⚠️ Issue:** `tools-shared-amplify-finance-production` is in `UPDATE_ROLLBACK_COMPLETE`.
Same root cause as weather-app: tried to create a new Amplify app when the 10-app account limit was
reached. The Amplify app `dhn8umbcf7yjw` exists and works; the stack cannot manage it cleanly.

## Finance Tracker Lambda

| Resource | Name / ID |
|----------|-----------|
| Stack | `jtamerius-finance-tracker` |
| Lambda | `jtamerius-finance-tracker` (Python 3.12) |
| API Gateway | HTTP API `uvt928vggh` — `https://uvt928vggh.execute-api.us-east-1.amazonaws.com` |
| S3 data | `s3://jtamerius-finance-data/` |
| Deploy package | `s3://jtamerius-website-deploy/finance_package.zip` |
| Lambda source | `apps/weather_app/finance-tracker/lambda_handler.py` |
| CF template | `apps/weather_app/ensemble-plumes/infrastructure/finance-tracker/template.yaml` |

**⚠️ Note:** The Lambda Function URL (`e5jtowi…`) returns 403 from AWS infrastructure for unknown
reasons even with `AuthType: NONE`. Use the API Gateway URL above — it works reliably.

**⚠️ Note:** The old `finance-tracker` SSM parameter is unused — auth is now Cognito only.

## S3 Data Files

All data lives as flat JSON arrays in `s3://jtamerius-finance-data/`:
- `investments.json` — hard money loan records
- `events.json` — funding/payoff/rate-change events per investment
- `accounts.json` — bank/brokerage accounts
- `snapshots.json` — point-in-time account balance snapshots
- `scenarios.json` — saved calculator scenarios (rows + years)

## Lambda API Endpoints

All require `Authorization: Bearer <cognito-access-token>`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/summary` | Active loan totals |
| GET/POST | `/investments` | List (supports `?status=active|closed|all`) / create |
| PUT | `/investments/{id}` | Update investment fields |
| GET/POST | `/events` | List (supports `?investment_id=`) / create |
| GET/POST | `/accounts` | List with latest balance / create |
| PUT | `/accounts/{id}` | Update account fields |
| GET/POST | `/snapshots` | List (supports `?account_id=`) / create |
| GET/POST | `/scenarios` | List / save calculator scenario |
| DELETE | `/scenarios/{id}` | Delete saved scenario |
| GET | `/timeseries` | Daily principal totals from first event to today |

## Auth

Cognito required — `member` group membership enforced by frontend.
Lambda validates via `cognito.get_user(AccessToken=token)` — no IAM needed.

| Key | Staging | Production |
|-----|---------|------------|
| User Pool ID | `us-east-1_hKaIobmpm` | `us-east-1_2uleQ81er` |
| Client ID | `d3bhlrhnpbiukg0upfjpuuq7f` | `6epcdrtkupskpeik9m10bb6i20` |

## Frontend Structure

`apps/finance-app/src/pages/FinancePage.jsx` — full single-file app, mobile-first.

Tabs: Overview · Invest. · Accounts · Calc

- **Overview**: summary stat cards + active loans list
- **Investments**: filter pills (active/closed/all), expandable cards with event history
- **Accounts**: total balance banner, cards with snapshot history
- **Calc**: one row per account + one aggregated "Hard Loans" row; combined projection at 5-yr milestones; save/load named scenarios

## CI/CD

Lambda deploys via `deploy-finance-tracker-production` job in `.github/workflows/deploy-production.yml`.
Triggered by changes to `apps/weather_app/finance-tracker/**`.
Packages `lambda_handler.py` → `finance_package.zip` → uploads to S3 → CloudFormation update.

## Common Commands

```bash
# Check Lambda logs
aws logs tail /aws/lambda/jtamerius-finance-tracker --profile jtam --follow

# Test API (replace TOKEN with a valid Cognito access token)
curl -H "Authorization: Bearer TOKEN" https://uvt928vggh.execute-api.us-east-1.amazonaws.com/summary

# View finance data bucket
aws s3 ls s3://jtamerius-finance-data/ --profile jtam

# Manual deploy to staging
/amplify-deploy finance-app staging
```
