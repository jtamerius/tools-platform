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
import { AdventureBuilderStack } from '../lib/stacks/adventure-builder-stack';
import { SolarHailStack } from '../lib/stacks/solarhail-stack';

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
  // Preserve logical IDs from the legacy CFn template to prevent DELETE+CREATE on the Amplify app.
  ...(envName === 'production' ? {
    legacyAppLogicalId:    'LandingPageAmplifyApp',
    legacyBranchLogicalId: 'LandingPageAmplifyBranch',
    legacyDomainLogicalId: 'LandingPageAmplifyDomain',
    additionalSubdomains:  ['www', ''],
  } : {}),
});

const weatherAmplify = new AmplifyStack(app, `tools-shared-amplify-weather-${envName}`, {
  cfg,
  appName: 'weather-app',
  subdomain: 'weather',
  amplifyServiceRoleArn,
  exportPrefix: 'tools-shared-amplify-weather',
  env: awsEnv,
  // Preserve logical IDs from the legacy CFn template to prevent DELETE+CREATE on the Amplify app.
  ...(envName === 'production' ? {
    legacyAppLogicalId:    'WeatherAppAmplifyApp',
    legacyBranchLogicalId: 'WeatherAppAmplifyBranch',
    legacyDomainLogicalId: 'WeatherAppAmplifyDomain',
  } : {}),
});

const financeAmplify = new AmplifyStack(app, `tools-shared-amplify-finance-${envName}`, {
  cfg,
  appName: 'finance-app',
  subdomain: 'finance',
  amplifyServiceRoleArn,
  exportPrefix: 'tools-shared-amplify-finance',
  env: awsEnv,
  // Preserve logical IDs from the legacy CFn template to prevent DELETE+CREATE on the Amplify app.
  ...(envName === 'production' ? {
    legacyAppLogicalId:    'FinanceAppAmplifyApp',
    legacyBranchLogicalId: 'FinanceAppAmplifyBranch',
    legacyDomainLogicalId: 'FinanceAppAmplifyDomain',
  } : {}),
});

const investmentTrackerAmplify = new AmplifyStack(app, `tools-shared-amplify-invest-tracker-${envName}`, {
  cfg,
  appName: 'investment-tracker',
  subdomain: 'investments',
  amplifyServiceRoleArn,
  exportPrefix: 'tools-shared-amplify-invest-tracker',
  env: awsEnv,
});

const adventureBuilderAmplify = new AmplifyStack(app, `tools-shared-amplify-adventure-builder-${envName}`, {
  cfg,
  appName: 'adventure-builder',
  subdomain: 'adventure',
  amplifyServiceRoleArn,
  exportPrefix: 'tools-shared-amplify-adventure-builder',
  env: awsEnv,
});

const solarHailAmplify = new AmplifyStack(app, `tools-shared-amplify-solarhail-${envName}`, {
  cfg,
  appName: 'solarhail',
  subdomain: 'solarhail',
  amplifyServiceRoleArn,
  exportPrefix: 'tools-shared-amplify-solarhail',
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
    adventureBuilderAmplify.appId,
    solarHailAmplify.appId,
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

// ── App: adventure-builder (DynamoDB + Lambda API + Bedrock) ─────────────────
new AdventureBuilderStack(app, `tools-app-adventure-builder-${envName}`, {
  cfg,
  env: awsEnv,
});

// ── App: solarhail (S3 + Glue + Athena + Batch + Lambda API) ─────────────────
new SolarHailStack(app, `tools-app-solarhail-${envName}`, {
  cfg,
  env: awsEnv,
});

