---
name: stack-status
description: Show the status of all tools-platform CloudFormation stacks. Surfaces any stacks in a failed or rollback state with their error events. Pass an environment ("staging" or "production") to filter; omit to show all.
argument-hint: "[environment]"
allowed-tools: Bash(aws *)
---

# CloudFormation Stack Status

List all `tools-*` stacks and their current status.

If `$ARGUMENTS` is provided (e.g. `staging` or `production`), filter to that environment.
Otherwise show all environments.

```bash
AWS_PROFILE=jtam aws cloudformation list-stacks \
  --region us-east-1 \
  --stack-status-filter \
    CREATE_COMPLETE UPDATE_COMPLETE \
    CREATE_IN_PROGRESS UPDATE_IN_PROGRESS \
    ROLLBACK_COMPLETE ROLLBACK_IN_PROGRESS \
    CREATE_FAILED UPDATE_FAILED UPDATE_ROLLBACK_COMPLETE \
  --query "StackSummaries[?starts_with(StackName, 'tools-')].[StackName,StackStatus,LastUpdatedTime]" \
  --output table \
  --no-cli-pager
```

For any stack in a `*FAILED*` or `*ROLLBACK*` state, show the failed resource events:

```bash
AWS_PROFILE=jtam aws cloudformation describe-stack-events \
  --stack-name {stack-name} \
  --region us-east-1 \
  --query "StackEvents[?ResourceStatus=='CREATE_FAILED' || ResourceStatus=='UPDATE_FAILED' || ResourceStatus=='DELETE_FAILED'].[Timestamp,LogicalResourceId,ResourceStatusReason]" \
  --output table --no-cli-pager | head -40
```

**Expected stacks per environment:**

| Stack | Healthy Status |
|-------|---------------|
| `tools-shared-iam-{env}` | `CREATE_COMPLETE` or `UPDATE_COMPLETE` |
| `tools-shared-cognito-{env}` | `CREATE_COMPLETE` or `UPDATE_COMPLETE` |
| `tools-shared-dns-{env}` | `CREATE_COMPLETE` or `UPDATE_COMPLETE` |
| `tools-shared-amplify-{env}` | `CREATE_COMPLETE` or `UPDATE_COMPLETE` |
| `tools-shared-amplify-weather-{env}` | `CREATE_COMPLETE` or `UPDATE_COMPLETE` |
| `tools-shared-amplify-finance-{env}` | `CREATE_COMPLETE` or `UPDATE_COMPLETE` |
| `tools-app-landing-page-{env}` | `CREATE_COMPLETE` or `UPDATE_COMPLETE` (after deploy-app.sh) |

**If SSO token expired**, run `/sso` first then retry.
