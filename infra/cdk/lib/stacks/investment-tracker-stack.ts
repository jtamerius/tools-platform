import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as ddb from 'aws-cdk-lib/aws-dynamodb';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as ses from 'aws-cdk-lib/aws-ses';
import * as sesActions from 'aws-cdk-lib/aws-ses-actions';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { ToolsEnvConfig } from '../config';
import { CognitoStack } from './cognito-stack';

export interface InvestmentTrackerStackProps extends cdk.StackProps {
  cfg: ToolsEnvConfig;
  cognitoStack: CognitoStack;
  /** Optional CORS origin override (e.g. 'https://investments.jtamerius.com'). */
  frontendOrigin?: string;
}

export class InvestmentTrackerStack extends cdk.Stack {
  public readonly apiUrl: string;

  constructor(scope: Construct, id: string, props: InvestmentTrackerStackProps) {
    super(scope, id, props);
    const { cfg, cognitoStack, frontendOrigin } = props;
    const e = cfg.env;
    const isProd = e === 'production';

    // Subdomain for all SES + API domains in production
    const appSubdomain = 'investments'; // investments.jtamerius.com

    // ── DynamoDB tables ──────────────────────────────────────────────────────
    const accountsTable = new ddb.Table(this, 'AccountsTable', {
      tableName: `tools-invest-tracker-accounts-${e}`,
      partitionKey: { name: 'userId', type: ddb.AttributeType.STRING },
      sortKey: { name: 'accountNumber', type: ddb.AttributeType.STRING },
      billingMode: ddb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: isProd },
    });

