---
name: security-policy
description: Security policy and periodic audit checklist for the tools platform. Covers CORS, IAM, secrets management, Lambda auth, and GitHub Actions. Run this before major releases or quarterly.
allowed-tools: Bash(aws *), Bash(grep *), Bash(find *)
---

# Security Policy — tools-platform

This document captures the security decisions made for this platform, why they were made, and what to check periodically. It is the output of a full security audit conducted May 2026.

---

## 1. CORS

### Policy
- **Public read endpoints** (solarhail, weather CDN): `allowOrigins: ['*']` is acceptable because there is no auth and the data is intentionally public.
- **Finance tracker Lambda URL**: scoped to `https://finance.jtamerius.com`, `https://staging.d3r6r8egymbh24.amplifyapp.com`, `http://localhost:5173`.

### Where it lives
| Layer | File |
|---|---|
| API Gateway (CDK) | `infra/cdk/lib/stacks/investment-tracker-stack.ts` — `corsConfiguration.allowOrigins` |
| Lambda URL (CFN) | `apps/finance/api/infrastructure/template.yaml` — `Cors.AllowOrigins` |
| Express middleware | `apps/investment-tracker/api/src/app.js` — reads `ALLOWED_ORIGINS` env var |
| CDK env var (sets Express) | `infra/cdk/lib/stacks/investment-tracker-stack.ts` — `ALLOWED_ORIGINS: isProd ? 'https://investments.jtamerius.com,...' : '*'` |

### What to check periodically
- [ ] When adding a new authenticated app, ensure CORS is scoped in both the API Gateway config and the Express middleware env var.
- [ ] When adding a new Amplify staging URL, add it to finance-tracker `AllowOrigins`.
- [ ] Staging APIs intentionally use `allowOrigins: ['*']` — confirm production stacks do not.

```bash
# Quick check: scan for wildcard CORS in production-facing stacks
grep -rn "allowOrigins\|AllowOrigins" infra/cdk/lib/stacks/ apps/weather/pipeline/
```

---

## 2. Secrets & API Keys

### Policy
- **No secrets in source code or committed `.env` files.** `.env` is gitignored; `.env.example` is committed with empty values.
- **All secrets live in SSM Parameter Store.** Workflows fetch them at build/deploy time via `aws ssm get-parameter`.
- **Third-party API keys** (LLM providers, map tokens) are stored in SSM and injected as Lambda environment variables or build-time env vars.
- **IAM access keys** (long-lived credentials) should NOT be managed by CloudFormation because CFN can only store them as SSM `Type: String` (unencrypted). If a long-lived key is required, create it manually and store as `SecureString`.

### SSM parameter conventions
```
/tools/{env}/cognito/user-pool-id        # Cognito pool ID
/tools/{env}/cognito/client-id           # Cognito app client ID
/tools/{env}/investment-tracker/api-url  # API Gateway URL
/tools/{env}/solarhail/api-url           # API Gateway URL
/tools/{env}/finance/api-url             # Finance tracker Lambda URL
/tools/production/solarhail/mapbox       # Mapbox public token
/tools/news-scraper/*                    # LLM API keys (SecureString)
```

### What to check periodically
- [ ] No API keys or secrets appear in any committed file.
- [ ] New apps follow the SSM pattern — URL stored in `/tools/{env}/{app}/api-url`, fetched in the deploy workflow.
- [ ] `.env.example` exists for every app that needs env vars.

```bash
# Scan for potential secrets in source
grep -rn "api_key\|apikey\|secret\|password\|bearer\|sk-\|pk\." \
  apps/ --include="*.js" --include="*.jsx" --include="*.ts" --include="*.py" \
  | grep -v node_modules | grep -v ".env.example" | grep -v test
```

---

## 3. IAM Roles & Permissions

### Policy
- **GitHub Actions uses OIDC federation.** No long-lived AWS access keys anywhere. The role is assumed via `aws-actions/configure-aws-credentials` with `role-to-assume`.
- **OIDC trust is scoped to this repo:** `repo:jtamerius/website_hub:*`. Any ref (branch, tag, PR) within the repo can assume the role — this is intentional to allow PR deploys.
- **Lambda execution roles** use the principle of least privilege — each Lambda's CDK/CFN role grants only the specific DynamoDB tables, S3 buckets, and SSM parameters it needs.
- **GitHub Actions role** has broad permissions for deployment operations. This is an accepted limitation — see the API Gateway section below.

