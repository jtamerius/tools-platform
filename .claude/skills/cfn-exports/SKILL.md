---
name: cfn-exports
description: List all CloudFormation exports for the tools platform — Amplify App IDs, Cognito IDs, IAM role ARNs, cert ARNs. Pass an environment to filter.
argument-hint: "[staging|production]"
allowed-tools: Bash(aws *)
---

# CloudFormation Exports

List all `tools-shared-*` CloudFormation exports. These are the values shared between stacks and needed for GitHub secrets.

If `$ARGUMENTS` is `staging` or `production`, filter to that environment:

```bash
AWS_PROFILE=jtam aws cloudformation list-exports \
  --region us-east-1 \
  --no-cli-pager \
  --query "Exports[?contains(Name, 'tools-shared') && contains(Name, '{environment}')].[Name,Value]" \
  --output table
```

If no argument, show all tools exports:
```bash
AWS_PROFILE=jtam aws cloudformation list-exports \
  --region us-east-1 \
  --no-cli-pager \
  --query "Exports[?starts_with(Name, 'tools-')].[Name,Value]" \
  --output table
```

**Key exports to surface:**

| Export Name | Used for |
|-------------|----------|
| `tools-shared-amplify-{env}-AppId` | `AMPLIFY_APP_ID_LANDING_PAGE` GitHub secret |
| `tools-shared-amplify-weather-{env}-AppId` | `AMPLIFY_APP_ID_WEATHER_APP` GitHub secret |
| `tools-shared-amplify-finance-{env}-AppId` | `AMPLIFY_APP_ID_FINANCE_APP` GitHub secret |
| `tools-shared-iam-{env}-GitHubActionsRoleArn` | `AWS_ROLE_ARN` GitHub secret |
| `tools-shared-cognito-{env}-UserPoolId` | Cognito config |
| `tools-shared-cognito-{env}-UserPoolClientId` | Cognito config |
| `tools-shared-dns-{env}-StagingCertificateArn` | ACM cert for staging domains |
| `tools-shared-dns-{env}-CertificateArn` | ACM cert for production domains |

After listing, summarize the GitHub secrets that need to be set for the environment.

**If SSO token expired**, run `/sso` first then retry.
