---
name: app-adventure-builder
description: Reference for the adventure-builder app — Amplify IDs, Lambda API, DynamoDB table, Bedrock AI assist, stack names, API URLs, and workflows for staging and production.
allowed-tools: Bash(aws *)
---

# Adventure Builder — Resource Reference

## Architecture

```
GitHub Actions → Amplify (React + Vite frontend)
  → HTTP API (API Gateway v2 + Lambda Express API)
        ├── DynamoDB: single table (stories + pages, single-table design)
        └── Bedrock: amazon.nova-lite-v1:0 (AI writing assistant)

Two code directories:
  apps/adventure-builder/      Vite+React frontend
  apps/adventure-builder-api/  Node.js Lambda (Express via @vendia/serverless-express)
```

## Amplify Frontend

| Environment | App ID | URL |
|-------------|--------|-----|
| Staging     | `ADVENTURE_BUILDER_AMPLIFY_APP_ID` | `staging.<id>.amplifyapp.com` |
| Production  | `ADVENTURE_BUILDER_AMPLIFY_APP_ID` | `adventure.jtamerius.com` |

> **TODO:** Replace `ADVENTURE_BUILDER_AMPLIFY_APP_ID` placeholders after first CDK deploy.
> Run: `aws cloudformation describe-stacks --stack-name tools-shared-amplify-adventure-builder-staging --query 'Stacks[0].Outputs' --profile jtam`
> Then update this file, `shared/config/src/apps.js`, and the CI/CD workflow files.

## Backend Resources

### API

| Environment | SSM key | Notes |
|-------------|---------|-------|
| Staging     | `/tools/staging/adventure-builder/api-url` | Populated by CDK deploy |
| Production  | `/tools/production/adventure-builder/api-url` | Populated by CDK deploy |

### Lambda

| Function | Runtime |
|----------|---------|
| `tools-adventure-builder-api-staging` | nodejs20.x |
| `tools-adventure-builder-api-production` | nodejs20.x |

### DynamoDB

Single table with PK/SK design:
- Story items: `PK=USER#{userId}`, `SK=STORY#{storyId}`
- Page items: `PK=STORY#{storyId}`, `SK=PAGE#{pageId}`, also indexed by `storyId` GSI

| Table | Staging | Production |
|-------|---------|------------|
| Main  | `tools-adventure-builder-staging` | `tools-adventure-builder-production` |

GSI: `storyId-index` — PK=`storyId`, SK=`SK`

### Bedrock

Model: `amazon.nova-lite-v1:0` (us-east-1)

> **One-time setup:** Enable Nova Lite model access in AWS console:
> Bedrock → Model access → us-east-1 → Request access for Amazon Nova Lite.
> Required before `/api/assist` calls will work.

## CloudFormation Stacks

| Stack | Purpose |
|-------|---------|
| `tools-shared-amplify-adventure-builder-staging` | Amplify hosting (staging) |
| `tools-shared-amplify-adventure-builder-production` | Amplify hosting (production) |
| `tools-app-adventure-builder-staging` | DynamoDB + Lambda + API GW (staging) |
| `tools-app-adventure-builder-production` | DynamoDB + Lambda + API GW (production) |

## Auth

Cognito required (`admin` group).

| Key | Staging | Production |
|-----|---------|------------|
| User Pool ID | `us-east-1_hKaIobmpm` | `us-east-1_2uleQ81er` |
| Client ID | `d3bhlrhnpbiukg0upfjpuuq7f` | `6epcdrtkupskpeik9m10bb6i20` |

## API Routes

```
GET    /api/stories                   list user's stories
POST   /api/stories                   create story
GET    /api/stories/:id               get story + all pages
PUT    /api/stories/:id               update story metadata
DELETE /api/stories/:id               delete story + all pages
POST   /api/stories/:id/pages         create page
PUT    /api/stories/:id/pages/:pageId update page (content, choices, position)
DELETE /api/stories/:id/pages/:pageId delete page + clean orphaned choices
POST   /api/assist                    Bedrock Nova Lite AI writing assist
GET    /health                        health check (no auth)
```

## Post-Deploy Steps (first deploy only)

1. Deploy infra stacks:
   ```bash
   cd infra/cdk
   npx cdk deploy tools-shared-amplify-adventure-builder-staging -c env=staging --profile jtam
   npx cdk deploy tools-app-adventure-builder-staging -c env=staging --profile jtam
   ```
2. Get Amplify App ID from stack outputs and update:
   - This skill file (replace `ADVENTURE_BUILDER_AMPLIFY_APP_ID`)
   - `shared/config/src/apps.js` (staging URL)
   - `.github/workflows/deploy-staging.yml` (AMPLIFY_APP_ID variable)
   - `.github/workflows/deploy-production.yml` (AMPLIFY_APP_ID variable)
3. Enable Bedrock Nova Lite model access in AWS console (us-east-1).
4. Push to staging branch to trigger CI/CD.

## Common Commands

```bash
# View API logs (staging)
aws logs tail /aws/lambda/tools-adventure-builder-api-staging --profile jtam --follow

# Scan DynamoDB table (staging)
aws dynamodb scan --table-name tools-adventure-builder-staging --profile jtam --region us-east-1

# Check API health (staging) — replace ID with real API GW ID
curl https://<api-id>.execute-api.us-east-1.amazonaws.com/health

# Manual frontend deploy
/amplify-deploy adventure-builder staging
```