    const paymentsTable = new ddb.Table(this, 'PaymentsTable', {
      tableName: `tools-invest-tracker-payments-${e}`,
      partitionKey: { name: 'acctKey', type: ddb.AttributeType.STRING },
      sortKey: { name: 'interestPaidTo', type: ddb.AttributeType.STRING },
      billingMode: ddb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: isProd },
    });

    const cellOverridesTable = new ddb.Table(this, 'CellOverridesTable', {
      tableName: `tools-invest-tracker-cell-overrides-${e}`,
      partitionKey: { name: 'acctKey', type: ddb.AttributeType.STRING },
      sortKey: { name: 'yearMonth', type: ddb.AttributeType.STRING },
      billingMode: ddb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    const userEmailsTable = new ddb.Table(this, 'UserEmailsTable', {
      tableName: `tools-invest-tracker-user-emails-${e}`,
      partitionKey: { name: 'localPart', type: ddb.AttributeType.STRING },
      billingMode: ddb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });
    userEmailsTable.addGlobalSecondaryIndex({
      indexName: 'byUserId',
      partitionKey: { name: 'userId', type: ddb.AttributeType.STRING },
      projectionType: ddb.ProjectionType.ALL,
    });

    // ── S3: email/upload bucket ──────────────────────────────────────────────
    const emailBucket = new s3.Bucket(this, 'EmailBucket', {
      bucketName: `tools-invest-tracker-emails-${e}-${cfg.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: false,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: !isProd,
      lifecycleRules: [
        {
          id: 'ExpireInboundAfter180Days',
          enabled: true,
          prefix: '',
          expiration: cdk.Duration.days(180),
        },
      ],
    });

    // Allow SES to PutObject into ses-inbound/ prefix (production only; still fine to add policy in staging).
    emailBucket.addToResourcePolicy(new iam.PolicyStatement({
      sid: 'AllowSESPutInbound',
      principals: [new iam.ServicePrincipal('ses.amazonaws.com')],
      actions: ['s3:PutObject'],
      resources: [`${emailBucket.bucketArn}/ses-inbound/*`],
      conditions: {
        StringEquals: {
          'aws:Referer': cfg.account,
        },
      },
    }));

    // ── Parser Lambda (Python) ───────────────────────────────────────────────
    const parserFn = new lambda.Function(this, 'ParserFunction', {
      functionName: `tools-invest-tracker-parser-${e}`,
      description: 'Parses uploaded seller-statement .eml/.mbox files and writes to DynamoDB.',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../../../apps/investment-tracker-parser')),
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      environment: {
        ACCOUNTS_TABLE: accountsTable.tableName,
        PAYMENTS_TABLE: paymentsTable.tableName,
        USER_EMAILS_TABLE: userEmailsTable.tableName,
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
    });
    accountsTable.grantWriteData(parserFn);
    paymentsTable.grantWriteData(parserFn);
    userEmailsTable.grantReadData(parserFn);
    emailBucket.grantRead(parserFn);

    // Trigger parser on every upload to the bucket (any prefix).
    emailBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(parserFn),
    );

    // ── API Lambda (Node.js via NodejsFunction bundler) ──────────────────────
    const apiFn = new nodejs.NodejsFunction(this, 'ApiFunction', {
      functionName: `tools-invest-tracker-api-${e}`,
      description: 'Express API for the investment tracker (DynamoDB-backed).',
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../../../../apps/investment-tracker-api/src/handler.js'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        ACCOUNTS_TABLE: accountsTable.tableName,
        PAYMENTS_TABLE: paymentsTable.tableName,
        CELL_OVERRIDES_TABLE: cellOverridesTable.tableName,
        USER_EMAILS_TABLE: userEmailsTable.tableName,
        EMAIL_BUCKET: emailBucket.bucketName,
        EMAIL_DOMAIN: isProd
          ? `${appSubdomain}.${cfg.domainRoot}`
          : `${appSubdomain}-${e}.${cfg.domainRoot}`,
      },
      bundling: {
        externalModules: [], // bundle everything including @aws-sdk/*
        minify: true,
        sourceMap: false,
        target: 'node20',
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
    });
    accountsTable.grantReadWriteData(apiFn);
    paymentsTable.grantReadWriteData(apiFn);
    cellOverridesTable.grantReadWriteData(apiFn);
    userEmailsTable.grantReadWriteData(apiFn);
    emailBucket.grantPut(apiFn);

    // ── API Gateway v2 (HTTP API) + JWT authorizer ───────────────────────────
    const allowedOrigins: string[] = (() => {
      if (frontendOrigin) return [frontendOrigin, 'http://localhost:5173'];
      return isProd
        ? [`https://${appSubdomain}.${cfg.domainRoot}`, 'http://localhost:5173']
        : ['*'];
    })();

    const httpApi = new apigwv2.CfnApi(this, 'HttpApi', {
      name: `tools-invest-tracker-api-${e}`,
      description: 'Investment tracker API — protected by Cognito JWT.',
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
        audience: [cognitoStack.userPoolClient.userPoolClientId],
        issuer: `https://cognito-idp.${cfg.region}.amazonaws.com/${cognitoStack.userPool.userPoolId}`,
      },
    });

    const integration = new apigwv2.CfnIntegration(this, 'ApiIntegration', {
      apiId: httpApi.ref,
      integrationType: 'AWS_PROXY',
      integrationUri: apiFn.functionArn,
      payloadFormatVersion: '2.0',
    });

    // Every /api/* route → Lambda, with JWT authorizer.
    const route = new apigwv2.CfnRoute(this, 'ApiProxyRoute', {
      apiId: httpApi.ref,
      routeKey: 'ANY /api/{proxy+}',
      target: `integrations/${integration.ref}`,
      authorizationType: 'JWT',
      authorizerId: authorizer.ref,
    });

    // Unauthenticated health route for smoke-tests.
    const healthRoute = new apigwv2.CfnRoute(this, 'HealthRoute', {
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
      parameterName: `/tools/${e}/investment-tracker/api-url`,
      stringValue: this.apiUrl,
      description: `Investment tracker API URL (${e})`,
    });

    // ── SES Receipt Rule ─────────────────────────────────────────────────────
    const ruleSet = new ses.ReceiptRuleSet(this, 'SesRuleSet', {
      receiptRuleSetName: `tools-invest-tracker-${e}`,
    });

    const emailRecipient = isProd
      ? `${appSubdomain}.${cfg.domainRoot}`
      : `${appSubdomain}-${e}.${cfg.domainRoot}`;

    ruleSet.addRule('InboundToBucket', {
      recipients: [emailRecipient],
      enabled: true,
      scanEnabled: true,
      actions: [
        new sesActions.S3({
          bucket: emailBucket,
          objectKeyPrefix: 'ses-inbound/',
        }),
      ],
    });

    // ── Outputs ──────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: this.apiUrl,
      exportName: `tools-app-investment-tracker-${e}-ApiUrl`,
    });
    new cdk.CfnOutput(this, 'AccountsTableName', {
      value: accountsTable.tableName,
      exportName: `tools-app-investment-tracker-${e}-AccountsTable`,
    });
    new cdk.CfnOutput(this, 'PaymentsTableName', {
      value: paymentsTable.tableName,
      exportName: `tools-app-investment-tracker-${e}-PaymentsTable`,
    });
    new cdk.CfnOutput(this, 'EmailBucketName', {
      value: emailBucket.bucketName,
      exportName: `tools-app-investment-tracker-${e}-EmailBucket`,
    });

    cdk.Tags.of(this).add('Environment', e);
    cdk.Tags.of(this).add('Project', 'tools-platform');
    cdk.Tags.of(this).add('App', 'investment-tracker');
  }
}
