import * as path from 'path'; // noqa: bootstrap trigger
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ddb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { ToolsEnvConfig } from '../config';

export interface PurgatoryStackProps extends cdk.StackProps {
  cfg: ToolsEnvConfig;
}

/**
 * Purgatory Crowding Intelligence — Phase 1.0 + 1.1.
 *
 *  - S3 raw image bucket (lifecycle: Standard → Glacier IR @ 180 days, retain forever)
 *  - DynamoDB: ingest records, cam config, resort conditions, agent counter
 *  - ECR repo for the YOLO ingest container image
 *  - Lambda (container): ingest — fan-out trigger per cam every 15 min
 *  - Lambda (zip): resort scrape every 15 min
 *  - Lambda (zip): review-UI API behind API GW + Cognito JWT
 */
export class PurgatoryStack extends cdk.Stack {
  public readonly apiUrl: string;

  constructor(scope: Construct, id: string, props: PurgatoryStackProps) {
    super(scope, id, props);
    const { cfg } = props;
    const e = cfg.env;
    const isProd = e === 'production';

    const cognitoUserPoolId = ssm.StringParameter.valueFromLookup(this, `/tools/${e}/cognito/user-pool-id`);
    const cognitoUserPoolClientId = ssm.StringParameter.valueFromLookup(this, `/tools/${e}/cognito/client-id`);

    const appSubdomain = 'purg';

    // ── S3: raw image storage ───────────────────────────────────────────────
    const rawBucket = new s3.Bucket(this, 'RawBucket', {
      bucketName: `tools-purgatory-raw-${e}-${cfg.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: false,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: !isProd,
      lifecycleRules: [
        {
          id: 'TransitionToGlacierIRAfter180Days',
          enabled: true,
          prefix: 'raw/',
          transitions: [
            { storageClass: s3.StorageClass.GLACIER_INSTANT_RETRIEVAL, transitionAfter: cdk.Duration.days(180) },
          ],
        },
      ],
    });

    // ── DynamoDB tables ─────────────────────────────────────────────────────
    const ingestTable = new ddb.Table(this, 'IngestTable', {
      tableName: `tools-purgatory-ingest-${e}`,
      partitionKey: { name: 'pk', type: ddb.AttributeType.STRING },
      sortKey: { name: 'sk', type: ddb.AttributeType.STRING },
      billingMode: ddb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: isProd },
    });
    // GSI for queue scans: needs_review=true items, sorted by sk
    ingestTable.addGlobalSecondaryIndex({
      indexName: 'byNeedsReview',
      partitionKey: { name: 'needs_review_pk', type: ddb.AttributeType.STRING },
      sortKey: { name: 'sk', type: ddb.AttributeType.STRING },
      projectionType: ddb.ProjectionType.ALL,
    });

    const camConfigTable = new ddb.Table(this, 'CamConfigTable', {
      tableName: `tools-purgatory-cam-config-${e}`,
      partitionKey: { name: 'cam_id', type: ddb.AttributeType.STRING },
      billingMode: ddb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    const resortTable = new ddb.Table(this, 'ResortTable', {
      tableName: `tools-purgatory-resort-${e}`,
      partitionKey: { name: 'pk', type: ddb.AttributeType.STRING },
      sortKey: { name: 'sk', type: ddb.AttributeType.STRING },
      billingMode: ddb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: isProd },
    });

    const agentCounterTable = new ddb.Table(this, 'AgentCounterTable', {
      tableName: `tools-purgatory-agent-counter-${e}`,
      partitionKey: { name: 'pk', type: ddb.AttributeType.STRING },
      sortKey: { name: 'sk', type: ddb.AttributeType.STRING },
      billingMode: ddb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // ── ECR: ingest Lambda container image ──────────────────────────────────
    const ingestRepo = new ecr.Repository(this, 'IngestRepo', {
      repositoryName: `tools-purgatory-ingest-${e}`,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      lifecycleRules: [{ description: 'Keep last 5 images', maxImageCount: 5, rulePriority: 1 }],
    });

    // ── Ingest Lambda (container image) ─────────────────────────────────────
    // Image tag is overridden by the GHA workflow during deploys; we provision
    // with a placeholder tag here, expecting the CI pipeline to push an image
    // tagged 'latest' before the first invocation.
    const ingestLogGroup = new logs.LogGroup(this, 'IngestLogGroup', {
      logGroupName: `/aws/lambda/tools-purgatory-ingest-${e}`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });
    const ingestFn = new lambda.DockerImageFunction(this, 'IngestFunction', {
      functionName: `tools-purgatory-ingest-${e}`,
      description: `Purgatory traffic-cam ingest (${e}) — YOLO, RWIS, agent QC`,
      code: lambda.DockerImageCode.fromEcr(ingestRepo, { tagOrDigest: 'latest' }),
      timeout: cdk.Duration.seconds(60),
      memorySize: 3008,
      environment: {
        S3_BUCKET: rawBucket.bucketName,
        INGEST_TABLE: ingestTable.tableName,
        CAM_CONFIG_TABLE: camConfigTable.tableName,
        AGENT_COUNTER_TABLE: agentCounterTable.tableName,
        BEDROCK_MODEL_ID: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
        BEDROCK_REGION: cfg.region,
        AGENT_MONTHLY_CAP: '200',
        AGENT_PROMPT_VERSION: 'v1',
        LOG_LEVEL: 'INFO',
      },
      logGroup: ingestLogGroup,
    });
    rawBucket.grantReadWrite(ingestFn);
    ingestTable.grantReadWriteData(ingestFn);
    camConfigTable.grantReadData(ingestFn);
    agentCounterTable.grantReadWriteData(ingestFn);
    ingestFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: [`arn:aws:bedrock:${cfg.region}::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0`],
    }));
    // Allow self-invoke for fan-out — use literal ARN to avoid CDK circular dependency
    // (grantInvoke(ingestFn) embeds the function's CFn token into its own role policy)
    ingestFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['lambda:InvokeFunction'],
      resources: [`arn:aws:lambda:${cfg.region}:${cfg.account}:function:tools-purgatory-ingest-${e}`],
    }));

    // ── EventBridge: every 15 minutes → ingest fanout (no payload) ──────────
    new events.Rule(this, 'IngestSchedule', {
      ruleName: `tools-purgatory-ingest-${e}`,
      description: `Every 15 minutes — Purgatory cam ingest fanout (${e})`,
      schedule: events.Schedule.rate(cdk.Duration.minutes(15)),
      targets: [new targets.LambdaFunction(ingestFn, {
        event: events.RuleTargetInput.fromObject({}),
      })],
    });

    // ── Scrape Lambda (Python zip) ──────────────────────────────────────────
    const scrapeFn = new lambda.Function(this, 'ScrapeFunction', {
      functionName: `tools-purgatory-scrape-${e}`,
      description: `Purgatory resort scrape (${e}) — current conditions + forecast`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'src.handler.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../../../apps/purgatory/scrape'), {
        bundling: {
          image: lambda.Runtime.PYTHON_3_12.bundlingImage,
          command: [
            'bash', '-c',
            'pip install --no-cache-dir -r requirements.txt -t /asset-output && cp -r . /asset-output/',
          ],
        },
      }),
      timeout: cdk.Duration.seconds(60),
      memorySize: 512,
      environment: {
        RESORT_TABLE: resortTable.tableName,
        LOG_LEVEL: 'INFO',
      },
      logGroup: new logs.LogGroup(this, 'ScrapeLogGroup', {
        logGroupName: `/aws/lambda/tools-purgatory-scrape-${e}`,
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      }),
    });
    resortTable.grantReadWriteData(scrapeFn);

    new events.Rule(this, 'ScrapeSchedule', {
      ruleName: `tools-purgatory-scrape-${e}`,
      description: `Every 15 minutes — Purgatory resort scrape (${e})`,
      schedule: events.Schedule.rate(cdk.Duration.minutes(15)),
      targets: [new targets.LambdaFunction(scrapeFn)],
    });

    // ── Review-UI API Lambda + API Gateway ──────────────────────────────────
    const apiFn = new lambda.Function(this, 'ApiFunction', {
      functionName: `tools-purgatory-api-${e}`,
      description: `Purgatory review-UI API (${e})`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../../../apps/purgatory/api'), {
        bundling: {
          image: lambda.Runtime.PYTHON_3_12.bundlingImage,
          command: [
            'bash', '-c',
            'pip install --no-cache-dir -r requirements.txt -t /asset-output && cp -r . /asset-output/',
          ],
        },
      }),
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        INGEST_TABLE: ingestTable.tableName,
        RESORT_TABLE: resortTable.tableName,
        CAM_CONFIG_TABLE: camConfigTable.tableName,
        S3_BUCKET: rawBucket.bucketName,
        ALLOWED_ORIGINS: isProd
          ? `https://${appSubdomain}.${cfg.domainRoot},http://localhost:5173`
          : '*',
      },
      logGroup: new logs.LogGroup(this, 'ApiLogGroup', {
        logGroupName: `/aws/lambda/tools-purgatory-api-${e}`,
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      }),
    });
    ingestTable.grantReadWriteData(apiFn);
    resortTable.grantReadData(apiFn);
    camConfigTable.grantReadData(apiFn);
    rawBucket.grantRead(apiFn);

