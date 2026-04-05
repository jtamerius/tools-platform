---
name: amplify-deploy
description: Manually build and deploy one app to Amplify, bypassing GitHub Actions. Fetches Cognito env vars from SSM, runs npm build, zips dist/, uploads to Amplify via create-deployment API, then polls until complete.
argument-hint: "<app-name> <environment>"
allowed-tools: Bash(aws *), Bash(npm *), Bash(cd *), Bash(zip *), Bash(curl *)
---

# Manual Amplify Deploy

Build and deploy `$ARGUMENTS` (e.g. `landing-page staging` or `finance-app production`).

Parse `$ARGUMENTS` as `<app-name> <environment>`:
- `app-name`: `landing-page`, `weather-app`, or `finance-app`
- `environment`: `staging` or `production`

## App ID lookup

| App | Staging | Production |
|-----|---------|------------|
| `landing-page` | `d223wq48sddq6t` | check CFn exports |
| `weather-app`  | `d26oqifvpt9ysq` | check CFn exports |
| `finance-app`  | `d1k4zfq8stlbd`  | check CFn exports |

For production, look up the App ID:
```bash
AWS_PROFILE=jtam aws cloudformation list-exports \
  --region us-east-1 \
  --query "Exports[?contains(Name,'amplify') && contains(Name,'production') && contains(Name,'AppId')].[Name,Value]" \
  --output table --no-cli-pager
```

## Step 1 — Fetch Cognito env vars from SSM (skip for weather-app)

`weather-app` has no auth and needs no env vars. For `landing-page` and `finance-app`:

```bash
export VITE_COGNITO_USER_POOL_ID=$(AWS_PROFILE=jtam aws ssm get-parameter \
  --name /tools/{environment}/cognito/user-pool-id \
  --query Parameter.Value --output text --no-cli-pager)
export VITE_COGNITO_CLIENT_ID=$(AWS_PROFILE=jtam aws ssm get-parameter \
  --name /tools/{environment}/cognito/client-id \
  --query Parameter.Value --output text --no-cli-pager)
export VITE_ENV={environment}
```

## Step 2 — Build

```bash
cd /Users/James/website_hub/website_hub/apps/{app-name}
npm ci && npm run build
```

## Step 3 — Package and deploy

Use the correct branch: `main` for production, `staging` for staging.

```bash
cd /Users/James/website_hub/website_hub/apps/{app-name}/dist
zip -r ../dist.zip .
cd ..

RESULT=$(AWS_PROFILE=jtam aws amplify create-deployment \
  --app-id {APP_ID} \
  --branch-name {branch} \
  --output json --no-cli-pager)

JOB_ID=$(echo "$RESULT" | jq -r '.jobId')
ZIP_URL=$(echo "$RESULT" | jq -r '.zipUploadUrl')

curl --fail -T dist.zip "$ZIP_URL"

AWS_PROFILE=jtam aws amplify start-deployment \
  --app-id {APP_ID} \
  --branch-name {branch} \
  --job-id "$JOB_ID" \
  --no-cli-pager
```

## Step 4 — Poll until complete

```bash
while true; do
  STATUS=$(AWS_PROFILE=jtam aws amplify get-job \
    --app-id {APP_ID} \
    --branch-name {branch} \
    --job-id "$JOB_ID" \
    --query 'job.summary.status' --output text --no-cli-pager)
  echo "Status: $STATUS"
  case "$STATUS" in
    SUCCEED) echo "Deployment succeeded." ; break ;;
    FAILED|CANCELLED) echo "Deployment $STATUS." ; exit 1 ;;
    *) sleep 20 ;;
  esac
done
```

Report the job ID, final status, and the Amplify default domain URL for smoke testing.

**If SSO token expired**, run `/sso` first then retry.
