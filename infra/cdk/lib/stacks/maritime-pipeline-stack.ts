import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { ToolsEnvConfig } from '../config';

export interface MaritimePipelineStackProps extends cdk.StackProps {
  cfg: ToolsEnvConfig;
}

export class MaritimePipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MaritimePipelineStackProps) {
    super(scope, id, props);
    const { cfg } = props;
    const e = cfg.env;

    // ── S3: AIS input bucket ─────────────────────────────────────────────────
    const aisInputBucket = new s3.Bucket(this, 'AisInputBucket', {
      bucketName: `tools-maritime-ais-input-${e}-${cfg.account}`,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          id: 'ArchiveRawAfter90Days',
          enabled: true,
          prefix: 'raw/',
          transitions: [
            {
              transitionAfter: cdk.Duration.days(90),
              storageClass: s3.StorageClass.GLACIER_INSTANT_RETRIEVAL,
            },
          ],
        },
      ],
    });

    // ── S3: Processed output bucket ──────────────────────────────────────────
    const processedOutputBucket = new s3.Bucket(this, 'ProcessedOutputBucket', {
      bucketName: `tools-maritime-processed-${e}-${cfg.account}`,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          id: 'ExpireOldRecordsAfter365Days',
          enabled: true,
          prefix: 'master-record/',
          expiration: cdk.Duration.days(365),
        },
      ],
    });

    // ── IAM: ETL Lambda execution role ───────────────────────────────────────
    const etlLambdaRole = new iam.Role(this, 'EtlLambdaExecutionRole', {
      roleName: `tools-maritime-etl-lambda-${e}`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });
    etlLambdaRole.addToPolicy(new iam.PolicyStatement({
      sid: 'ReadAisInput',
      actions: ['s3:GetObject', 's3:ListBucket'],
      resources: [aisInputBucket.bucketArn, `${aisInputBucket.bucketArn}/*`],
    }));
    etlLambdaRole.addToPolicy(new iam.PolicyStatement({
      sid: 'WriteProcessedOutput',
      actions: ['s3:PutObject', 's3:GetObject', 's3:ListBucket', 's3:DeleteObject'],
      resources: [processedOutputBucket.bucketArn, `${processedOutputBucket.bucketArn}/*`],
    }));

    // ── IAM: Dataset API Lambda execution role ───────────────────────────────
    const datasetLambdaRole = new iam.Role(this, 'LambdaExecutionRole', {
      roleName: `tools-maritime-lambda-${e}`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });
    datasetLambdaRole.addToPolicy(new iam.PolicyStatement({
      sid: 'ReadProcessedOutput',
      actions: ['s3:GetObject', 's3:ListBucket'],
      resources: [processedOutputBucket.bucketArn, `${processedOutputBucket.bucketArn}/*`],
    }));

    // ── Lambda: ETL pipeline function ────────────────────────────────────────
    const sdkPandasLayer = lambda.LayerVersion.fromLayerVersionArn(
      this, 'AWSSDKPandasLayer',
      `arn:aws:lambda:${cfg.region}:336392948345:layer:AWSSDKPandas-Python311:21`,
    );

    const etlFn = new lambda.Function(this, 'EtlPipelineFunction', {
      functionName: `tools-maritime-etl-pipeline-${e}`,
      description: 'Reads AIS CSVs + AVIS metadata from S3, cleans/merges/segments, writes partitioned Parquet.',
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'lambda_handler.handler',
      role: etlLambdaRole,
      timeout: cdk.Duration.minutes(15),
      memorySize: 3008,
      layers: [sdkPandasLayer],
      environment: {
        INPUT_BUCKET: aisInputBucket.bucketName,
        OUTPUT_BUCKET: processedOutputBucket.bucketName,
      },
      code: lambda.Code.fromAsset(path.join(__dirname, '../../../../src/processing')),
    });

    // ── EventBridge: Daily ETL trigger (DISABLED — enable after bootstrap) ───
    const etlScheduleRule = new cdk.aws_events.CfnRule(this, 'DailyPipelineSchedule', {
      name: `tools-maritime-daily-pipeline-${e}`,
      description: 'Triggers the maritime AIS ETL Lambda at 02:00 UTC daily. Disabled until bootstrapped.',
      scheduleExpression: 'cron(0 2 * * ? *)',
      state: 'DISABLED',
      targets: [
        {
          id: 'EtlPipelineTarget',
          arn: etlFn.functionArn,
        },
      ],
    });

    new lambda.CfnPermission(this, 'EtlScheduleLambdaPermission', {
      functionName: etlFn.functionArn,
      action: 'lambda:InvokeFunction',
      principal: 'events.amazonaws.com',
      sourceArn: etlScheduleRule.attrArn,
    });

    // ── Lambda: Dataset API function ─────────────────────────────────────────
    const datasetFn = new lambda.Function(this, 'DatasetApiFunction', {
      functionName: `tools-maritime-dataset-api-${e}`,
      description: 'Reads Maritime Master Record Parquet partitions and returns JSON.',
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'index.handler',
      role: datasetLambdaRole,
      timeout: cdk.Duration.seconds(60),
      memorySize: 512,
      layers: [sdkPandasLayer],
      environment: { BUCKET: processedOutputBucket.bucketName },
      code: lambda.Code.fromInline([
        'import json, os, boto3',
        'BUCKET = os.environ["BUCKET"]',
        'def handler(event, context):',
        '    route = event.get("routeKey", "")',
        '    params = event.get("pathParameters") or {}',
        '    qs = event.get("queryStringParameters") or {}',
        '    if route == "GET /datasets": return list_groups()',
        '    if route == "GET /datasets/{group}": return get_group(params.get("group", ""), int(qs.get("limit", 100)))',
        '    return resp(404, {"error": "Route not found"})',
        'def list_groups():',
        '    r = boto3.client("s3").list_objects_v2(Bucket=BUCKET, Prefix="master-record/", Delimiter="/")',
        '    groups = sorted(cp["Prefix"].rstrip("/").split("VesselGroup=")[-1] for cp in r.get("CommonPrefixes", []))',
        '    return resp(200, {"groups": groups})',
        'def get_group(group, limit):',
        '    import awswrangler as wr',
        '    try:',
        '        df = wr.s3.read_parquet(f"s3://{BUCKET}/master-record/VesselGroup={group}/").head(limit)',
        '        for c in df.select_dtypes(include=["datetime64[ns]", "datetimetz"]).columns: df[c] = df[c].astype(str)',
        '        return resp(200, {"group": group, "columns": list(df.columns), "rows": df.to_dict("records"), "count": len(df)})',
        '    except Exception as exc:',
        '        return resp(404, {"error": str(exc)})',
        'def resp(code, body):',
        '    return {"statusCode": code, "headers": {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}, "body": json.dumps(body, default=str)}',
      ].join('\n')),
    });

    // ── API Gateway v2: HTTP API ─────────────────────────────────────────────
    const httpApi = new apigwv2.CfnApi(this, 'DatasetHttpApi', {
      name: `tools-maritime-api-${e}`,
      description: 'Maritime dataset API — lists and reads Master Record partitions.',
      protocolType: 'HTTP',
      corsConfiguration: {
        allowOrigins: e === 'production' ? ['https://maritime.jtamerius.com'] : ['*'],
        allowMethods: ['GET', 'OPTIONS'],
        allowHeaders: ['Content-Type', 'Authorization'],
        maxAge: 300,
      },
    });

    const integration = new apigwv2.CfnIntegration(this, 'DatasetApiIntegration', {
      apiId: httpApi.ref,
      integrationType: 'AWS_PROXY',
      integrationUri: datasetFn.functionArn,
      payloadFormatVersion: '2.0',
    });

    new apigwv2.CfnRoute(this, 'DatasetListRoute', {
      apiId: httpApi.ref,
      routeKey: 'GET /datasets',
      target: `integrations/${integration.ref}`,
    });

    new apigwv2.CfnRoute(this, 'DatasetGroupRoute', {
      apiId: httpApi.ref,
      routeKey: 'GET /datasets/{group}',
      target: `integrations/${integration.ref}`,
    });

    new apigwv2.CfnStage(this, 'DatasetApiStage', {
      apiId: httpApi.ref,
      stageName: '$default',
      autoDeploy: true,
    });

    new lambda.CfnPermission(this, 'DatasetApiLambdaPermission', {
      functionName: datasetFn.functionArn,
      action: 'lambda:InvokeFunction',
      principal: 'apigateway.amazonaws.com',
      sourceArn: `arn:aws:execute-api:${cfg.region}:${cfg.account}:${httpApi.ref}/*/*`,
    });

    // ── SSM: Runtime configuration ────────────────────────────────────────────
    new ssm.StringParameter(this, 'SSMInputBucket', {
      parameterName: `/tools/${e}/maritime/ais-input-bucket`,
      stringValue: aisInputBucket.bucketName,
      description: `Raw AIS input S3 bucket (${e})`,
    });

    new ssm.StringParameter(this, 'SSMOutputBucket', {
      parameterName: `/tools/${e}/maritime/processed-output-bucket`,
      stringValue: processedOutputBucket.bucketName,
      description: `Processed Maritime Master Record S3 bucket (${e})`,
    });

    new ssm.StringParameter(this, 'SSMEtlFunctionName', {
      parameterName: `/tools/${e}/maritime/etl-function-name`,
      stringValue: etlFn.functionName,
      description: `Maritime ETL Lambda function name (${e})`,
    });

    const apiUrl = `https://${httpApi.ref}.execute-api.${cfg.region}.amazonaws.com`;

    new ssm.StringParameter(this, 'SSMApiUrl', {
      parameterName: `/tools/${e}/maritime/api-url`,
      stringValue: apiUrl,
      description: `Maritime dataset API Gateway URL (${e})`,
    });

    // ── Outputs ───────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'AisInputBucketName', {
      value: aisInputBucket.bucketName,
      exportName: `tools-app-maritime-pipeline-${e}-AisInputBucketName`,
    });
    new cdk.CfnOutput(this, 'ProcessedOutputBucketName', {
      value: processedOutputBucket.bucketName,
      exportName: `tools-app-maritime-pipeline-${e}-ProcessedOutputBucketName`,
    });
    new cdk.CfnOutput(this, 'EtlFunctionName', {
      value: etlFn.functionName,
      exportName: `tools-app-maritime-pipeline-${e}-EtlFunctionName`,
    });
    new cdk.CfnOutput(this, 'DatasetApiUrl', {
      value: apiUrl,
      exportName: `tools-app-maritime-pipeline-${e}-DatasetApiUrl`,
    });

    cdk.Tags.of(this).add('Environment', e);
    cdk.Tags.of(this).add('Project', 'tools-platform');
    cdk.Tags.of(this).add('App', 'maritime-trajectory');
  }
}
