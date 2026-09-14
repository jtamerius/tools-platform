# Platform architecture

One monorepo, seven user-facing apps, two environments, all on AWS. Infrastructure is CDK
(TypeScript); GitHub Actions builds and deploys. There are no long-lived AWS credentials anywhere —
CI authenticates by OIDC.

## Deployment model

```
push to staging ──► Deploy — Staging     ─┐
push to main    ──► Deploy — Production  ─┤
                                          │
                    OIDC token ───────────┼──► sts:AssumeRoleWithWebIdentity
                                          │      tools-github-actions-{env}
                                          ▼
                        ┌─────────────────┴─────────────────┐
                        │                                   │
                   npx cdk deploy                    npm run build
                   (11 stacks)                       + Amplify create-deployment
                        │                                   │
              S3 · DynamoDB · Lambda              static assets on Amplify CDN
              API Gateway · Batch · ECR
              Cognito · Route 53 · ACM
```

Builds happen **in CI**, not in Amplify. Amplify is a CDN endpoint that receives a pre-built
`dist.zip` through the deployment API, which keeps every deploy reproducible from a commit and
means Amplify never needs repository access.

Jobs are gated by [`dorny/paths-filter`](https://github.com/dorny/paths-filter), so a change to one
app's frontend rebuilds only that app, and a change to a Dockerfile rebuilds only that container.

## Stacks

All under `infra/cdk/lib/stacks/`. Shared stacks are deployed once per environment; app stacks are
independent of one another.

| Stack | Contents |
|---|---|
| `iam` | GitHub Actions OIDC role, Amplify service role |
| `cognito` | Shared user pool, app client, groups (`admin`, `member`, `guest`) |
| `dns` | Route 53 records, ACM certificates |
| `amplify` | Hosting app + branch per frontend |
| `monitoring` | Alarms |
| `landing-page` | SSM parameters |
| `purgatory` | S3, 4 DynamoDB tables, 3 Lambdas, EventBridge, API Gateway |
| `solarhail` + `solarhail-precompute` | S3, Glue, Athena, ECR, Batch, Lambda, API Gateway |
| `investment-tracker` | DynamoDB, Lambdas, SES receipt rules, S3 |

Two apps predate the CDK migration and still run from hand-written CloudFormation —
`jtamerius-weather-collector` and `jtamerius-finance-tracker`, both sourced from
`apps/weather/pipeline/`. They are deployed by dedicated jobs in the same workflows.

## Authentication

A single Cognito user pool backs every gated app. Public apps skip it entirely, so the same
platform serves both without forking the deployment path.

Two enforcement styles are in use, which is a known inconsistency:

- **API Gateway JWT authorizer** — investment-tracker, and Purgatory's write
  routes. The authorizer validates issuer and audience at the edge.
- **In-Lambda validation** — finance-tracker calls `cognito-idp:GetUser` on the bearer token.
  This checks that a token is valid but not which pool or group it came from; it should move to an
  edge authorizer.

Frontends send the **access** token, not the ID token, because `GetUser` only accepts the former.

## Shared packages

`shared/auth`, `shared/config` and `shared/ui` are npm workspace packages consumed by the app
frontends: a `useAuth` hook wrapping sign-in and group checks, the canonical app registry, and the
shared navigation bar. Adding an app to the platform registry is a one-entry change in
`shared/config/src/apps.js`.

Note that `apps/purgatory/frontend` is **not** a workspace member — it resolves its dependencies
from the root `node_modules` by hoisting, which is why CI runs `npm ci` at the repository root
before building it.

## Environments

| | Staging | Production |
|---|---|---|
| Branch | `staging` | `main` |
| Domain | `*.staging.jtamerius.com` | `*.jtamerius.com` |
| Approval | none | GitHub environment gate on some jobs |

Production deploys use a `concurrency` group that queues rather than cancels, so an in-progress
production deploy is never interrupted.

## Things worth knowing before changing infrastructure

- **CDK must match deployed state.** Several resources have drifted historically; the API Gateway
  authorizer on Purgatory is the sharpest example — it exists in AWS but not in the stack, so a
  fresh deploy would recreate those routes open. Reconcile before deploying.
- **`events.CfnRule` + `lambda.CfnPermission` with literal ARNs** are used instead of
  `targets.LambdaFunction` in the Purgatory stack. The high-level construct introduces a circular
  dependency via `rule.node.addDependency`.
- **Zip Lambdas bundle with a local `tryBundle` hook** that runs `pip install -t` on the build host.
  Any binary wheel will ship host-architecture objects into an x86-64 Lambda and fail at import, so
  those functions are stdlib-only by design.
