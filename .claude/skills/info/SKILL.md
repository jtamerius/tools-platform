---
name: info
description: Show the complete project reference — AWS resource IDs, App IDs, stack names, URLs, Cognito config, GitHub secrets, and common workflows for the tools platform.
---

# Tools Platform — Project Reference

## Overview

Vite + React monorepo deployed via GitHub Actions → AWS Amplify Hosting.
GHA builds all artifacts; Amplify is a CDN endpoint only (no source connection).

**Monorepo root:** `/Users/James/website_hub/website_hub`
**AWS profile:** `jtam`
**AWS account:** `606196119553`
**Region:** `us-east-1`

For per-app detail use `/app-landing-page`, `/app-weather`, `/app-finance`,
`/app-investment-tracker`, `/app-news-scraper`.

---

## Apps

| App | Directory | URL (production) | Auth |
|-----|-----------|-----------------|------|
| Landing Page | `apps/landing-page/` | `tools.jtamerius.com` | Cognito |
| Weather | `apps/weather-app/` | `weather.jtamerius.com` | None (public) |
| Finance Tracker | `apps/finance-app/` | `finance.jtamerius.com` | Cognito (`member` group) |
| Investment Tracker | `apps/investment-tracker/` | `investments.jtamerius.com` | Cognito |
| News Scraper | `apps/news-scraper/` | staging backend only | — |

---

## Amplify App IDs

| App | Staging | Production |
|-----|---------|------------|
| landing-page | `dfgc4jtftrltl` | `d1eoywtcjjm80v` |
| weather-app  | `d3ro6gzwr4icy0` | `d19cuiv0dybz8y` |
| finance-app  | `d3r6r8egymbh24` | `dhn8umbcf7yjw` |
| investment-tracker | `d1kqq0ntalvbmo` | `dkgy8mqrxm0zd` |

---

## CloudFormation Stacks

All stacks in `us-east-1`. ⚠️ = known broken state (see per-app skills for details).

### Shared stacks

| Stack | Status |
|-------|--------|
| `tools-shared-iam-staging` | ✓ |
| `tools-shared-iam-production` | ✓ |
| `tools-shared-cognito-staging` | ✓ |
| `tools-shared-cognito-production` | ✓ |
| `tools-shared-dns-staging` | ✓ |
| `tools-shared-dns-production` | ✓ |
| `tools-shared-monitoring-staging` | ✓ |

### Amplify stacks

| Stack | Status |
|-------|--------|
| `tools-shared-amplify-staging` | ✓ (landing-page staging) |
| `tools-shared-amplify-weather-staging` | ✓ |
| `tools-shared-amplify-finance-staging` | ✓ |
| `tools-shared-amplify-invest-tracker-staging` | ✓ |
| `tools-shared-amplify-invest-tracker-production` | ✓ |
| `tools-shared-amplify-weather-production` | ⚠️ UPDATE_ROLLBACK_COMPLETE (10-app limit hit) |
| `tools-shared-amplify-finance-production` | ⚠️ UPDATE_ROLLBACK_COMPLETE (10-app limit hit) |
| *(none)* | ⚠️ landing-page production Amplify has no CFn stack |

### App-specific stacks

| Stack | Status |
|-------|--------|
| `tools-app-landing-page-staging` | ✓ |
| `tools-app-landing-page-production` | ✓ |
| `tools-app-investment-tracker-staging` | ⚠️ UPDATE_ROLLBACK_COMPLETE (OPTIONS route conflict) |
| `tools-app-investment-tracker-production` | ✓ |
| `tools-app-news-scraper-staging` | ✓ |

### Legacy stacks (pre-tools-platform, still active)

| Stack | Status | Purpose |
|-------|--------|---------|
| `jtamerius-website` | ✓ UPDATE_COMPLETE | CloudFront + S3, serves `www.jtamerius.com` |
| `jtamerius-weather-collector` | ✓ UPDATE_COMPLETE | Lambda + EventBridge, writes weather data |
| `jtamerius-finance-tracker` | ✓ UPDATE_COMPLETE | Lambda Function URL + S3 |
| `CDKToolkit` | ✓ | CDK bootstrap |

---

## Cognito

| Key | Staging | Production |
|-----|---------|------------|
| User Pool ID | `us-east-1_hKaIobmpm` | `us-east-1_2uleQ81er` |
| App Client ID | `d3bhlrhnpbiukg0upfjpuuq7f` | `6epcdrtkupskpeik9m10bb6i20` |
| Groups | admin (1), member (10), guest (20) | admin (1), member (10), guest (20) |
| Stack | `tools-shared-cognito-staging` | `tools-shared-cognito-production` |

⚠️ There is an orphaned second production pool `us-east-1_CLD8OTuB8` (created 2026-04-04,
not in any CFn stack). Should be confirmed empty and deleted.

---

