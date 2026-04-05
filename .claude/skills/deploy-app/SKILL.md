---
name: deploy-app
description: Deploy app-specific CloudFormation infrastructure (SSM parameters) for one app + environment. Run this after deploy-shared and before the first Amplify build of an app.
argument-hint: "<app-name> <environment>"
allowed-tools: Bash(aws *), Bash(bash *)
---

# Deploy App Infrastructure

Deploy app-specific infra (SSM params) for `$ARGUMENTS` (e.g. `landing-page staging`).

Parse `$ARGUMENTS` as `<app-name> <environment>`:
- `app-name`: `landing-page`, `weather-app`, or `finance-app`
- `environment`: `staging` or `production`

```bash
cd /Users/James/website_hub/website_hub
AWS_PROFILE=jtam bash infra/scripts/deploy-app.sh $ARGUMENTS
```

**What it does:**
1. Reads Cognito `UserPoolId` and `UserPoolClientId` from `tools-shared-cognito-{env}` stack outputs
2. Deploys `infra/apps/{app-name}/template.yaml` as `tools-app-{app-name}-{env}` stack
3. Writes SSM parameters so the build step can inject Cognito config at compile time:
   - `/tools/{env}/cognito/user-pool-id`
   - `/tools/{env}/cognito/client-id`

**Prerequisite:** Shared stacks must already be deployed (`/deploy-shared {env}`).

Report the stack status and SSM parameter values written.

**If SSO token expired**, run `/sso` first then retry.
