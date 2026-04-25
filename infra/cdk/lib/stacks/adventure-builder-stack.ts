import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as ddb from 'aws-cdk-lib/aws-dynamodb';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { ToolsEnvConfig } from '../config';

export interface AdventureBuilderStackProps extends cdk.StackProps {
  cfg: ToolsEnvConfig;
}

export class AdventureBuilderStack extends cdk.Stack {
  public readonly apiUrl: string;

  constructor(scope: Construct, id: string, props: AdventureBuilderStackProps) {
    super(scope, id, props);
    const { cfg } = props;
    const cognitoUserPoolId = ssm.StringParameter.valueFromLookup(this, `/tools/${cfg.env}/cognito/user-pool-id`);
    const cognitoUserPoolClientId = ssm.StringParameter.valueFromLookup(this, `/tools/${cfg.env}/cognito/client-id`);
    const e = cfg.env;
    const isProd = e === 'production';

    // ── DynamoDB single table ────────────────────────────────────────────────
    const table = new ddb.Table(this, 'Table', {
      tableName: `tools-adventure-builder-${e}`,
      partitionKey: { name: 'PK', type: ddb.AttributeType.STRING },
      sortKey:      { name: 'SK', type: ddb.AttributeType.STRING },
      billingMode: ddb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: isProd },
    });

    // GSI for fetching all pages of a story
    table.addGlobalSecondaryIndex({
      indexName: 'storyId-index',
      partitionKey: { name: 'storyId', type: ddb.AttributeType.STRING },
      sortKey:      { name: 'SK',      type: ddb.AttributeType.STRING },
      projectionType: ddb.ProjectionType.ALL,
    });

    // ── API Lambda (Node.js) ─────────────────────────────────────────────────
    const apiFn = new nodejs.NodejsFunction(this, 'ApiFunction', {
      functionName: `tools-adventure-builder-api-${e}`,
      description: 'Express API for the adventure builder (DynamoDB + Bedrock).',
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../../../../apps/adventure-builder-api/src/handler.js'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        TABLE_NAME: table.tableName,
        BEDROCK_MODEL_ID: 'amazon.nova-lite-v1:0',
        BEDROCK_REGION: cfg.region,
      },
      depsLockFilePath: path.join(__dirname, '../../package-lock.json'),
      bundling: {
        externalModules: ['@aws-sdk/*'],
        nodeModules: ['express', 'cors', '@vendia/serverless-express'],
        minify: false,
        sourceMap: false,
        target: 'node20',
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    table.grantReadWriteData(apiFn);

    // Bedrock InvokeModel permission for Nova Lite
    apiFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: [`arn:aws:bedrock:${cfg.region}::foundation-model/amazon.nova-lite-v1:0`],
    }));

    // ── API Gateway v2 (HTTP API) + JWT authorizer ───────────────────────────
    const allowedOrigins = isProd
      ? [`https://adventure.${cfg.domainRoot}`, 'http://localhost:5173']
      : ['*'];

    const httpApi = new apigwv2.CfnApi(this, 'HttpApi', {
      name: `tools-adventure-builder-api-${e}`,
      description: 'Adventure builder API — protected by Cognito JWT.',
      protocolType: 'HTTP',
      corsConfiguration: {
        allowOrigins: allowedOrigins,
        allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
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

    new apigwv2.CfnRoute(this, 'ApiProxyRoute', {
      apiId: httpApi.ref,
      routeKey: 'ANY /api/{proxy+}',
      target: `integrations/${integration.ref}`,
      authorizationType: 'JWT',
      authorizerId: authorizer.ref,
    });

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

    new ssm.StringParameter(this, 'SSMApiUrl', {
      parameterName: `/tools/${e}/adventure-builder/api-url`,
      stringValue: this.apiUrl,
      description: `Adventure builder API URL (${e})`,
    });

    // ── Outputs ──────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: this.apiUrl,
      exportName: `tools-app-adventure-builder-${e}-ApiUrl`,
    });
    new cdk.CfnOutput(this, 'TableName', {
      value: table.tableName,
      exportName: `tools-app-adventure-builder-${e}-TableName`,
    });
  }
}
