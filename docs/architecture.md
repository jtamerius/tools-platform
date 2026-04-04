# Architecture

This document describes the system architecture of the Internal Tools Platform, how the CI/CD pipeline works end-to-end, how authentication flows through the system, and the key design decisions behind the infrastructure layout.

---

## System Overview

The platform is a serverless monorepo hosted on AWS. Every app is a static single-page application (SPA) built with Vite + React and served by AWS Amplify Hosting. Server-side logic (when needed) will be added as Lambda-backed API Gateway endpoints within each app's CloudFormation stack.

```
┌─────────────────────────────────────────────────────────────────┐
│                        GitHub Monorepo                          │
│  apps/    infra/    shared/    .github/workflows/               │
└────────────────────────┬────────────────────────────────────────┘
                         │  push / PR
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                     GitHub Actions                              │
│                                                                 │
│  ci.yml                   deploy-staging.yml                    │
│  (lint, test, build,       deploy-production.yml                │
│   cfn validate)           (infra deploy + amplify trigger)      │
└──────────┬──────────────────────────┬───────────────────────────┘
           │ OIDC (no static creds)   │ OIDC (no static creds)
           ▼                          ▼
┌──────────────────────┐   ┌──────────────────────────────────────┐
│  AWS CloudFormation  │   │          AWS Amplify Hosting         │
│                      │   │                                      │
│  shared/iam          │   │  apps/landing-page → build → S3/CDN  │
│  shared/cognito      │   │  (custom domain via Route 53)        │
│  shared/dns          │   └──────────────────────────────────────┘
│  shared/amplify      │
│  apps/landing-page   │   ┌──────────────────────────────────────┐
└──────────────────────┘   │       AWS SSM Parameter Store        │
                           │  /tools/{env}/cognito/user-pool-id   │
                           │  /tools/{env}/cognito/client-id      │
                           └──────────────────────────────────────┘
```

---

## CI/CD Pipeline

### PR Flow (`ci.yml`)

When a pull request targets `staging` or `production`:

```
PR opened/updated
      │
      ▼
detect-changes (dorny/paths-filter)
      │
      ├── apps/landing-page/** or shared/**  →  lint-and-test-landing-page
      │                                          (npm ci, lint, test, build)
      │
      └── infra/shared/** or infra/apps/**   →  validate-infra
                                                 (aws cloudformation validate-template)
```

Only the jobs relevant to what changed actually run. A PR touching only `apps/landing-page` never triggers infra validation, and vice versa.

### Staging Deploy Flow (`deploy-staging.yml`)

Triggered on push to `staging`:

```
push → staging
      │
      ▼
detect-changes
      │
      ├── infra-shared changed?
      │       ▼
      │   deploy-shared-infra-staging
      │   (bash infra/scripts/deploy-shared.sh staging <github-token>)
      │   wait for stacks to stabilize
      │
      ├── infra-landing-page changed?  (waits for shared infra)
      │       ▼
      │   deploy-landing-page-infra-staging
      │   (bash infra/scripts/deploy-app.sh landing-page staging)
      │
      └── landing-page app changed?  (waits for app infra)
              ▼
          deploy-landing-page-frontend-staging
          (aws amplify start-job --branch-name staging)
          poll until SUCCEED / FAILED / CANCELLED
```

Jobs are conditional: if shared infra did not change its job is skipped, and downstream jobs treat `skipped` the same as `success` so they still run when only their own layer changed.

### Production Deploy Flow (`deploy-production.yml`)

Identical structure to staging, but every job references the `production` GitHub Environment, which requires a manual approval from a configured reviewer before it proceeds. The `concurrency` key ensures only one production deployment runs at a time and queues rather than cancels in-progress runs.

---

## Authentication Flow

```
User visits tools.jtamerius.com
      │
      ▼
React SPA loads
      │
      ▼
useAuth() hook initializes
      │
      ├── Reads VITE_COGNITO_USER_POOL_ID + VITE_COGNITO_CLIENT_ID
      │   from environment (injected by Amplify at build time via SSM)
      │
      ├── Checks localStorage for existing Cognito session
      │   (amazon-cognito-identity-js)
      │
      └── If session valid → decodes id-token JWT payload
                          → reads "cognito:groups" claim → string[]
                          → sets user + groups in React state

User clicks Sign In
      │
      ▼
SignInModal submits email + password
      │
      ▼
CognitoUser.authenticateUser() (SRP / USER_PASSWORD_AUTH)
      │
      ├── Success → id-token + access-token + refresh-token stored in localStorage
      │             groups parsed from id-token payload
      │             React state updated
      │
      └── Failure → error message shown in modal

Protected component renders
      │
      ▼
const { groups } = useAuth()
groups.includes('member')  →  render content
                           →  render <AccessDenied /> or redirect to sign-in

Token refresh
      │
      ▼
amazon-cognito-identity-js refreshes automatically when getSession() is called
and the access/id tokens are within 5 minutes of expiry.
Refresh token is valid for 30 days (configured in CloudFormation).
```