### Accepted limitations
**API Gateway wildcard (`apigateway:*` on `Resource: *`):** API Gateway v2 ARNs are not known before creation, and sub-resources (routes, integrations, authorizers) are created via POST calls that cannot be scoped by resource ARN pre-creation. Scoping by tag condition is theoretically possible but operationally fragile with CDK. This is an accepted risk, mitigated by the OIDC repo scope.

**Amplify service role uses `AdministratorAccess-Amplify` AWS-managed policy.** This is the standard practice for Amplify — it needs broad permissions to manage the resources it provisions on your behalf.

### Where it lives
| Role | File |
|---|---|
| GitHub Actions role (CDK) | `infra/cdk/lib/stacks/iam-stack.ts` |
| GitHub Actions role (CFN) | `infra/shared/iam/template.yaml` |
| Amplify service role | `infra/cdk/lib/stacks/iam-stack.ts` — `AmplifyServiceRole` |
| Investment tracker Lambda role | `infra/cdk/lib/stacks/investment-tracker-stack.ts` (CDK grants) |
| Finance tracker Lambda role | `apps/finance/api/infrastructure/template.yaml` — `LambdaRole` |

### What to check periodically
- [ ] GitHub Actions role trust policy still scoped to `repo:jtamerius/website_hub:*`.
- [ ] No new `Action: '*'` or `Resource: '*'` pairs added to Lambda execution roles.
- [ ] New Lambda functions created via CDK use `table.grantReadWriteData()`, `bucket.grantRead()` etc. rather than manual wildcard policies.
- [ ] No IAM users with programmatic access keys managed by CloudFormation (CFN stores secrets as plaintext SSM String).

```bash
# Check for overly broad Lambda execution role policies in CDK stacks
grep -n "actions.*\*\|resource.*\*" infra/cdk/lib/stacks/*.ts

# Check GitHub Actions OIDC trust condition is intact
aws iam get-role --role-name tools-github-actions-staging \
  --query 'Role.AssumeRolePolicyDocument' --profile jtam --no-cli-pager
```

---

## 4. Authentication on API Endpoints

### Policy
- **Authenticated endpoints** use API Gateway JWT authorizer backed by Cognito. The token is validated by AWS before the Lambda is ever invoked.
- **Finance tracker** uses a Lambda URL (`AuthType: NONE`) with application-level Cognito token validation via `cognito-idp:GetUser`. This is a legacy pattern — if the finance tracker is ever significantly reworked, migrate it to API Gateway + JWT authorizer to match the other apps.
- **Public endpoints** (solarhail `/api/conus`, `/api/facilities`; news data S3) are intentionally unauthenticated. No change needed.
- **Health endpoints** (`/health`, `/api/health`) are intentionally unauthenticated.

### What to check periodically
- [ ] New authenticated endpoints are added behind the API Gateway JWT authorizer, not as open Lambda URLs.
- [ ] Finance tracker handler still calls `cognito.get_user(AccessToken=token)` and returns 401 on failure — check `apps/finance/api/lambda_handler.py`.
- [ ] No new `AuthType: NONE` Lambda URLs are created for endpoints that serve user-specific data.

---

## 5. Cognito Configuration

### Policy
- Separate user pools per environment (staging vs production).
- Self sign-up is **enabled** — new users can register with a valid email. Apps use group membership (`admin`, `member`, `guest`) to control access. Ungrouped users have no app-level permissions.
- MFA is **optional** (TOTP). Consider requiring it for the `admin` group if admin functionality expands.
- Password policy: min 8 chars, uppercase + lowercase + numbers. No symbol requirement (accepted for an internal platform).
- Account enumeration protection: enabled.
- Token revocation: enabled.

### What to check periodically
- [ ] Staging pool ID: `us-east-1_hKaIobmpm`. Production pool ID: `us-east-1_2uleQ81er`. Confirm these haven't drifted.
- [ ] If new apps are added, confirm they check group membership before granting access to sensitive operations.

```bash
# Verify pool IDs match SSM
aws ssm get-parameter --name /tools/staging/cognito/user-pool-id \
  --query Parameter.Value --output text --profile jtam --no-cli-pager
aws ssm get-parameter --name /tools/production/cognito/user-pool-id \
  --query Parameter.Value --output text --profile jtam --no-cli-pager
```

---

## 6. S3 Bucket Security

### Policy
- All buckets storing user or financial data have `BlockPublicAccess: BLOCK_ALL`.
- The `jtamerius-news-data` bucket (news scraper) has been torn down — if it still exists in AWS, delete it.
- The one intentionally public bucket is `jtamerius` (weather data, served via CloudFront) — only specific prefixes (`/forecasts/`, `/locations/`) are public.

