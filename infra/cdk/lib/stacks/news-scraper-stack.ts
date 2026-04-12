import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as events from 'aws-cdk-lib/aws-events';
import * as eventsTargets from 'aws-cdk-lib/aws-events-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { ToolsEnvConfig } from '../config';

export interface NewsScraperStackProps extends cdk.StackProps {
  cfg: ToolsEnvConfig;
}

export class NewsScraperStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: NewsScraperStackProps) {
    super(scope, id, props);
    const { cfg } = props;
    const e = cfg.env;

    // ── IAM: scraper Lambda role ─────────────────────────────────────────────
    const executionRole = new iam.Role(this, 'NewsScraperLambdaRole', {
      roleName: `jtamerius-news-scraper-lambda-${e}`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });
    (executionRole.node.defaultChild as iam.CfnRole).overrideLogicalId('NewsScraperLambdaRole');

    executionRole.addToPolicy(new iam.PolicyStatement({
      sid: 'SSMReadLLMKeys',
      actions: ['ssm:GetParameter'],
      resources: [
        `arn:aws:ssm:${cfg.region}:${cfg.account}:parameter/tools/news-scraper/groq-api-key`,
        `arn:aws:ssm:${cfg.region}:${cfg.account}:parameter/tools/news-scraper/gemini-api-key`,
        `arn:aws:ssm:${cfg.region}:${cfg.account}:parameter/tools/news-scraper/hf-api-key`,
        `arn:aws:ssm:${cfg.region}:${cfg.account}:parameter/tools/news-scraper/openrouter-api-key`,
      ],
    }));

    executionRole.addToPolicy(new iam.PolicyStatement({
      sid: 'S3Upload',
      actions: ['s3:PutObject', 's3:GetObject'],
      resources: ['arn:aws:s3:::jtamerius-news-data/*'],
    }));

    const deployBucket = s3.Bucket.fromBucketName(this, 'DeployBucket', 'jtamerius-website-deploy');

    // ── CloudWatch: scraper log group ────────────────────────────────────────
    const logGroup = new logs.LogGroup(this, 'NewsScraperLogGroup', {
      logGroupName: `/aws/lambda/jtamerius-news-scraper-${e}`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    (logGroup.node.defaultChild as logs.CfnLogGroup).overrideLogicalId('NewsScraperLogGroup');

    // ── Lambda: scraper ──────────────────────────────────────────────────────
    const fn = new lambda.Function(this, 'NewsScraperFunction', {
      functionName: `jtamerius-news-scraper-${e}`,
      description: 'Scrapes top news headlines from 96 countries and uploads to S3',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'lambda_function.handler',
      role: executionRole,
      memorySize: 512,
      timeout: cdk.Duration.seconds(600),
      code: lambda.Code.fromBucket(deployBucket, 'news-scraper/lambda_package.zip'),
      environment: {
        S3_BUCKET: 'jtamerius-news-data',
        S3_KEY: 'latest.json',
      },
      logGroup,
    });
    (fn.node.defaultChild as lambda.CfnFunction).overrideLogicalId('NewsScraperFunction');

    const schedule = new events.Rule(this, 'NewsScraperSchedule', {
      ruleName: `jtamerius-news-scraper-daily-${e}`,
      description: 'Trigger news scraper Lambda daily at 23:00 UTC',
      schedule: events.Schedule.cron({ minute: '0', hour: '23' }),
      enabled: true,
    });
    (schedule.node.defaultChild as events.CfnRule).overrideLogicalId('NewsScraperSchedule');
    schedule.addTarget(new eventsTargets.LambdaFunction(fn));

    // ── IAM: recategorize Lambda role ────────────────────────────────────────
    const recatRole = new iam.Role(this, 'RecategorizeRole', {
      roleName: `jtamerius-news-recategorize-lambda-${e}`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });
    recatRole.addToPolicy(new iam.PolicyStatement({
      sid: 'SSMReadGroqKey',
      actions: ['ssm:GetParameter'],
      resources: [
        `arn:aws:ssm:${cfg.region}:${cfg.account}:parameter/tools/news-scraper/groq-api-key`,
      ],
    }));

    // ── Lambda: recategorize ─────────────────────────────────────────────────
    const recatFn = new lambda.Function(this, 'RecategorizeFunction', {
      functionName: `jtamerius-news-recategorize-${e}`,
      description: 'Applies a user AI prompt to news headlines and returns category overrides',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'handler.handler',
      role: recatRole,
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../../../../apps/news-scraper/recategorize'),
      ),
    });

    // ── API Gateway v2: recategorize HTTP API ────────────────────────────────
    const api = new apigwv2.CfnApi(this, 'RecategorizeApi', {
      name: `jtamerius-news-recategorize-${e}`,
      description: 'Accepts a user prompt + headlines, returns AI category overrides.',
      protocolType: 'HTTP',
      corsConfiguration: {
        allowOrigins: ['*'],
        allowMethods: ['POST', 'OPTIONS'],
        allowHeaders: ['Content-Type'],
        maxAge: 300,
      },
    });

    const integration = new apigwv2.CfnIntegration(this, 'RecategorizeIntegration', {
      apiId: api.ref,
      integrationType: 'AWS_PROXY',
      integrationUri: recatFn.functionArn,
      payloadFormatVersion: '2.0',
    });

    new apigwv2.CfnRoute(this, 'RecategorizeRoute', {
      apiId: api.ref,
      routeKey: 'POST /recategorize',
      target: `integrations/${integration.ref}`,
    });

    new apigwv2.CfnStage(this, 'RecategorizeStage', {
      apiId: api.ref,
      stageName: '$default',
      autoDeploy: true,
    });

    new lambda.CfnPermission(this, 'RecategorizeApiPermission', {
      functionName: recatFn.functionArn,
      action: 'lambda:InvokeFunction',
      principal: 'apigateway.amazonaws.com',
      sourceArn: `arn:aws:execute-api:${cfg.region}:${cfg.account}:${api.ref}/*/*`,
    });

    // ── SSM: recategorize API URL ────────────────────────────────────────────
    const recatApiUrl = `https://${api.ref}.execute-api.${cfg.region}.amazonaws.com`;

    new ssm.StringParameter(this, 'SSMRecategorizeApiUrl', {
      parameterName: `/tools/${e}/news-scraper/recategorize-api-url`,
      stringValue: recatApiUrl,
      description: `News recategorize API URL (${e})`,
    });

    // ── Outputs ───────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'FunctionName', {
      value: fn.functionName,
      exportName: `tools-app-news-scraper-${e}-FunctionName`,
    });

    new cdk.CfnOutput(this, 'FunctionArn', {
      value: fn.functionArn,
      exportName: `tools-app-news-scraper-${e}-FunctionArn`,
    });

    new cdk.CfnOutput(this, 'RecategorizeApiUrl', {
      value: recatApiUrl,
      exportName: `tools-app-news-scraper-${e}-RecategorizeApiUrl`,
    });

    cdk.Tags.of(this).add('Environment', e);
    cdk.Tags.of(this).add('Project', 'tools-platform');
  }
}
