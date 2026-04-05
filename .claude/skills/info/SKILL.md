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

---

## Apps

| App | Directory | URL (production) | Auth |
|-----|-----------|-----------------|------|
| Landing Page | `apps/landing-page/` | `tools.jtamerius.com` | Cognito |
| Ensemble Weather | `apps/weather-app/` | `weather.jtamerius.com` | None (public) |
| Finance Tracker | `apps/finance-app/` | `finance.jtamerius.com` | Cognito (`member` group) |

---

## Amplify App IDs

| App | Staging | Production |
|-----|---------|------------|
| landing-page | `d223wq48sddq6t` | (deploy production stacks to get) |
| weather-app  | `d26oqifvpt9ysq` | (deploy production stacks to get) |
| finance-app  | `d1k4zfq8stlbd`  | (deploy production stacks to get) |

**Staging default domains:**
- `d223wq48sddq6t.amplifyapp.com` (landing-page)
- `d26oqifvpt9ysq.amplifyapp.com` (weather-app)
- `d1k4zfq8stlbd.amplifyapp.com` (finance-app)

---

## CloudFormation Stacks

All stacks deploy to `us-east-1`.

### Shared stacks (per environment)

| Stack | Purpose |
|-------|---------|
| `tools-shared-iam-{env}` | OIDC provider, GitHub Actions role, Amplify service role |
| `tools-shared-cognito-{env}` | User Pool, SPA client, groups (admin/member/guest) |
| `tools-shared-dns-{env}` | ACM certificate (prod: `*.jtamerius.com`; staging: `*.staging.jtamerius.com`) |
| `tools-shared-amplify-{env}` | Amplify app + branch for landing-page |
| `tools-shared-amplify-weather-{env}` | Amplify app + branch for weather-app |
| `tools-shared-amplify-finance-{env}` | Amplify app + branch for finance-app |
| `tools-shared-monitoring-{env}` | CloudWatch alarms + SNS (optional, pass alert email to deploy-shared.sh) |

### App-specific stacks

| Stack | Purpose |
|-------|---------|
| `tools-app-landing-page-{env}` | SSM parameters (Cognito IDs written for build-time injection) |

---

## Cognito (Staging)

| Key | Value |
|-----|-------|
| User Pool ID | `us-east-1_Ia0QTCZTw` |
| App Client ID | `3b2pgk03qi0pf0i723p6mtm54r` |
| Groups | `admin` (precedence 1), `member` (10), `guest` (20) |

---

## IAM Roles

| Role | ARN |
|------|-----|
| GitHub Actions (staging) | `arn:aws:iam::606196119553:role/tools-github-actions-staging` |
| Amplify service (staging) | `arn:aws:iam::606196119553:role/tools-amplify-service-staging` |

---

## SSM Parameters (written by deploy-app.sh)

| Parameter | Value |
|-----------|-------|
| `/tools/{env}/cognito/user-pool-id` | Cognito User Pool ID |
| `/tools/{env}/cognito/client-id` | Cognito App Client ID |

---

## GitHub Secrets Required

### `production` environment
| Secret | Value |
|--------|-------|
| `AWS_ROLE_ARN` | Deploy production stacks and check IAM export |
| `AMPLIFY_APP_ID_LANDING_PAGE` | Deploy production stacks and check amplify export |
| `AMPLIFY_APP_ID_WEATHER_APP` | Deploy production stacks and check amplify export |
| `AMPLIFY_APP_ID_FINANCE_APP` | Deploy production stacks and check amplify export |

### `staging` environment
| Secret | Value |
|--------|-------|
| `AWS_ROLE_ARN` | `arn:aws:iam::606196119553:role/tools-github-actions-staging` |
| `AMPLIFY_APP_ID_LANDING_PAGE` | `d223wq48sddq6t` |
| `AMPLIFY_APP_ID_WEATHER_APP` | `d26oqifvpt9ysq` |
| `AMPLIFY_APP_ID_FINANCE_APP` | `d1k4zfq8stlbd` |

---

## GitHub Actions Workflows

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `ci.yml` | PR to `staging` or `main` | Lint, test, build, validate CFn templates |
| `deploy-staging.yml` | Push to `staging` branch | Deploy shared infra + all app frontends to staging |
| `deploy-production.yml` | Push to `main` branch | Deploy shared infra + all app frontends to production |
| `add-new-app.yml` | Manual dispatch | Scaffold a new app (creates directories + stack stubs) |

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

**First-time environment setup:**
```
/deploy-shared staging
```

**Deploy app infra + write SSM params:**
```
/deploy-app landing-page staging
```

**Manual build + deploy to Amplify (bypass CI):**
```
/amplify-deploy landing-page staging
```

**Check stack health:**
```
/stack-status
```

**Check Amplify deployment status:**
```
/amplify-status
```

**Manage Cognito users:**
```
/cognito
```

**SSO expired?**
```
/sso
```
