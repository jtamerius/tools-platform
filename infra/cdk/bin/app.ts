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
import { MaritimePipelineStack } from '../lib/stacks/maritime-pipeline-stack';

const app = new cdk.App();

const envName = (app.node.tryGetContext('env') ?? 'staging') as EnvName;
if (!['staging', 'production'].includes(envName)) {
  throw new Error(`Invalid env context: "${envName}". Use -c env=staging or -c env=production`);
}

const cfg = configs[envName];
const awsEnv = { account: cfg.account, region: cfg.region };

// ── Shared: IAM (manual deploy only — never via GHA) ────────────────────────
const iam = new IamStack(app, `tools-shared-iam-${envName}`, { cfg, env: awsEnv });

// ── Shared: Cognito ──────────────────────────────────────────────────────────
const cognito = new CognitoStack(app, `tools-shared-cognito-${envName}`, { cfg, env: awsEnv });

// ── Shared: DNS / ACM ────────────────────────────────────────────────────────
new DnsStack(app, `tools-shared-dns-${envName}`, { cfg, env: awsEnv });

// ── Shared: Amplify hosting (one stack per app) ──────────────────────────────
const landingAmplify = new AmplifyStack(app, `tools-shared-amplify-${envName}`, {
  cfg,
  appName: 'landing-page',
  subdomain: 'tools',
  amplifyServiceRoleArn: iam.amplifyServiceRole.roleArn,
  exportPrefix: 'tools-shared-amplify',
  env: awsEnv,
});

const weatherAmplify = new AmplifyStack(app, `tools-shared-amplify-weather-${envName}`, {
  cfg,
  appName: 'weather-app',
  subdomain: 'weather',
  amplifyServiceRoleArn: iam.amplifyServiceRole.roleArn,
  exportPrefix: 'tools-shared-amplify-weather',
  env: awsEnv,
});

const financeAmplify = new AmplifyStack(app, `tools-shared-amplify-finance-${envName}`, {
  cfg,
  appName: 'finance-app',
  subdomain: 'finance',
  amplifyServiceRoleArn: iam.amplifyServiceRole.roleArn,
  exportPrefix: 'tools-shared-amplify-finance',
  env: awsEnv,
});


const maritimeAmplify = new AmplifyStack(app, `tools-shared-amplify-maritime-${envName}`, {
  cfg,
  appName: 'maritime-trajectory',
  subdomain: 'maritime',
  amplifyServiceRoleArn: iam.amplifyServiceRole.roleArn,
  exportPrefix: 'tools-shared-amplify-maritime',
  env: awsEnv,
});

// ── Shared: Monitoring ───────────────────────────────────────────────────────
new MonitoringStack(app, `tools-shared-monitoring-${envName}`, {
  cfg,
  amplifyAppIds: [
    landingAmplify.appId,
    weatherAmplify.appId,
    financeAmplify.appId,
    maritimeAmplify.appId,
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

// ── App: maritime-trajectory pipeline (S3, SageMaker, SFN, Lambda API, APIGW) ─
new MaritimePipelineStack(app, `tools-app-maritime-pipeline-${envName}`, { cfg, env: awsEnv });
