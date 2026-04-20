#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { configs, EnvName } from '../lib/config';
import { IamStack } from '../lib/stacks/iam-stack';
import { CognitoStack } from '../lib/stacks/cognito-stack';
import { DnsStack } from '../lib/stacks/dns-stack';
import { MonitoringStack } from '../lib/stacks/monitoring-stack';
import { AmplifyStack } from '../lib/stacks/amplify-stack';
import { LandingPageStack } from '../lib/stacks/landing-page-stack';
import { NewsScraperStack } from '../lib/stacks/news-scraper-stack';
import { InvestmentTrackerStack } from '../lib/stacks/investment-tracker-stack';

const app = new cdk.App();

const envName = (app.node.tryGetContext('env') ?? 'staging') as EnvName;
if (!['staging', 'production'].includes(envName)) {
  throw new Error(`Invalid env context: "${envName}". Use -c env=staging or -c env=production`);
}

const cfg = configs[envName];
const awsEnv = { account: cfg.account, region: cfg.region };

// ── Shared: IAM (manual deploy only — never via GHA) ────────────────────────
new IamStack(app, `tools-shared-iam-${envName}`, { cfg, env: awsEnv });

// Resolve the Amplify service role ARN from the well-known role name rather
// than via a cross-stack export. This avoids a hard dependency on the IAM
// stack being redeployed before any Amplify stack can be created.
const amplifyServiceRoleArn = `arn:aws:iam::${cfg.account}:role/tools-amplify-service-${envName}`;

// ── Shared: Cognito ──────────────────────────────────────────────────────────
const cognito = new CognitoStack(app, `tools-shared-cognito-${envName}`, { cfg, env: awsEnv });

// ── Shared: DNS / ACM ────────────────────────────────────────────────────────
new DnsStack(app, `tools-shared-dns-${envName}`, { cfg, env: awsEnv });

// ── Shared: Amplify hosting (one stack per app) ──────────────────────────────
const landingAmplify = new AmplifyStack(app, `tools-shared-amplify-${envName}`, {
  cfg,
  appName: 'landing-page',
  subdomain: 'tools',
  amplifyServiceRoleArn,
  exportPrefix: 'tools-shared-amplify',
  env: awsEnv,
});

const weatherAmplify = new AmplifyStack(app, `tools-shared-amplify-weather-${envName}`, {
  cfg,
  appName: 'weather-app',
  subdomain: 'weather',
  amplifyServiceRoleArn,
  exportPrefix: 'tools-shared-amplify-weather',
  env: awsEnv,
});

const financeAmplify = new AmplifyStack(app, `tools-shared-amplify-finance-${envName}`, {
  cfg,
  appName: 'finance-app',
  subdomain: 'finance',
  amplifyServiceRoleArn,
  exportPrefix: 'tools-shared-amplify-finance',
  env: awsEnv,
});

const investmentTrackerAmplify = new AmplifyStack(app, `tools-shared-amplify-invest-tracker-${envName}`, {
  cfg,
  appName: 'investment-tracker',
  subdomain: 'investments',
  amplifyServiceRoleArn,
  exportPrefix: 'tools-shared-amplify-invest-tracker',
  env: awsEnv,
});

// ── Shared: Monitoring ───────────────────────────────────────────────────────
new MonitoringStack(app, `tools-shared-monitoring-${envName}`, {
  cfg,
  amplifyAppIds: [
    landingAmplify.appId,
    weatherAmplify.appId,
    financeAmplify.appId,
    investmentTrackerAmplify.appId,
  ],
  env: awsEnv,
});

// ── App: landing-page SSM params ─────────────────────────────────────────────
new LandingPageStack(app, `tools-app-landing-page-${envName}`, {
  cfg,
  cognitoStack: cognito,
  env: awsEnv,
});

// ── App: news-scraper Lambda + EventBridge ───────────────────────────────────
new NewsScraperStack(app, `tools-app-news-scraper-${envName}`, { cfg, env: awsEnv });

/// ── App: investment-tracker (DynamoDB + S3 + Lambda API + SES inbound) ───────
new InvestmentTrackerStack(app, `tools-app-investment-tracker-${envName}`, {
  cfg,
  env: awsEnv,
});
