// us-west-2 precompute stack — co-located with Overture Maps S3
import * as cdk from 'aws-cdk-lib';
import * as batch from 'aws-cdk-lib/aws-batch';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { ToolsEnvConfig } from '../config';

export interface SolarHailPrecomputeStackProps extends cdk.StackProps {
  cfg: ToolsEnvConfig;
  /** Name of the production data S3 bucket (cross-region write target). */
  dataBucketName: string;
  /** Full URI of the ECR repo in us-east-1 (cross-region pull). */
  ecrRepoUri: string;
}

/**
 * Batch compute environment in us-west-2, co-located with the Overture Maps
 * S3 bucket.  Used only for the one-time (and occasional refresh) CONUS
 * buildings precompute job.  Running here instead of us-east-1 eliminates
 * cross-region DuckDB latency and keeps the Overture egress bill at $0
 * (AWS Open Data sponsorship, same-region).
 *
 * Prerequisites (one-time, manual):
 *   cdk bootstrap aws://606196119553/us-west-2
 */
export class SolarHailPrecomputeStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: SolarHailPrecomputeStackProps) {
    super(scope, id, props);
    const { cfg } = props;
    const e = cfg.env;

    // ── IAM: execution role (ECR pull + CloudWatch logs) ────────────────────
    // AmazonECSTaskExecutionRolePolicy grants ECR permissions with resource=*
    // which covers cross-region pulls from the us-east-1 repo.
    const execRole = new iam.Role(this, 'ExecRole', {
      roleName: `tools-solarhail-precompute-exec-${e}`,
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });

    // ── IAM: job role (S3 write to production bucket in us-east-1) ──────────
    const jobRole = new iam.Role(this, 'JobRole', {
      roleName: `tools-solarhail-precompute-job-${e}`,
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });
    jobRole.addToPolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject', 's3:PutObject', 's3:HeadObject', 's3:ListBucket'],
      resources: [
        `arn:aws:s3:::${props.dataBucketName}`,
        `arn:aws:s3:::${props.dataBucketName}/*`,
      ],
    }));

    // ── Batch: Fargate compute environment in us-west-2 ─────────────────────
    const vpc = ec2.Vpc.fromLookup(this, 'DefaultVpc', { isDefault: true });

    const computeEnv = new batch.FargateComputeEnvironment(this, 'ComputeEnv', {
      computeEnvironmentName: `tools-solarhail-precompute-${e}`,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      spot: false,   // on-demand for this long-running one-time job
      maxvCpus: 16,
    });

    const jobQueue = new batch.JobQueue(this, 'JobQueue', {
      jobQueueName: `tools-solarhail-precompute-queue-${e}`,
      computeEnvironments: [{ computeEnvironment: computeEnv, order: 1 }],
    });

    // ── Batch: job definition ────────────────────────────────────────────────
    // fromRegistry() is used because the ECR repo lives in a different region.
    new batch.EcsJobDefinition(this, 'JobDefinition', {
      jobDefinitionName: `tools-solarhail-precompute-${e}`,
      retryAttempts: 1,
      container: new batch.EcsFargateContainerDefinition(this, 'ContainerDef', {
        image: ecs.ContainerImage.fromRegistry(`${props.ecrRepoUri}:latest`),
        command: ['scripts/precompute_buildings.py', '--workers', '8'],
        cpu: 8,
        memory: cdk.Size.mebibytes(16384),
        executionRole: execRole,
        jobRole: jobRole,
        assignPublicIp: true,
        environment: {
          SOLARHAIL_ENV: e,
          DATA_DIR: '/tmp/solarhail_data',
          LOG_LEVEL: 'INFO',
        },
        logging: new ecs.AwsLogDriver({
          streamPrefix: `solarhail-precompute-${e}`,
          logRetention: cdk.aws_logs.RetentionDays.TWO_WEEKS,
        }),
      }),
    });

    // ── SSM: publish job queue ARN for submit scripts ────────────────────────
    new ssm.StringParameter(this, 'SSMJobQueue', {
      parameterName: `/tools/${e}/solarhail/precompute-job-queue`,
      stringValue: jobQueue.jobQueueArn,
      description: `SolarHail precompute Batch job queue ARN (us-west-2, ${e})`,
    });
  }
}
