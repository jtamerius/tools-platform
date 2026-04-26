---
name: app-landing-page
description: Reference for the landing-page app — Amplify IDs, Cognito IDs, stack names, URLs, and common workflows for staging and production.
allowed-tools: Bash(aws *)
---

# Landing Page App — Resource Reference

## Architecture

```
GitHub Actions (push to staging/main)
  → npm build  →  dist.zip  →  Amplify deploy API
Amplify (CDN only, no source connection)
  → tools.jtamerius.com (production)
  → www.jtamerius.com (production — same CloudFront, domain association updated)
  → jtamerius.com (production — Route 53 ALIAS to same CloudFront)
  → dfgc4jtftrltl.amplifyapp.com (staging default domain)
Cognito (shared platform pool) → auth for this and all other apps
```

## App IDs

| Environment | Amplify App ID | Default Domain |
|-------------|---------------|----------------|
| Staging     | `dfgc4jtftrltl` | `dfgc4jtftrltl.amplifyapp.com` |
| Production  | `d1eoywtcjjm80v` | `tools.jtamerius.com` |

**⚠️ Issue:** The production Amplify app has NO CloudFormation stack — it was created manually.
All other apps have a corresponding `tools-shared-amplify-{app}-production` CFn stack; landing page
production is an orphan. Should be imported into or recreated by a CFn stack for consistency.

## CloudFormation Stacks

| Stack | Environment | Status |
|-------|-------------|--------|
| `tools-shared-amplify-staging` | Staging | ✓ UPDATE_COMPLETE |
| `tools-app-landing-page-staging` | Staging | ✓ UPDATE_COMPLETE |
| `tools-app-landing-page-production` | Production | ✓ UPDATE_COMPLETE |
| *(none)* | Production Amplify | ⚠️ NOT IN CloudFormation |

## Cognito (shared across all auth'd apps)

| Key | Staging | Production |
|-----|---------|------------|
| User Pool ID | `us-east-1_hKaIobmpm` | `us-east-1_2uleQ81er` |
| App Client ID | `d3bhlrhnpbiukg0upfjpuuq7f` | `6epcdrtkupskpeik9m10bb6i20` |
| Groups | admin (1), member (10), guest (20) | admin (1), member (10), guest (20) |

## SSM Parameters

| Parameter | Value |
|-----------|-------|
| `/tools/staging/cognito/user-pool-id` | `us-east-1_hKaIobmpm` |
| `/tools/staging/cognito/client-id` | `d3bhlrhnpbiukg0upfjpuuq7f` |
| `/tools/production/cognito/user-pool-id` | `us-east-1_2uleQ81er` |
| `/tools/production/cognito/client-id` | `6epcdrtkupskpeik9m10bb6i20` |

## IAM Roles

| Role | ARN |
|------|-----|
| GitHub Actions (staging) | `arn:aws:iam::606196119553:role/tools-github-actions-staging` |
| GitHub Actions (production) | `arn:aws:iam::606196119553:role/tools-github-actions-production` |
| Amplify service (staging) | `arn:aws:iam::606196119553:role/tools-amplify-service-staging` |

## Directory

`apps/landing-page/` — Vite + React, `amplify.yml` present.

## Common Commands

```bash
# Manual deploy to staging
/amplify-deploy landing-page staging

# Check Amplify deployment status
/amplify-status landing-page

# Check stack health
/stack-status staging

# Manage Cognito users
/cognito
```
