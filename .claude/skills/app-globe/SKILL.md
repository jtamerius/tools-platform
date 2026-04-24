---
name: app-globe
description: Reference for the globe-app — Amplify ID, stack issues, and notes on its non-standard setup (no production, no amplify.yml, broken CFn stack).
allowed-tools: Bash(aws *)
---

# Globe App — Resource Reference

## Architecture

```
GitHub Actions → Amplify (Three.js globe visualization)
  → staging only, no production deployment
  → no Cognito auth (public app)
```

## App IDs

| Environment | Amplify App ID | URL |
|-------------|---------------|-----|
| Staging     | `d26bep45ffw4se` | `d26bep45ffw4se.amplifyapp.com` |
| Production  | **NONE** | — |

## CloudFormation Stacks

| Stack | Environment | Status |
|-------|-------------|--------|
| `tools-shared-amplify-globe-staging` | Staging | ⚠️ BROKEN — references deleted app |

**⚠️ Issues:**
1. `tools-shared-amplify-globe-staging` references Amplify app `d31dppeu1ai6hv` which **no longer
   exists** (returns 404). The actual staging app `d26bep45ffw4se` was created outside of
   CloudFormation and has no stack managing it.
2. There is **no production deployment** — globe-app is staging-only.
3. There is **no `amplify.yml`** in `apps/globe-app/` — this is the only frontend app without one.
   Amplify build must be configured via console/API directly on the app, not in code.

## Notable Differences from Standard Pattern

Standard pattern (landing-page, weather-app, finance-app):
- `amplify.yml` in app directory ✓
- Corresponding `tools-shared-amplify-{app}-{env}` CFn stack ✓
- Both staging and production deployed ✓
- Auth via Cognito (for auth'd apps) ✓

Globe-app deviations:
- No `amplify.yml` — build config not in code
- CFn stack is broken (references deleted app)
- No production Amplify app
- Uses Three.js (not shared UI components)
- No auth, no Cognito integration

## Directory

`apps/globe-app/` — Vite + React + Three.js. No `amplify.yml`.

## Common Commands

```bash
# Check current staging app
aws amplify get-app --app-id d26bep45ffw4se --profile jtam --region us-east-1

# View recent deployments
aws amplify list-jobs --app-id d26bep45ffw4se --branch-name staging \
  --profile jtam --region us-east-1 --query 'jobSummaries[0:3]'

# Check broken CFn stack
aws cloudformation describe-stacks \
  --stack-name tools-shared-amplify-globe-staging \
  --profile jtam --region us-east-1 \
  --query 'Stacks[0].StackStatus'
```