    const allowedOrigins = isProd
      ? [`https://${appSubdomain}.${cfg.domainRoot}`, 'http://localhost:5173']
      : ['*'];

    const httpApi = new apigwv2.CfnApi(this, 'HttpApi', {
      name: `tools-purgatory-api-${e}`,
      description: 'Purgatory review-UI API — Cognito JWT protected.',
      protocolType: 'HTTP',
      corsConfiguration: {
        allowOrigins: allowedOrigins,
        allowMethods: ['GET', 'POST', 'OPTIONS'],
        allowHeaders: ['Content-Type', 'Authorization'],
        allowCredentials: false,
        maxAge: 300,
      },
    });

    const authorizer = new apigwv2.CfnAuthorizer(this, 'CognitoAuthorizer', {
      apiId: httpApi.ref,
      authorizerType: 'JWT',
      identitySource: ['$request.header.Authorization'],
      name: 'CognitoJwt',
      jwtConfiguration: {
        audience: [cognitoUserPoolClientId],
        issuer: `https://cognito-idp.${cfg.region}.amazonaws.com/${cognitoUserPoolId}`,
      },
    });

    const integration = new apigwv2.CfnIntegration(this, 'ApiIntegration', {
      apiId: httpApi.ref,
      integrationType: 'AWS_PROXY',
      integrationUri: apiFn.functionArn,
      payloadFormatVersion: '2.0',
    });