### Token Configuration (from `infra/shared/cognito/template.yaml`)

| Token | Validity |
|-------|---------|
| ID token | 1 hour |
| Access token | 1 hour |
| Refresh token | 30 days |

---

## Infrastructure Stack Organization

Stacks are deployed in dependency order. Each stack exports named values; downstream stacks consume them via `!ImportValue`.

```
Deployment order (per environment):
  1. infra/shared/iam           → exports: GitHubActionsRoleArn, AmplifyServiceRoleArn
  2. infra/shared/cognito       → exports: UserPoolId, UserPoolArn, UserPoolClientId
  3. infra/shared/dns           → exports: CertificateArn, StagingCertificateArn, HostedZoneId
  4. infra/shared/amplify       → imports: AmplifyServiceRoleArn
                                → exports: AmplifyAppId, AmplifyAppArn, DefaultDomain
  5. infra/apps/landing-page    → imports: (none currently; reads Cognito IDs as parameters)
                                → exports: SSMUserPoolIdPath, SSMClientIdPath
```

Export name convention: `tools-{layer}-{service}-{env}-{ResourceName}`

Example: `tools-shared-cognito-staging-UserPoolId`

### SSM Parameter Store Bridge

The landing-page app stack writes Cognito IDs to SSM:
- `/tools/{env}/cognito/user-pool-id`
- `/tools/{env}/cognito/client-id`

The Amplify app template resolves these at deploy time via CloudFormation dynamic references:
```yaml
Value: !Sub '{{resolve:ssm:/tools/${Environment}/cognito/user-pool-id}}'
```

This means environment variables are never hard-coded in CloudFormation templates and the Amplify console does not need to be updated manually when Cognito is recreated.

---

## Data Flow: App Load to Authenticated Render

```
Browser                    Amplify CDN              AWS Cognito
   │                           │                        │
   │── GET tools.jtamerius.com ►│                        │
   │◄── index.html + JS bundle ─┤                        │
   │                           │                        │
   │── useAuth() init ─────────────────────────────────►│
   │◄── valid session or null ──────────────────────────┤
   │                           │                        │
   │── [if no session] show SignInModal                  │
   │── signIn(email, pw) ──────────────────────────────►│
   │◄── tokens (id, access, refresh) ──────────────────┤
   │                           │                        │
   │  parse groups from id-token JWT                     │
   │  render gated content based on groups[]             │
```

---

## Decisions and Tradeoffs

### Static SPAs over SSR

All apps are static SPAs deployed to Amplify Hosting (backed by S3 + CloudFront). This keeps hosting costs near zero, eliminates cold starts, and allows the entire auth flow to run client-side using Cognito's JavaScript SDK. The tradeoff is that route protection is UI-only — there is no server enforcing group membership. For the current use case (personal/internal tools behind invite-only access), this is acceptable.

### Shared Cognito User Pool

A single User Pool is shared across all apps in an environment rather than one pool per app. This means a user signs in once and can access all apps without re-authenticating. The tradeoff is that all apps see the same groups — fine for a single-owner platform, but would require rethinking for multi-tenant isolation.

### GitHub Actions OIDC over Static IAM Keys

Workflows authenticate to AWS via OIDC federation. The GitHub Actions runner requests a short-lived token from the OIDC provider, exchanges it for temporary AWS credentials scoped to the `tools-github-actions-{env}` role, and those credentials expire when the job ends. No long-lived `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` are stored in GitHub Secrets.

### CloudFormation over CDK or Terraform

Plain CloudFormation YAML was chosen to minimize toolchain dependencies and keep the infrastructure readable without additional abstraction layers. The tradeoff is more verbose templates. CDK or Terraform could replace this if the number of stacks grows substantially.

### Monorepo with paths-filter

A single repository hosts all apps and shared infrastructure. GitHub Actions uses `dorny/paths-filter` to detect which parts changed, so unrelated apps never trigger each other's CI or deploy pipelines. Adding a new app requires updating the paths-filter entries in all three workflow files.

### Amplify Hosting over CloudFront + S3 Manual Setup

Amplify Hosting wraps S3 + CloudFront with a managed build pipeline and branch tracking. This simplifies the setup considerably — no need to manage CloudFront distributions, S3 bucket policies, or invalidation logic manually. The tradeoff is less control over cache behavior and slightly higher cost compared to a self-managed setup at very high traffic.
