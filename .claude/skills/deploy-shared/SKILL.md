---
name: deploy-shared
description: Deploy all shared infrastructure stacks (IAM, Cognito, DNS, Amplify apps) for a given environment. Pass "staging" or "production". Run once per environment on first setup; re-run when infra/shared/** templates change.
argument-hint: "<environment> [alert-email]"
allowed-tools: Bash(aws *), Bash(bash *)
---

# Deploy Shared Infrastructure

Deploy all shared stacks in dependency order for `$ARGUMENTS` (e.g. `staging` or `production`).

Parse `$ARGUMENTS` as `<environment> [alert-email]`:
- `environment`: required — `staging` or `production`
- `alert-email`: optional — if provided, also deploys the monitoring stack

```bash
cd /Users/James/website_hub/website_hub
AWS_PROFILE=jtam bash infra/scripts/deploy-shared.sh $ARGUMENTS
```

**Stacks deployed (in order):**
1. `tools-shared-iam-{env}` — OIDC provider + IAM roles
2. `tools-shared-cognito-{env}` — Cognito User Pool
3. `tools-shared-dns-{env}` — ACM certificate (us-east-1)
4. `tools-shared-amplify-{env}` — Amplify app for landing-page
5. `tools-shared-amplify-weather-{env}` — Amplify app for weather-app
6. `tools-shared-amplify-finance-{env}` — Amplify app for finance-app
7. `tools-shared-monitoring-{env}` — CloudWatch alarms (only if alert-email provided)

**After deployment, report:**
- Stack statuses
- The Amplify App IDs (run `/amplify-status` or `aws cloudformation list-exports` to retrieve)
- Reminder to set GitHub secrets if first-time setup

**If SSO token expired**, run `/sso` first then retry.