### What to check periodically
- [ ] New buckets created via CDK use `s3.BlockPublicAccess.BLOCK_ALL` unless intentionally public.
- [ ] No new `PublicReadAccess: true` or missing `BlockPublicAccess` in CloudFormation templates.

```bash
# List all buckets and their public access block status
aws s3api list-buckets --query 'Buckets[].Name' --output text --profile jtam --no-cli-pager \
  | tr '\t' '\n' \
  | xargs -I{} aws s3api get-public-access-block --bucket {} --profile jtam --no-cli-pager 2>/dev/null
```

---

## 7. Environment Variable Hygiene

### Policy
- Frontend apps use `VITE_*` env vars, never hardcoded values in source.
- All `VITE_*` vars are injected at build time by the GitHub Actions workflow from SSM.
- `.env` files are gitignored. `.env.example` files (empty values) are committed.
- Lambda env vars are set in CDK/CFN — never hardcoded strings for URLs or resource names.

### Apps and their required env vars
| App | Vars | SSM source |
|---|---|---|
| landing-page | `VITE_COGNITO_USER_POOL_ID`, `VITE_COGNITO_CLIENT_ID` | `/tools/{env}/cognito/*` |
| weather-app | `VITE_COGNITO_USER_POOL_ID`, `VITE_COGNITO_CLIENT_ID` | `/tools/{env}/cognito/*` |
| finance-app | `VITE_COGNITO_USER_POOL_ID`, `VITE_COGNITO_CLIENT_ID`, `VITE_API_URL` | `/tools/{env}/cognito/*`, `/tools/{env}/finance/api-url` |
| investment-tracker | `VITE_COGNITO_USER_POOL_ID`, `VITE_COGNITO_CLIENT_ID`, `VITE_API_URL` | `/tools/{env}/cognito/*`, `/tools/{env}/investment-tracker/api-url` |
| solarhail | `VITE_API_URL`, `VITE_MAPBOX_TOKEN` | `/tools/{env}/solarhail/api-url`, `/tools/production/solarhail/mapbox` |

### What to check periodically
- [ ] No `import.meta.env.VITE_*` reads a value that could fall back to `undefined` in production.
- [ ] All new apps have a `.env.example` committed.
- [ ] No hardcoded API Gateway URLs or resource names in frontend source.

```bash
# Scan for hardcoded AWS URLs in frontend source
grep -rn "execute-api\|amazonaws.com\|amplifyapp.com" \
  apps/*/src apps/solarhail/frontend/src --include="*.js" --include="*.jsx" --include="*.ts" --include="*.tsx"
```

---

## Periodic Audit Checklist

Run this quarterly or before a major release.

### Fast checks (run locally)
```bash
# 1. No secrets in source
grep -rn "AKIA\|sk-\|ghp_\|api_key\s*=\s*['\"]" apps/ infra/ \
  | grep -v node_modules | grep -v cdk.out | grep -v ".example"

# 2. No hardcoded AWS URLs in frontends
grep -rn "execute-api\|lambda-url\|amazonaws.com" \
  apps/*/src apps/solarhail/frontend/src \
  --include="*.js" --include="*.jsx" --include="*.ts" --include="*.tsx"

# 3. No wildcard CORS on authenticated endpoints
grep -B5 "allowOrigins.*\*\|AllowOrigins.*\*" \
  infra/cdk/lib/stacks/investment-tracker-stack.ts \
  apps/finance/api/infrastructure/template.yaml

# 4. Confirm .env files are not tracked
git ls-files apps/**/.env
```

### AWS checks (requires jtam profile)
```bash
# 5. Verify GitHub Actions OIDC trust hasn't changed
aws iam get-role --role-name tools-github-actions-production \
  --query 'Role.AssumeRolePolicyDocument.Statement[0].Condition' \
  --profile jtam --no-cli-pager

# 6. Confirm SSM finance API URL parameters exist
aws ssm get-parameter --name /tools/staging/finance/api-url --profile jtam --no-cli-pager
aws ssm get-parameter --name /tools/production/finance/api-url --profile jtam --no-cli-pager

# 7. Confirm Cognito pool IDs match expected values
aws ssm get-parameter --name /tools/staging/cognito/user-pool-id \
  --query Parameter.Value --output text --profile jtam --no-cli-pager
# Expected: us-east-1_hKaIobmpm
aws ssm get-parameter --name /tools/production/cognito/user-pool-id \
  --query Parameter.Value --output text --profile jtam --no-cli-pager
# Expected: us-east-1_2uleQ81er
```