## IAM Roles

| Role | ARN |
|------|-----|
| GitHub Actions (staging) | `arn:aws:iam::606196119553:role/tools-github-actions-staging` |
| GitHub Actions (production) | `arn:aws:iam::606196119553:role/tools-github-actions-production` |
| Amplify service (staging) | `arn:aws:iam::606196119553:role/tools-amplify-service-staging` |

---

## SSM Parameters

| Parameter | Purpose |
|-----------|---------|
| `/tools/staging/cognito/user-pool-id` | `us-east-1_hKaIobmpm` |
| `/tools/staging/cognito/client-id` | `d3bhlrhnpbiukg0upfjpuuq7f` |
| `/tools/production/cognito/user-pool-id` | `us-east-1_2uleQ81er` |
| `/tools/production/cognito/client-id` | `6epcdrtkupskpeik9m10bb6i20` |
| `/tools/staging/investment-tracker/api-url` | Staging API Gateway URL |
| `/tools/production/investment-tracker/api-url` | Production API Gateway URL |
| `/tools/staging/news-scraper/recategorize-api-url` | News scraper API URL |
| `/tools/news-scraper/gemini-api-key` | SecureString (no env suffix) |
| `/tools/news-scraper/groq-api-key` | SecureString |
| `/tools/news-scraper/hf-api-key` | SecureString |
| `/tools/news-scraper/openrouter-api-key` | SecureString |
| `finance-tracker` | Old SecureString — pre-platform era, no `/tools/` prefix |

---

## S3 Buckets

| Bucket | Owner / Purpose |
|--------|----------------|
| `cdk-hnb659fds-assets-606196119553-us-east-1` | CDK bootstrap assets |
| `jtamerius` | Legacy website data (CloudFront origin, active) |
| `jtamerius-finance-data` | Legacy finance tracker data |
| `jtamerius-news-data` | News scraper output (daily updated) |
| `jtamerius-website-deploy` | Lambda deploy packages (finance, weather, news-scraper) |
| `tools-invest-tracker-emails-staging-606196119553` | SES emails (staging) |
| `tools-invest-tracker-emails-production-606196119553` | SES emails (production) |
| `ensemble-plumes-37p274-neg107p8792` | Old weather bucket — likely orphaned |
| `ensemble-plumes-southwest` | Old weather bucket — likely orphaned |
| `jtamerius-website` | Orphaned S3 bucket (not in any CFn stack) |

---

## GitHub Secrets

### `staging` environment
| Secret | Value |
|--------|-------|
| `AWS_ROLE_ARN` | `arn:aws:iam::606196119553:role/tools-github-actions-staging` |
| `AMPLIFY_APP_ID_LANDING_PAGE` | `dfgc4jtftrltl` |
| `AMPLIFY_APP_ID_WEATHER_APP` | `d3ro6gzwr4icy0` |
| `AMPLIFY_APP_ID_FINANCE_APP` | `d3r6r8egymbh24` |

### `production` environment
| Secret | Value |
|--------|-------|
| `AWS_ROLE_ARN` | `arn:aws:iam::606196119553:role/tools-github-actions-production` |
| `AMPLIFY_APP_ID_LANDING_PAGE` | `d1eoywtcjjm80v` |
| `AMPLIFY_APP_ID_WEATHER_APP` | `d19cuiv0dybz8y` |
| `AMPLIFY_APP_ID_FINANCE_APP` | `dhn8umbcf7yjw` |

---

## GitHub Actions Workflows

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `ci.yml` | PR to `staging` or `main` | Lint, test, build, validate CFn templates |
| `deploy-staging.yml` | Push to `staging` branch | Deploy shared infra + all app frontends |
| `deploy-production.yml` | Push to `main` branch | Deploy shared infra + all app frontends |
| `add-new-app.yml` | Manual dispatch | Scaffold a new app |

---

## Shared Packages

| Package | Location | Purpose |
|---------|----------|---------|
| `@tools/auth` | `shared/auth/` | `useAuth` hook, `signIn`/`signOut`, Cognito integration |
| `@tools/config` | `shared/config/` | Shared config constants |
| `@tools/ui` | `shared/ui/` | Shared UI components |

---

## Deploy Scripts

| Script | Usage |
|--------|-------|
| `infra/scripts/deploy-shared.sh <env>` | Bootstrap shared infra (one-time per env) |
| `infra/scripts/deploy-app.sh <app> <env>` | Deploy app-specific SSM params |

---

## Common Workflows

```bash
# Per-app quick reference
/app-landing-page
/app-weather
/app-finance
/app-investment-tracker
/app-globe
/app-news-scraper

# Deploy
/deploy-shared staging
/deploy-app landing-page staging
/amplify-deploy landing-page staging

# Check health
/stack-status
/amplify-status

# Auth
/cognito

# SSO expired?
/sso
```