    for (const route of [
      'GET /api/queue', 'GET /api/search', 'GET /api/image',
      'GET /api/neighbors', 'GET /api/history', 'POST /api/decisions',
    ]) {
      new apigwv2.CfnRoute(this, `Route-${route.replace(/[^a-zA-Z0-9]/g, '')}`, {
        apiId: httpApi.ref,
        routeKey: route,
        target: `integrations/${integration.ref}`,
        authorizationType: 'JWT',
        authorizerId: authorizer.ref,
      });
    }

    // OPTIONS preflight + health unauth
    new apigwv2.CfnRoute(this, 'OptionsRoute', {
      apiId: httpApi.ref,
      routeKey: 'OPTIONS /api/{proxy+}',
      target: `integrations/${integration.ref}`,
    });
    new apigwv2.CfnRoute(this, 'HealthRoute', {
      apiId: httpApi.ref,
      routeKey: 'GET /health',
      target: `integrations/${integration.ref}`,
    });

    new apigwv2.CfnStage(this, 'ApiStage', {
      apiId: httpApi.ref,
      stageName: '$default',
      autoDeploy: true,
    });

    new lambda.CfnPermission(this, 'ApiInvokePermission', {
      functionName: apiFn.functionArn,
      action: 'lambda:InvokeFunction',
      principal: 'apigateway.amazonaws.com',
      sourceArn: `arn:aws:execute-api:${cfg.region}:${cfg.account}:${httpApi.ref}/*/*`,
    });

    this.apiUrl = `https://${httpApi.ref}.execute-api.${cfg.region}.amazonaws.com`;

    // ── SSM publish ─────────────────────────────────────────────────────────
    new ssm.StringParameter(this, 'SSMApiUrl', {
      parameterName: `/tools/${e}/purgatory/api-url`,
      stringValue: this.apiUrl,
      description: `Purgatory review-UI API URL (${e})`,
    });
    new ssm.StringParameter(this, 'SSMRawBucket', {
      parameterName: `/tools/${e}/purgatory/raw-bucket`,
      stringValue: rawBucket.bucketName,
    });
    new ssm.StringParameter(this, 'SSMIngestTable', {
      parameterName: `/tools/${e}/purgatory/ingest-table`,
      stringValue: ingestTable.tableName,
    });
    new ssm.StringParameter(this, 'SSMCamConfigTable', {
      parameterName: `/tools/${e}/purgatory/cam-config-table`,
      stringValue: camConfigTable.tableName,
    });
    new ssm.StringParameter(this, 'SSMResortTable', {
      parameterName: `/tools/${e}/purgatory/resort-table`,
      stringValue: resortTable.tableName,
    });
    new ssm.StringParameter(this, 'SSMEcrIngest', {
      parameterName: `/tools/${e}/purgatory/ingest-ecr-uri`,
      stringValue: ingestRepo.repositoryUri,
    });

    // ── Outputs ─────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: this.apiUrl,
      exportName: `tools-app-purgatory-${e}-ApiUrl`,
    });
    new cdk.CfnOutput(this, 'RawBucketName', {
      value: rawBucket.bucketName,
      exportName: `tools-app-purgatory-${e}-RawBucket`,
    });
    new cdk.CfnOutput(this, 'IngestEcrUri', {
      value: ingestRepo.repositoryUri,
      exportName: `tools-app-purgatory-${e}-IngestEcrUri`,
    });
    new cdk.CfnOutput(this, 'IngestFunctionName', {
      value: ingestFn.functionName,
      exportName: `tools-app-purgatory-${e}-IngestFn`,
    });

    cdk.Tags.of(this).add('Environment', e);
    cdk.Tags.of(this).add('Project', 'tools-platform');
    cdk.Tags.of(this).add('App', 'purgatory');
  }
}
