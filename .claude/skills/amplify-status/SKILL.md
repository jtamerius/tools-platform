---
name: amplify-status
description: Show the status of recent Amplify deployments across all apps and environments. Pass an app name or environment to filter.
argument-hint: "[app-name|environment]"
allowed-tools: Bash(aws *)
---

# Amplify Deployment Status

Show recent jobs for all Amplify apps.

## Known App IDs

| App | Environment | App ID |
|-----|-------------|--------|
| landing-page | staging | `d223wq48sddq6t` |
| weather-app  | staging | `d26oqifvpt9ysq` |
| finance-app  | staging | `d1k4zfq8stlbd` |
| landing-page | production | (check `tools-shared-amplify-production-AppId` export) |
| weather-app  | production | (check `tools-shared-amplify-weather-production-AppId` export) |
| finance-app  | production | (check `tools-shared-amplify-finance-production-AppId` export) |

For each app ID, show the 3 most recent jobs:

```bash
AWS_PROFILE=jtam aws amplify list-jobs \
  --app-id {APP_ID} \
  --branch-name {branch} \
  --region us-east-1 \
  --max-results 3 \
  --query "jobSummaries[*].[jobId,status,startTime,endTime,jobType]" \
  --output table \
  --no-cli-pager
```

Branch names: `staging` (staging env), `main` (production env).

If `$ARGUMENTS` is provided, filter to the matching app(s) or environment.

Report the most recent job status for each app, flag any FAILED deployments, and include the default domain URL for smoke testing:
- `d223wq48sddq6t.amplifyapp.com`
- `d26oqifvpt9ysq.amplifyapp.com`
- `d1k4zfq8stlbd.amplifyapp.com`

**If SSO token expired**, run `/sso` first then retry.
