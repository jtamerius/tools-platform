---
name: app-investment-tracker
description: Reference for the investment-tracker app — Amplify IDs, Lambda API, DynamoDB tables, S3 email bucket, SES, stack names, API URLs, and issues for staging and production.
allowed-tools: Bash(aws *)
---

# Investment Tracker — Resource Reference

## Architecture

```
GitHub Actions → Amplify (React frontend)
  → HTTP API (API Gateway v2 + Lambda Express API)
        ├── DynamoDB: accounts, payments, cell-overrides, user-emails tables
        └── S3 emails bucket ← SES receipt rules (production only)
                └── S3 event → parser Lambda (eml_to_json) → DynamoDB

Three code directories:
  apps/investment-tracker/        Vite+React frontend
  apps/investment-tracker-api/    Node.js Lambda (Express via @vendia/serverless-express)
  apps/investment-tracker-parser/ Python Lambda (email parser)
```

## Amplify Frontend

| Environment | App ID | URL |
|-------------|--------|-----|
| Staging     | `d1kqq0ntalvbmo` | `d1kqq0ntalvbmo.amplifyapp.com` |
| Production  | `dkgy8mqrxm0zd`  | `investments.jtamerius.com` |

## Backend Resources

### API

| Environment | API Gateway ID | API URL (SSM) |
|-------------|---------------|---------------|
| Staging     | `2w73ee1em9`   | `https://2w73ee1em9.execute-api.us-east-1.amazonaws.com` |
| Production  | `0la69j2ju1`   | `https://0la69j2ju1.execute-api.us-east-1.amazonaws.com` |

SSM keys: `/tools/{env}/investment-tracker/api-url`

### Lambda Functions

| Function | Runtime | Environment |
|----------|---------|-------------|
| `tools-invest-tracker-api-staging` | nodejs20.x | Staging |
| `tools-invest-tracker-api-production` | nodejs20.x | Production |
| `tools-invest-tracker-parser-staging` | python3.12 | Staging |
| `tools-invest-tracker-parser-production` | python3.12 | Production |

### DynamoDB Tables

| Table | Staging | Production |
|-------|---------|------------|
| Accounts | `tools-invest-tracker-accounts-staging` | `tools-invest-tracker-accounts-production` |
| Payments | `tools-invest-tracker-payments-staging` | `tools-invest-tracker-payments-production` |
| Cell Overrides | `tools-invest-tracker-cell-overrides-staging` | `tools-invest-tracker-cell-overrides-production` |
| User Emails | `tools-invest-tracker-user-emails-staging` | `tools-invest-tracker-user-emails-production` |

### S3 Email Buckets

| Environment | Bucket |
|-------------|--------|
| Staging | `tools-invest-tracker-emails-staging-606196119553` |
| Production | `tools-invest-tracker-emails-production-606196119553` |

### SES

| Resource | Name |
|----------|------|
| Receipt Rule Set (production) | `tools-invest-tracker-production` |

SES is production-only — seller statement emails trigger the parser Lambda via S3 events.

## CloudFormation Stacks

| Stack | Environment | Status |
|-------|-------------|--------|
| `tools-shared-amplify-invest-tracker-staging` | Staging Amplify | ✓ UPDATE_COMPLETE |
| `tools-shared-amplify-invest-tracker-production` | Production Amplify | ✓ UPDATE_COMPLETE |
| `tools-app-investment-tracker-staging` | Staging Backend | ⚠️ UPDATE_ROLLBACK_COMPLETE |
| `tools-app-investment-tracker-production` | Production Backend | ✓ UPDATE_COMPLETE |

**⚠️ Issue:** `tools-app-investment-tracker-staging` is in `UPDATE_ROLLBACK_COMPLETE`.
Root cause: `OptionsRoute` (OPTIONS /api/{proxy+}) already existed in the API Gateway when
the stack tried to create it — API: `ConflictException` 409.
All underlying resources (Lambda, DynamoDB, S3) are `CREATE_COMPLETE` and functional.
Fix: delete the conflicting OPTIONS route manually, then re-run the stack update.

## Auth

Cognito required.

| Key | Staging | Production |
|-----|---------|------------|
| User Pool ID | `us-east-1_hKaIobmpm` | `us-east-1_2uleQ81er` |
| Client ID | `d3bhlrhnpbiukg0upfjpuuq7f` | `6epcdrtkupskpeik9m10bb6i20` |

## Common Commands

```bash
# View API logs (staging)
aws logs tail /aws/lambda/tools-invest-tracker-api-staging --profile jtam --follow

# View parser logs (production)
aws logs tail /aws/lambda/tools-invest-tracker-parser-production --profile jtam --follow

# List DynamoDB items (staging accounts table)
aws dynamodb scan --table-name tools-invest-tracker-accounts-staging --profile jtam --region us-east-1

# Check email bucket (staging)
aws s3 ls s3://tools-invest-tracker-emails-staging-606196119553/ --profile jtam

# Manual frontend deploy
/amplify-deploy investment-tracker staging
```
