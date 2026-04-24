---
name: app-finance
description: Reference for the finance-app — Amplify IDs, stack names, URLs, and legacy finance-tracker Lambda for staging and production.
allowed-tools: Bash(aws *)
---

# Finance App — Resource Reference

## Architecture

```
GitHub Actions → Amplify finance-app (React, finance.jtamerius.com)
  → reads from legacy jtamerius-finance-tracker Lambda (Function URL, public)
        └─ reads from s3://jtamerius-finance-data/

Two parallel systems:
  New: Amplify frontend (tools platform, Cognito-gated)
  Old: jtamerius-finance-tracker Lambda (CDK stack, direct Function URL, no auth)
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

## Legacy Finance Tracker Resources

| Resource | Name / ID |
|----------|-----------|
| Stack | `jtamerius-finance-tracker` |
| Lambda | `jtamerius-finance-tracker` (Python 3.12, Function URL — public access) |
| S3 | `s3://jtamerius-finance-data/` |
| Deploy package | `s3://jtamerius-website-deploy/finance_package.zip` |
| SSM | `finance-tracker` (old SecureString, no `/tools/` namespace prefix) |

**⚠️ Issue:** The old `finance-tracker` SSM parameter has no `/tools/` namespace — it's a leftover
from the pre-platform era and should be reviewed/removed once confirmed unused.

## Auth

Cognito required — `member` group membership enforced by frontend.

| Key | Staging | Production |
|-----|---------|------------|
| User Pool ID | `us-east-1_hKaIobmpm` | `us-east-1_2uleQ81er` |
| Client ID | `d3bhlrhnpbiukg0upfjpuuq7f` | `6epcdrtkupskpeik9m10bb6i20` |

## Directory

`apps/finance-app/` — Vite + React, `amplify.yml` present.

## Common Commands

```bash
# Check Lambda logs
aws logs tail /aws/lambda/jtamerius-finance-tracker --profile jtam --follow

# View finance data bucket
aws s3 ls s3://jtamerius-finance-data/ --profile jtam

# Manual deploy to staging
/amplify-deploy finance-app staging
```
