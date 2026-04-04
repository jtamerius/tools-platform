# Secrets and Environment Variables

This document explains what is safe to expose, what must never be committed or sent to the browser, which GitHub Secrets need to be configured, and how to manage environment variables for both local development and Amplify deployments.

---

## What Is Safe to Expose in the Frontend

The following values are **designed to be public**. They are not credentials — they only identify a resource. Without additional authentication they grant no access.

| Variable | Example | Why it's safe |
|----------|---------|---------------|
| `VITE_COGNITO_USER_POOL_ID` | `us-east-1_AbCdEfGhI` | Identifies the User Pool. Cannot be used to authenticate without also providing valid user credentials. |
| `VITE_COGNITO_CLIENT_ID` | `1abc2defghij3klmno4pqrst5u` | Identifies the app client. The client has no secret (intentionally). This is required for the browser SDK to work. |
| `VITE_ENV` | `staging` | Identifies the deployment environment. Used only for display or feature flags. |

These values are baked into the JavaScript bundle by Vite at build time and are visible to anyone who opens browser DevTools. This is expected and acceptable.

---

## What Must NEVER Go in the Frontend

The following must never be included in environment variables prefixed with `VITE_`, committed to the repository, or sent to the browser in any form.

| Secret | Risk if exposed |
|--------|----------------|
| Cognito User Pool client secret | Allows spoofing OAuth flows; not applicable here (client has no secret by design, but would be critical if one existed) |
| AWS `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | Full AWS API access, potentially account takeover |
| GitHub OAuth token (`GITHUB_OAUTH_TOKEN`) | Repository read/write access |
| Any backend API key with privileged operations | Depends on the service, but generally allows unauthorized calls |
| Database connection strings | Direct database access |
| Private keys or certificates | Impersonation, decryption |

If you accidentally commit any of the above:

1. Rotate the secret immediately — assume it is compromised.
2. Remove it from git history using `git filter-repo` or contact GitHub support.
3. Audit recent usage logs for the exposed credential.

---

## GitHub Secrets

Configure these in **Settings → Secrets and variables → Actions** on the repository.

### Repository-level Secrets

| Secret name | Required by | Description |
|-------------|-------------|-------------|
| `AWS_ROLE_ARN` | `ci.yml`, `deploy-staging.yml`, `deploy-production.yml` | ARN of the IAM role GitHub Actions assumes via OIDC. Created by `infra/shared/iam/template.yaml`. Format: `arn:aws:iam::123456789012:role/tools-github-actions-staging` |
| `GITHUB_OAUTH_TOKEN` | `deploy-staging.yml`, `deploy-production.yml` | GitHub Personal Access Token (classic) with `repo` scope. Used by Amplify Hosting to pull source code from the repository. Store a separate token per environment if desired. |
| `AMPLIFY_APP_ID_LANDING_PAGE` | `deploy-staging.yml`, `deploy-production.yml` | Amplify application ID for the landing page (e.g. `d1abc2defg3hij`). Found in the Amplify console or as the `AmplifyAppId` output from the `tools-shared-amplify-{env}` CloudFormation stack. |

### Adding Secrets for New Apps

When you add a new app (see [adding-new-app.md](adding-new-app.md)), add:

| Secret name | Description |
|-------------|-------------|
| `AMPLIFY_APP_ID_<APP_NAME>` | Amplify app ID for the new app. Use SCREAMING_SNAKE_CASE. |

### Getting the AWS Role ARN

After deploying `infra/shared/iam/`:

```bash
aws cloudformation describe-stacks \
  --stack-name tools-shared-iam-staging \
  --query "Stacks[0].Outputs[?OutputKey=='GitHubActionsRoleArn'].OutputValue" \
  --output text
