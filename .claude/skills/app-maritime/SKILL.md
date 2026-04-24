---
name: app-maritime
description: Reference for the maritime-trajectory app — Amplify ID, Lambda ETL pipeline, API Gateway, S3 buckets, SSM parameters, and staging-only status.
allowed-tools: Bash(aws *)
---

# Maritime Trajectory App — Resource Reference

## Architecture

```
EventBridge (daily schedule)
  → tools-maritime-etl-pipeline-staging Lambda (Python 3.11)
        └─ reads AIS data from s3://tools-maritime-ais-input-staging-606196119553/
        └─ writes processed data to s3://tools-maritime-processed-staging-606196119553/

HTTP API (g7uu63lung)
  → tools-maritime-dataset-api-staging Lambda (Python 3.11)
        └─ serves processed AIS data

Amplify d1o8kdw7efkpuj (staging frontend, Three.js globe with AIS trajectories)
```

## App IDs

| Environment | Amplify App ID | URL |
|-------------|---------------|-----|
| Staging     | `d1o8kdw7efkpuj` | `d1o8kdw7efkpuj.amplifyapp.com` |
| Production  | **NONE** | — |

## Resources

| Resource | Staging | Production |
|----------|---------|------------|
| Lambda (ETL) | `tools-maritime-etl-pipeline-staging` | **NONE** |
| Lambda (API) | `tools-maritime-dataset-api-staging` | **NONE** |
| API Gateway | `g7uu63lung` | **NONE** |
| S3 input bucket | `tools-maritime-ais-input-staging-606196119553` | **NONE** |
| S3 output bucket | `tools-maritime-processed-staging-606196119553` | **NONE** |
| CFn stack (backend) | `tools-app-maritime-pipeline-staging` | **NONE** |
| CFn stack (Amplify) | `tools-shared-amplify-maritime-staging` | **NONE** |

## SSM Parameters (Staging)

| Parameter |
|-----------|
| `/tools/staging/maritime/api-url` |
| `/tools/staging/maritime/etl-function-name` |
| `/tools/staging/maritime/ais-input-bucket` |
| `/tools/staging/maritime/processed-output-bucket` |

## CloudFormation Stacks

| Stack | Status |
|-------|--------|
| `tools-app-maritime-pipeline-staging` | ✓ UPDATE_COMPLETE |
| `tools-shared-amplify-maritime-staging` | ✓ UPDATE_COMPLETE |

Both stacks are staging-only. No production exists.

## Pattern Differences

- Staging-only deployment
- No app directory in monorepo matching `maritime` (frontend source may be elsewhere or removed)
- CDK-deployed backend (not SAM/raw CFn like some others)
- Two separate S3 buckets (input + processed), both in CFn stack
- No Cognito auth on the Amplify app

## Common Commands

```bash
# Check ETL logs
aws logs tail /aws/lambda/tools-maritime-etl-pipeline-staging --profile jtam --follow

# Check API logs
aws logs tail /aws/lambda/tools-maritime-dataset-api-staging --profile jtam --follow

# List AIS input bucket
aws s3 ls s3://tools-maritime-ais-input-staging-606196119553/ --profile jtam

# Get API URL
aws ssm get-parameter \
  --name /tools/staging/maritime/api-url \
  --profile jtam --region us-east-1 --query 'Parameter.Value' --output text

# Invoke ETL manually
aws lambda invoke --function-name tools-maritime-etl-pipeline-staging \
  --profile jtam --region us-east-1 /tmp/out.json && cat /tmp/out.json
```
