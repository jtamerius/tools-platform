import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as glue from 'aws-cdk-lib/aws-glue';
import * as athena from 'aws-cdk-lib/aws-athena';
import * as batch from 'aws-cdk-lib/aws-batch';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { ToolsEnvConfig } from '../config';

export interface SolarHailStackProps extends cdk.StackProps {
  cfg: ToolsEnvConfig;
}

export class SolarHailStack extends cdk.Stack {
  public readonly dataBucketName: string;

  constructor(scope: Construct, id: string, props: SolarHailStackProps) {
    super(scope, id, props);
    const { cfg } = props;
    const e = cfg.env;
    const isProd = e === 'production';

    // ── S3: hail event Parquet + Athena query results ────────────────────────
    const dataBucket = new s3.Bucket(this, 'DataBucket', {
      bucketName: `tools-solarhail-${e}-${cfg.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: false,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: !isProd,
      lifecycleRules: [
        {
          id: 'ExpireAthenaResultsAfter7Days',
          enabled: true,
          prefix: 'athena-results/',
          expiration: cdk.Duration.days(7),
        },
      ],
    });

    this.dataBucketName = dataBucket.bucketName;

    // ── Glue catalog database ────────────────────────────────────────────────
    const database = new glue.CfnDatabase(this, 'GlueDatabase', {
      catalogId: this.account,
      databaseInput: {
        name: `solarhail_${e}`,
        description: `SolarHail hail event data (${e})`,
      },
    });

    // ── Glue table: hail_events with partition projection on event_date ──────
    //
    // S3 layout: parquet/hail-events/event_date=YYYY-MM-DD/{metro_id}.parquet
    // Athena reads event_date from the path via partition projection — no manual
    // MSCK REPAIR TABLE needed. metro_id is a regular column inside each file.
    new glue.CfnTable(this, 'HailEventsTable', {
      catalogId: this.account,
      databaseName: database.ref,
      tableInput: {
        name: 'hail_events',
        tableType: 'EXTERNAL_TABLE',
        parameters: {
          'classification': 'parquet',
          'has_encrypted_data': 'false',
          'projection.enabled': 'true',
          'projection.event_date.type': 'date',
          'projection.event_date.range': '2026-01-01,NOW+1',
          'projection.event_date.format': 'yyyy-MM-dd',
          'projection.event_date.interval': '1',
          'projection.event_date.interval.unit': 'DAYS',
          // eslint-disable-next-line no-template-curly-in-string
          'storage.location.template': `s3://${dataBucket.bucketName}/parquet/hail-events/event_date=\${event_date}/`,
        },
        partitionKeys: [
          { name: 'event_date', type: 'date' },
        ],
        storageDescriptor: {
          location: `s3://${dataBucket.bucketName}/parquet/hail-events/`,
          inputFormat: 'org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat',
          outputFormat: 'org.apache.hadoop.hive.ql.io.parquet.MapredParquetHiveOutputFormat',
          serdeInfo: {
            serializationLibrary: 'org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe',
            parameters: { 'serialization.format': '1' },
          },
          compressed: false,
          storedAsSubDirectories: false,
          columns: [
            { name: 'h3_index',              type: 'string' },
            { name: 'max_mesh_mm',           type: 'float' },
            { name: 'timestamp',             type: 'timestamp' },
            { name: 'metro_id',              type: 'string' },
            { name: 'solar_systems_exposed', type: 'float' },
          ],
        },
      },
    });

    // ── Athena workgroup ─────────────────────────────────────────────────────
    new athena.CfnWorkGroup(this, 'AthenaWorkgroup', {
      name: `solarhail-wg-${e}`,
      description: `SolarHail Athena workgroup (${e})`,
      state: 'ENABLED',
      workGroupConfiguration: {
        resultConfiguration: {
          outputLocation: `s3://${dataBucket.bucketName}/athena-results/`,
        },
        enforceWorkGroupConfiguration: true,
        publishCloudWatchMetricsEnabled: false,
        bytesScannedCutoffPerQuery: 1_073_741_824, // 1 GB per query safety limit
      },
    });

    // ── ECR: pipeline container image ────────────────────────────────────────
    const ecrRepo = new ecr.Repository(this, 'PipelineRepo', {
      repositoryName: `tools-solarhail-pipeline-${e}`,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      lifecycleRules: [
        {
          description: 'Keep last 10 images',
          maxImageCount: 10,
          rulePriority: 1,
        },
      ],
    });

    // ── IAM: Batch execution role (ECR pull + CloudWatch logs) ───────────────
    const batchExecRole = new iam.Role(this, 'BatchExecutionRole', {
      roleName: `tools-solarhail-batch-exec-${e}`,
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });
    ecrRepo.grantPull(batchExecRole);

    // ── IAM: Batch job role (S3 write for pipeline output) ───────────────────
    const batchJobRole = new iam.Role(this, 'BatchJobRole', {
      roleName: `tools-solarhail-pipeline-${e}`,
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: `SolarHail pipeline task role - writes Parquet to S3 (${e})`,
    });
    dataBucket.grantReadWrite(batchJobRole);

    // ── AWS Batch: Fargate Spot compute environment ──────────────────────────
    // Uses the default VPC public subnets with public IP assignment so tasks
    // can reach ECR and NOAA S3 without a NAT gateway or VPC endpoints.
    const vpc = ec2.Vpc.fromLookup(this, 'DefaultVpc', { isDefault: true });
    const computeEnv = new batch.FargateComputeEnvironment(this, 'ComputeEnv', {
      computeEnvironmentName: `tools-solarhail-fargate-${e}`,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      spot: true,           // Fargate Spot — ~70% cost reduction vs on-demand
      maxvCpus: 128,
    });

    // ── Batch job queue ──────────────────────────────────────────────────────
    const jobQueue = new batch.JobQueue(this, 'JobQueue', {
      jobQueueName: `tools-solarhail-queue-${e}`,
      computeEnvironments: [
        { computeEnvironment: computeEnv, order: 1 },
      ],
    });

    // ── Batch job definition ─────────────────────────────────────────────────
    // Image tag is overridden per-submission (latest used here as default).
    // Container env vars are also overridden at submit time for METRO/dates.
    const jobDef = new batch.EcsJobDefinition(this, 'JobDefinition', {
      jobDefinitionName: `tools-solarhail-pipeline-${e}`,
      retryAttempts: 3,
      retryStrategies: [
        batch.RetryStrategy.of(batch.Action.RETRY, batch.Reason.SPOT_INSTANCE_RECLAIMED),
      ],
      container: new batch.EcsFargateContainerDefinition(this, 'ContainerDef', {
        image: ecs.ContainerImage.fromEcrRepository(ecrRepo, 'latest'),
        command: ['-m', 'src.main'],
        cpu: 4,
        memory: cdk.Size.mebibytes(16384),
        executionRole: batchExecRole,
        jobRole: batchJobRole,
        assignPublicIp: true,  // required to reach ECR/S3 from public subnets without NAT
        environment: {
          SOLARHAIL_ENV: e,
          UPLOAD_S3: 'true',
          OUT_DIR: '/tmp/solarhail_output',
          DATA_DIR: '/tmp/solarhail_data',
          LOG_LEVEL: 'INFO',
        },
        logging: new ecs.AwsLogDriver({
          streamPrefix: `solarhail-pipeline-${e}`,
          logRetention: cdk.aws_logs.RetentionDays.TWO_WEEKS,
        }),
      }),
    });

    // ── Batch job definition: CONUS single-day pipeline ──────────────────────
    // Runs scripts/run_conus_day.py for one date. Submit with:
    //   --parameters event_date=2026-04-15
    // Smaller than per-metro job — no live Overture query (uses precomputed file).
    const conusJobDef = new batch.EcsJobDefinition(this, 'ConusJobDefinition', {
      jobDefinitionName: `tools-solarhail-conus-${e}`,
      parameters: { event_date: '2026-01-01' },
      retryAttempts: 2,
      retryStrategies: [
        batch.RetryStrategy.of(batch.Action.RETRY, batch.Reason.SPOT_INSTANCE_RECLAIMED),
      ],
      container: new batch.EcsFargateContainerDefinition(this, 'ConusContainerDef', {
        image: ecs.ContainerImage.fromEcrRepository(ecrRepo, 'latest'),
        command: ['scripts/run_conus_day.py', '--date', 'Ref::event_date'],
        cpu: 2,
        memory: cdk.Size.mebibytes(4096),
        executionRole: batchExecRole,
        jobRole: batchJobRole,
        assignPublicIp: true,
        environment: {
          SOLARHAIL_ENV: e,
          DATA_DIR: '/tmp/solarhail_data',
          LOG_LEVEL: 'INFO',
        },
        logging: new ecs.AwsLogDriver({
          streamPrefix: `solarhail-conus-${e}`,
          logRetention: cdk.aws_logs.RetentionDays.TWO_WEEKS,
        }),
      }),
    });

    // ── Batch: small on-demand compute environment for maintenance jobs ──────
    // Separate from the main Spot queue so short maintenance tasks (USPVDB
    // precompute, etc.) never compete with or get preempted by Spot reclaims.
    const onDemandComputeEnv = new batch.FargateComputeEnvironment(this, 'OnDemandComputeEnv', {
      computeEnvironmentName: `tools-solarhail-ondemand-${e}`,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      spot: false,
      maxvCpus: 4,
    });

    const onDemandQueue = new batch.JobQueue(this, 'OnDemandJobQueue', {
      jobQueueName: `tools-solarhail-ondemand-queue-${e}`,
      computeEnvironments: [{ computeEnvironment: onDemandComputeEnv, order: 1 }],
    });

    // ── Batch job definition: USPVDB commercial solar precompute ────────────
    // Downloads USGS utility-scale solar database, snaps to H3 res-8, writes
    // two parquet files to s3://{bucket}/commercial-solar/. ETag-based change
    // detection means the job is a no-op if USGS hasn't published a new version.
    // Triggered monthly by EventBridge; can also be submitted manually.
    const uspvdbJobDef = new batch.EcsJobDefinition(this, 'UspvdbJobDefinition', {
      jobDefinitionName: `tools-solarhail-uspvdb-${e}`,
      retryAttempts: 1,
      container: new batch.EcsFargateContainerDefinition(this, 'UspvdbContainerDef', {
        image: ecs.ContainerImage.fromEcrRepository(ecrRepo, 'latest'),
        command: ['scripts/precompute_uspvdb.py'],
        cpu: 0.5,
        memory: cdk.Size.mebibytes(1024),
        executionRole: batchExecRole,
        jobRole: batchJobRole,
        assignPublicIp: true,
        environment: {
          SOLARHAIL_ENV: e,
          LOG_LEVEL: 'INFO',
        },
        logging: new ecs.AwsLogDriver({
          streamPrefix: `solarhail-uspvdb-${e}`,
          logRetention: cdk.aws_logs.RetentionDays.ONE_MONTH,
        }),
      }),
    });

    // Monthly EventBridge schedule: 1st of each month at 06:00 UTC.
    // Uses ETag check — no-op if USGS hasn't updated since last run.
    new events.Rule(this, 'UspvdbMonthlyRule', {
      ruleName: `tools-solarhail-uspvdb-monthly-${e}`,
      description: `Monthly USPVDB commercial solar precompute (${e})`,
      schedule: events.Schedule.cron({ day: '1', hour: '6', minute: '0' }),
      targets: [
        new targets.BatchJob(
          onDemandQueue.jobQueueArn,
          onDemandQueue,
          uspvdbJobDef.jobDefinitionArn,
          uspvdbJobDef,
          { jobName: `uspvdb-monthly-${e}` },
        ),
      ],
    });

    // ── Batch job definition: H3→state lookup precompute ────────────────────
    // One-time job: resolves 4.66M H3 cell centroids to US states via spatial
    // join. Writes lookups/h3_to_state.parquet. Re-run manually if TIGER year
    // changes. Uses on-demand queue; takes ~10 min at 4 vCPU / 8 GB.
    new batch.EcsJobDefinition(this, 'H3StateJobDefinition', {
      jobDefinitionName: `tools-solarhail-h3state-${e}`,
      retryAttempts: 1,
      container: new batch.EcsFargateContainerDefinition(this, 'H3StateContainerDef', {
        image: ecs.ContainerImage.fromEcrRepository(ecrRepo, 'latest'),
        command: ['scripts/precompute_h3_state.py'],
        cpu: 4,
        memory: cdk.Size.mebibytes(8192),
        executionRole: batchExecRole,
        jobRole: batchJobRole,
        assignPublicIp: true,
        environment: {
          SOLARHAIL_ENV: e,
          DATA_DIR: '/tmp/solarhail_data',
          LOG_LEVEL: 'INFO',
        },
        logging: new ecs.AwsLogDriver({
          streamPrefix: `solarhail-h3state-${e}`,
          logRetention: cdk.aws_logs.RetentionDays.ONE_MONTH,
        }),
      }),
    });

    // ── Lambda: public API (S3 Select — no auth, no external deps) ──────────
    const apiFn = new lambda.Function(this, 'ApiFunction', {
      functionName: `tools-solarhail-api-${e}`,
      description: `SolarHail public API — reads hail event Parquet via S3 Select (${e})`,
      runtime: lambda.Runtime.PYTHON_3_12,
      code: lambda.Code.fromAsset(path.join(__dirname, '../../../../apps/solarhail/api')),
      handler: 'handler.handler',
      timeout: cdk.Duration.seconds(60),
      memorySize: 1024,
      environment: {
        S3_BUCKET: dataBucket.bucketName,
        S3_PREFIX: 'parquet/hail-events',
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    dataBucket.grantRead(apiFn);

    // ── API Gateway v2 (HTTP API, no auth — public site) ────────────────────
    const httpApi = new apigwv2.CfnApi(this, 'HttpApi', {
      name: `tools-solarhail-api-${e}`,
      description: `SolarHail public hail data API (${e})`,
      protocolType: 'HTTP',
      corsConfiguration: {
        allowOrigins: ['*'],
        allowMethods: ['GET', 'OPTIONS'],
        allowHeaders: ['Content-Type'],
        allowCredentials: false,
        maxAge: 300,
      },
    });

    const integration = new apigwv2.CfnIntegration(this, 'ApiIntegration', {
      apiId: httpApi.ref,
      integrationType: 'AWS_PROXY',
      integrationUri: apiFn.functionArn,
      payloadFormatVersion: '2.0',
    });

    new apigwv2.CfnRoute(this, 'ConusRoute', {
      apiId: httpApi.ref,
      routeKey: 'GET /api/conus',
      target: `integrations/${integration.ref}`,
    });

    new apigwv2.CfnRoute(this, 'ConusStateSummaryRoute', {
      apiId: httpApi.ref,
      routeKey: 'GET /api/conus/state-summary',
      target: `integrations/${integration.ref}`,
    });

    new apigwv2.CfnRoute(this, 'FacilitiesRoute', {
      apiId: httpApi.ref,
      routeKey: 'GET /api/facilities',
      target: `integrations/${integration.ref}`,
    });

    new apigwv2.CfnStage(this, 'ApiStage', {
      apiId: httpApi.ref,
      stageName: '$default',
      autoDeploy: true,
      defaultRouteSettings: {
        throttlingRateLimit: 50,   // sustained requests/second
        throttlingBurstLimit: 100, // max concurrent burst
      },
    });

    new lambda.CfnPermission(this, 'ApiInvokePermission', {
      functionName: apiFn.functionArn,
      action: 'lambda:InvokeFunction',
      principal: 'apigateway.amazonaws.com',
      sourceArn: `arn:aws:execute-api:${cfg.region}:${cfg.account}:${httpApi.ref}/*/*`,
    });

    const apiUrl = `https://${httpApi.ref}.execute-api.${cfg.region}.amazonaws.com`;

    // ── SSM: publish resource names for pipeline, submit script, and API ─────
    new ssm.StringParameter(this, 'SSMBucketName', {
      parameterName: `/tools/${e}/solarhail/s3-bucket`,
      stringValue: dataBucket.bucketName,
      description: `SolarHail data bucket name (${e})`,
    });

    new ssm.StringParameter(this, 'SSMDatabaseName', {
      parameterName: `/tools/${e}/solarhail/glue-database`,
      stringValue: `solarhail_${e}`,
      description: `SolarHail Glue database name (${e})`,
    });

    new ssm.StringParameter(this, 'SSMAthenaWorkgroup', {
      parameterName: `/tools/${e}/solarhail/athena-workgroup`,
      stringValue: `solarhail-wg-${e}`,
      description: `SolarHail Athena workgroup (${e})`,
    });

    new ssm.StringParameter(this, 'SSMJobQueue', {
      parameterName: `/tools/${e}/solarhail/batch-job-queue`,
      stringValue: jobQueue.jobQueueArn,
      description: `SolarHail Batch job queue ARN (${e})`,
    });

    new ssm.StringParameter(this, 'SSMJobDefinition', {
      parameterName: `/tools/${e}/solarhail/batch-job-definition`,
      stringValue: jobDef.jobDefinitionArn,
      description: `SolarHail Batch job definition ARN (${e})`,
    });

    new ssm.StringParameter(this, 'SSMConusJobDefinition', {
      parameterName: `/tools/${e}/solarhail/batch-conus-job-definition`,
      stringValue: conusJobDef.jobDefinitionArn,
      description: `SolarHail CONUS Batch job definition ARN (${e})`,
    });

    new ssm.StringParameter(this, 'SSMEcrRepo', {
      parameterName: `/tools/${e}/solarhail/ecr-repo-uri`,
      stringValue: ecrRepo.repositoryUri,
      description: `SolarHail ECR repository URI (${e})`,
    });

    new ssm.StringParameter(this, 'SSMApiUrl', {
      parameterName: `/tools/${e}/solarhail/api-url`,
      stringValue: apiUrl,
      description: `SolarHail public API URL (${e})`,
    });

    new ssm.StringParameter(this, 'SSMUspvdbJobDefinition', {
      parameterName: `/tools/${e}/solarhail/batch-uspvdb-job-definition`,
      stringValue: uspvdbJobDef.jobDefinitionArn,
      description: `SolarHail USPVDB precompute Batch job definition ARN (${e})`,
    });

    new ssm.StringParameter(this, 'SSMOnDemandJobQueue', {
      parameterName: `/tools/${e}/solarhail/batch-ondemand-queue`,
      stringValue: onDemandQueue.jobQueueArn,
      description: `SolarHail on-demand Batch job queue ARN — for maintenance jobs (${e})`,
    });

    // ── Outputs ──────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'DataBucketName', {
      value: dataBucket.bucketName,
      exportName: `tools-app-solarhail-${e}-DataBucket`,
    });

    new cdk.CfnOutput(this, 'GlueDatabaseName', {
      value: `solarhail_${e}`,
      exportName: `tools-app-solarhail-${e}-GlueDatabase`,
    });

    new cdk.CfnOutput(this, 'AthenaWorkgroupName', {
      value: `solarhail-wg-${e}`,
      exportName: `tools-app-solarhail-${e}-AthenaWorkgroup`,
    });

    new cdk.CfnOutput(this, 'EcrRepositoryUri', {
      value: ecrRepo.repositoryUri,
      exportName: `tools-app-solarhail-${e}-EcrRepoUri`,
    });

    new cdk.CfnOutput(this, 'BatchJobQueueArn', {
      value: jobQueue.jobQueueArn,
      exportName: `tools-app-solarhail-${e}-JobQueueArn`,
    });

    new cdk.CfnOutput(this, 'ConusJobDefinitionArn', {
      value: conusJobDef.jobDefinitionArn,
      exportName: `tools-app-solarhail-${e}-ConusJobDefArn`,
    });

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: apiUrl,
      exportName: `tools-app-solarhail-${e}-ApiUrl`,
    });

    cdk.Tags.of(this).add('Environment', e);
    cdk.Tags.of(this).add('Project', 'tools-platform');
    cdk.Tags.of(this).add('App', 'solarhail');
  }
}