```

You need one `AWS_ROLE_ARN` secret per environment (staging and production), or use a GitHub Environment-scoped secret if you configure separate GitHub Environments.

---

## Amplify Environment Variables via SSM

Amplify builds use CloudFormation [dynamic SSM references](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/dynamic-references.html) to inject values at deploy time without storing them in plaintext in the template:

```yaml
# In infra/shared/amplify/template.yaml
EnvironmentVariables:
  - Name: VITE_COGNITO_USER_POOL_ID
    Value: !Sub '{{resolve:ssm:/tools/${Environment}/cognito/user-pool-id}}'
  - Name: VITE_COGNITO_CLIENT_ID
    Value: !Sub '{{resolve:ssm:/tools/${Environment}/cognito/client-id}}'
```

These SSM parameters are written by the app-level stack (`infra/apps/landing-page/template.yaml`) during the deploy pipeline, before the Amplify build is triggered.

### SSM Parameter Paths

| Parameter path | Written by | Consumed by |
|----------------|------------|-------------|
| `/tools/{env}/cognito/user-pool-id` | `infra/apps/landing-page` stack | Amplify build for landing-page |
| `/tools/{env}/cognito/client-id` | `infra/apps/landing-page` stack | Amplify build for landing-page |

For future apps, use the path pattern `/tools/{env}/{app-name}/{param-name}`.

### Adding a New SSM-Backed Variable

1. Add the SSM parameter resource to `infra/apps/<app-name>/template.yaml`.
2. Reference it in the Amplify app's `EnvironmentVariables` block in `infra/shared/amplify/template.yaml` using `{{resolve:ssm:...}}`.
3. Deploy the app infra stack before triggering the Amplify build (the deploy pipeline already does this in the correct order).

---

## Local Development — `.env.local` Files

Never commit `.env.local` — it is in `.gitignore`. Each app provides a `.env.example` that documents all required variables with placeholder values.

### Setup

```bash
cd apps/landing-page
cp .env.example .env.local
# Fill in real values from the staging Cognito stack
```

### Getting Cognito Values for Local Development

Use the staging Cognito stack (never use production credentials locally):

```bash
# User Pool ID
aws cloudformation describe-stacks \
  --stack-name tools-shared-cognito-staging \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" \
  --output text

# Client ID
aws cloudformation describe-stacks \
  --stack-name tools-shared-cognito-staging \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolClientId'].OutputValue" \
  --output text
```

### `apps/landing-page/.env.example`

```bash
VITE_COGNITO_USER_POOL_ID=us-east-1_XXXXXXXXX
VITE_COGNITO_CLIENT_ID=XXXXXXXXXXXXXXXXXXXXXXXXXX
VITE_ENV=staging
```

When adding a new app, create a corresponding `.env.example` at `apps/<app-name>/.env.example` with the same structure plus any app-specific variables.

---

## Secret Rotation

| Secret | Rotation trigger | Steps |
|--------|-----------------|-------|
| `GITHUB_OAUTH_TOKEN` | Token expires or is compromised | Generate a new PAT in GitHub → update the GitHub Secret |
| `AWS_ROLE_ARN` | Role is deleted/renamed | Re-deploy `infra/shared/iam/` → update the GitHub Secret with the new ARN |
| Cognito User Pool (recreated) | Stack replace (rare) | Re-deploy `infra/apps/<app>/` to update SSM → Amplify picks up new values on next build |

---

## Secrets Summary Table

| Name | Location | Visibility | Rotation |
|------|----------|-----------|---------|
| `VITE_COGNITO_USER_POOL_ID` | `.env.local`, Amplify (via SSM) | Public (frontend bundle) | When User Pool recreated |
| `VITE_COGNITO_CLIENT_ID` | `.env.local`, Amplify (via SSM) | Public (frontend bundle) | When client recreated |
| `AWS_ROLE_ARN` | GitHub Secret | GitHub Actions only | When IAM role changed |
| `GITHUB_OAUTH_TOKEN` | GitHub Secret | GitHub Actions only | Periodically / on compromise |
| `AMPLIFY_APP_ID_*` | GitHub Secret | GitHub Actions only | When Amplify app recreated |
