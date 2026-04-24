---
name: app-news-scraper
description: Reference for the news-scraper backend — Lambda functions, API Gateway, S3 data bucket, EventBridge schedule, SSM parameters, and API keys for staging.
allowed-tools: Bash(aws *)
---

# News Scraper — Resource Reference

## Architecture

```
EventBridge (daily schedule)
  → jtamerius-news-scraper-staging Lambda (Python 3.12)
        └─ scrapes/categorizes news → s3://jtamerius-news-data/latest.json

HTTP API (8v1p7zdrhk)
  POST /recategorize → jtamerius-news-recategorize-staging Lambda
  GET  /articles     → jtamerius-news-recategorize-staging Lambda

SSM /tools/staging/news-scraper/recategorize-api-url → full API base URL
```

## Resources

| Resource | Staging | Production |
|----------|---------|------------|
| Lambda (scraper) | `jtamerius-news-scraper-staging` | **NONE** |
| Lambda (recategorize) | `jtamerius-news-recategorize-staging` | **NONE** |
| API Gateway | `8v1p7zdrhk` | **NONE** |
| S3 data bucket | `jtamerius-news-data` | **NONE** |
| CFn stack | `tools-app-news-scraper-staging` | **NONE** |

**⚠️ Issue:** The S3 bucket `jtamerius-news-data` is NOT in the CloudFormation stack —
it was created manually and is not managed by IaC. The stack deploys the Lambdas and
API Gateway but not the data bucket.

## S3 Data

```
s3://jtamerius-news-data/
  latest.json      — updated daily by scraper Lambda (last seen: 2026-04-23)
  news-scraper/    — (also in jtamerius-website-deploy, old deploy packages)
```

## SSM Parameters

| Parameter | Value |
|-----------|-------|
| `/tools/staging/news-scraper/recategorize-api-url` | API base URL |
| `/tools/news-scraper/gemini-api-key` | SecureString |
| `/tools/news-scraper/groq-api-key` | SecureString |
| `/tools/news-scraper/hf-api-key` | SecureString |
| `/tools/news-scraper/openrouter-api-key` | SecureString |

Note: API keys use `/tools/news-scraper/` (no env suffix) — shared across environments.

## CloudFormation Stack

| Stack | Status |
|-------|--------|
| `tools-app-news-scraper-staging` | ✓ UPDATE_COMPLETE |

Staging-only. No production stack exists.

## Pattern Differences

- Backend-only app (Python Lambda), no React frontend, no Amplify app
- No production deployment
- S3 data bucket is not in CloudFormation (manually managed)
- API keys stored without environment suffix in SSM

## Directory

`apps/news-scraper/` — Python Lambda. `package_lambda.sh` builds `lambda_package.zip`.
Deploy package: `s3://jtamerius-website-deploy/news-scraper/lambda_package.zip`

## Common Commands

```bash
# Tail scraper logs
aws logs tail /aws/lambda/jtamerius-news-scraper-staging --profile jtam --follow

# Check latest data freshness
aws s3 ls s3://jtamerius-news-data/ --profile jtam

# Get recategorize API URL
aws ssm get-parameter \
  --name /tools/staging/news-scraper/recategorize-api-url \
  --profile jtam --region us-east-1 --query 'Parameter.Value' --output text

# Invoke scraper manually
aws lambda invoke --function-name jtamerius-news-scraper-staging \
  --profile jtam --region us-east-1 /tmp/out.json && cat /tmp/out.json
```
