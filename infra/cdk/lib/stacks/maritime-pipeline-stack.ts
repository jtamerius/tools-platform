import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
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

    // ── IAM: SageMaker execution role ────────────────────────────────────────
    const sageMakerRole = new iam.Role(this, 'SageMakerExecutionRole', {
      roleName: `tools-maritime-sagemaker-${e}`,
      assumedBy: new iam.ServicePrincipal('sagemaker.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSageMakerFullAccess'),
      ],
    });
    sageMakerRole.addToPolicy(new iam.PolicyStatement({
      sid: 'ReadAisInput',
      actions: ['s3:GetObject', 's3:ListBucket'],
      resources: [aisInputBucket.bucketArn, `${aisInputBucket.bucketArn}/*`],
    }));
    sageMakerRole.addToPolicy(new iam.PolicyStatement({
      sid: 'WriteProcessedOutput',
      actions: ['s3:PutObject', 's3:GetObject', 's3:ListBucket'],
      resources: [processedOutputBucket.bucketArn, `${processedOutputBucket.bucketArn}/*`],
    }));

    // ── IAM: Step Functions execution role ───────────────────────────────────
    const sfnRole = new iam.Role(this, 'StepFunctionsExecutionRole', {
      roleName: `tools-maritime-sfn-${e}`,
      assumedBy: new iam.ServicePrincipal(`states.${cfg.region}.amazonaws.com`),
    });
    sfnRole.addToPolicy(new iam.PolicyStatement({
      sid: 'CreateAndMonitorProcessingJobs',
      actions: [
        'sagemaker:CreateProcessingJob',
        'sagemaker:DescribeProcessingJob',
        'sagemaker:StopProcessingJob',
        'sagemaker:ListProcessingJobs',
        'sagemaker:AddTags',
      ],
      resources: ['*'],
    }));
    sfnRole.addToPolicy(new iam.PolicyStatement({
      sid: 'PassRoleToSageMaker',
      actions: ['iam:PassRole'],
      resources: [sageMakerRole.roleArn],
      conditions: {
        StringEquals: { 'iam:PassedToService': 'sagemaker.amazonaws.com' },
      },
    }));
    sfnRole.addToPolicy(new iam.PolicyStatement({
      sid: 'WriteExecutionLogs',
      actions: [
        'logs:CreateLogDelivery', 'logs:GetLogDelivery', 'logs:UpdateLogDelivery',
        'logs:DeleteLogDelivery', 'logs:ListLogDeliveries',
        'logs:PutResourcePolicy', 'logs:DescribeResourcePolicies', 'logs:DescribeLogGroups',
      ],
      resources: ['*'],
    }));
    sfnRole.addToPolicy(new iam.PolicyStatement({
      sid: 'XRayAccess',
      actions: [
        'xray:PutTraceSegments', 'xray:PutTelemetryRecords',
        'xray:GetSamplingRules', 'xray:GetSamplingTargets',
      ],
      resources: ['*'],
    }));
    // Required for .sync integration: SFN creates an EventBridge managed rule
    // to receive completion events from SageMaker Processing Jobs.
    sfnRole.addToPolicy(new iam.PolicyStatement({
      sid: 'EventBridgeManagedRules',
      actions: [
        'events:PutRule', 'events:PutTargets',
        'events:DescribeRule', 'events:DeleteRule', 'events:RemoveTargets',
      ],
      resources: [
        `arn:aws:events:${cfg.region}:${cfg.account}:rule/StepFunctionsGetEventsForSageMakerProcessingJobsRule`,
      ],
    }));

    // ── IAM: EventBridge scheduler role ─────────────────────────────────────
    const eventBridgeRole = new iam.Role(this, 'EventBridgeSchedulerRole', {
      roleName: `tools-maritime-events-${e}`,
      assumedBy: new iam.ServicePrincipal('events.amazonaws.com'),
    });

    // ── IAM: Lambda execution role ───────────────────────────────────────────
    const lambdaRole = new iam.Role(this, 'LambdaExecutionRole', {
      roleName: `tools-maritime-lambda-${e}`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      sid: 'ReadProcessedOutput',
      actions: ['s3:GetObject', 's3:ListBucket'],
      resources: [processedOutputBucket.bucketArn, `${processedOutputBucket.bucketArn}/*`],
    }));

    // ── CloudWatch Logs: Step Functions log group ────────────────────────────
    const pipelineLogGroup = new logs.LogGroup(this, 'PipelineLogGroup', {
      logGroupName: `/tools/maritime/sfn-pipeline-${e}`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ── Step Functions: AIS processing pipeline state machine ────────────────
    // definitionString is built as a plain JS object to allow direct ARN
    // injection without Fn::Sub — CDK resolves sageMakerRole.roleArn at synth.
    const definition = {
      Comment: 'Maritime AIS data synthesis pipeline — Phase 1.',
      StartAt: 'StartAISProcessingJob',
      States: {
        StartAISProcessingJob: {
          Type: 'Task',
          Resource: 'arn:aws:states:::sagemaker:createProcessingJob.sync',
          Parameters: {
            'ProcessingJobName.$': "States.Format('ais-merge-{}', $$.Execution.Name)",
            RoleArn: sageMakerRole.roleArn,
            AppSpecification: {
              'ImageUri.$': '$.ProcessingImageUri',
              ContainerEntrypoint: ['python3', '/opt/ml/processing/code/ais_merge.py'],
            },
            ProcessingInputs: [
              {
                InputName: 'ais-raw',
                S3Input: {
                  'S3Uri.$': '$.AisInputPrefix',
                  LocalPath: '/opt/ml/processing/input/ais',
                  S3DataType: 'S3Prefix',
                  S3InputMode: 'File',
                  S3CompressionType: 'None',
                },
              },
              {
                InputName: 'avis',
                S3Input: {
                  'S3Uri.$': '$.AvisInputUri',
                  LocalPath: '/opt/ml/processing/input/avis',
                  S3DataType: 'S3Prefix',
                  S3InputMode: 'File',
                  S3CompressionType: 'None',
                },
              },
              {
                InputName: 'code',
                S3Input: {
                  'S3Uri.$': '$.ProcessingScriptUri',
                  LocalPath: '/opt/ml/processing/code',
                  S3DataType: 'S3Prefix',
                  S3InputMode: 'File',
                  S3CompressionType: 'None',
                },
              },
            ],
            ProcessingOutputConfig: {
              Outputs: [
                {
                  OutputName: 'master-record',
                  S3Output: {
                    'S3Uri.$': '$.OutputPrefix',
                    LocalPath: '/opt/ml/processing/output',
                    S3UploadMode: 'EndOfJob',
                  },
                },
              ],
            },
            ProcessingResources: {
              ClusterConfig: {
                InstanceCount: 1,
                'InstanceType.$': '$.InstanceType',
                VolumeSizeInGB: 100,
              },
            },
            StoppingCondition: { MaxRuntimeInSeconds: 86400 },
          },
          Retry: [
            {
              ErrorEquals: ['SageMaker.SageMakerException', 'SageMaker.ResourceLimitExceededException'],
              IntervalSeconds: 60,
              MaxAttempts: 2,
              BackoffRate: 2.0,
            },
          ],
          Catch: [{ ErrorEquals: ['States.ALL'], ResultPath: '$.error', Next: 'ProcessingFailed' }],
          ResultPath: '$.processingResult',
          Next: 'ProcessingSucceeded',
        },
        ProcessingSucceeded: {
          Type: 'Succeed',
          Comment: 'Maritime Master Record written to S3 OutputPrefix.',
        },
        ProcessingFailed: {
          Type: 'Fail',
          Error: 'AISProcessingJobFailed',
          Cause: 'SageMaker Processing Job did not complete successfully.',
        },
      },
    };

    const stateMachine = new sfn.CfnStateMachine(this, 'AisPipelineStateMachine', {
      stateMachineName: `tools-maritime-ais-pipeline-${e}`,
      stateMachineType: 'STANDARD',
      roleArn: sfnRole.roleArn,
      tracingConfiguration: { enabled: true },
      loggingConfiguration: {
        level: 'ERROR',
        includeExecutionData: true,
        destinations: [{ cloudWatchLogsLogGroup: { logGroupArn: pipelineLogGroup.logGroupArn } }],
      },
      definitionString: JSON.stringify(definition),
    });

    // EventBridge role needs the state machine ARN (known after stateMachine is created)
    eventBridgeRole.addToPolicy(new iam.PolicyStatement({
      sid: 'StartPipelineExecution',
      actions: ['states:StartExecution'],
      resources: [stateMachine.ref],
    }));

    // ── EventBridge: Daily trigger (DISABLED — enable after bootstrap) ───────
    new cdk.aws_events.CfnRule(this, 'DailyPipelineSchedule', {
      name: `tools-maritime-daily-pipeline-${e}`,
      description: 'Triggers the maritime AIS pipeline at 02:00 UTC daily. Disabled until bootstrapped.',
      scheduleExpression: 'cron(0 2 * * ? *)',
      state: 'DISABLED',
      targets: [
        {
          id: 'AisPipelineTarget',
          arn: stateMachine.ref,
          roleArn: eventBridgeRole.roleArn,
          input: JSON.stringify({
            AisInputPrefix: `s3://${aisInputBucket.bucketName}/raw/`,
            AvisInputUri: `s3://${aisInputBucket.bucketName}/avis/`,
            OutputPrefix: `s3://${processedOutputBucket.bucketName}/master-record/`,
            ProcessingScriptUri: `s3://${aisInputBucket.bucketName}/scripts/`,
            ProcessingImageUri: 'REPLACE_WITH_ECR_IMAGE_URI',
            InstanceType: 'ml.m5.xlarge',
          }),
        },
      ],
    });

    // ── Lambda: Dataset API function ─────────────────────────────────────────
    const datasetFn = new lambda.Function(this, 'DatasetApiFunction', {
      functionName: `tools-maritime-dataset-api-${e}`,
      description: 'Reads Maritime Master Record Parquet partitions and returns JSON.',
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'index.handler',
      role: lambdaRole,
      timeout: cdk.Duration.seconds(60),
      memorySize: 512,
      layers: [
        lambda.LayerVersion.fromLayerVersionArn(
          this, 'AWSSDKPandasLayer',
          `arn:aws:lambda:${cfg.region}:336392948345:layer:AWSSDKPandas-Python311:21`,
        ),
      ],
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
        '    groups = sorted(cp["Prefix"].rstrip("/").split("vessel_group=")[-1] for cp in r.get("CommonPrefixes", []))',
        '    return resp(200, {"groups": groups})',
        'def get_group(group, limit):',
        '    import awswrangler as wr',
        '    try:',
        '        df = wr.s3.read_parquet(f"s3://{BUCKET}/master-record/vessel_group={group}/").head(limit)',
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

    new ssm.StringParameter(this, 'SSMStateMachineArn', {
      parameterName: `/tools/${e}/maritime/state-machine-arn`,
      stringValue: stateMachine.ref,
      description: `ARN of the maritime AIS pipeline Step Functions state machine (${e})`,
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
    new cdk.CfnOutput(this, 'StateMachineArn', {
      value: stateMachine.ref,
      exportName: `tools-app-maritime-pipeline-${e}-StateMachineArn`,
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
